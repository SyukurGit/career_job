import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { resolveRootScript } from "./core/code-root.mjs";
import { acquireDirLock, releaseOrWarn } from "./core/dir-lock.mjs";

async function withRegistryLock(root, action) {
  const lock = await acquireDirLock(path.join(scannerPaths(root).base, "registry.lock"), {
    timeoutMs: 5000, maxWaitMs: 10000, retryMs: 15, staleMs: 5000, createParent: true,
    owner: { purpose: "scanner-registry" },
  });
  try { return await action(); }
  finally { releaseOrWarn(lock); }
}

export const TERMINAL_SCAN_STATES = ["complete", "partial", "error", "cancelled"];
export const SCANNER_PROCESS_UNCONFIRMED = "SCANNER_PROCESS_UNCONFIRMED";
const unconfirmedProcessMessage = "Scanner berhenti melapor, tetapi prosesnya belum terkonfirmasi berhenti. Pemindaian baru diblokir sampai proses lama berhenti.";

export function scannerPaths(root, runId) {
  const base = path.join(root, "data", "scanner-web");
  if (runId !== undefined && !/^[a-f0-9-]{36}$/i.test(runId)) throw new Error("ID scan tidak valid.");
  return { base, lock: path.join(base, "active.json"), latest: path.join(base, "latest.json"),
    run: runId ? path.join(base, "runs", `${runId}.json`) : null,
    events: runId ? path.join(base, "runs", `${runId}.events.jsonl`) : null,
    cancel: runId ? path.join(base, "runs", `${runId}.cancel`) : null };
}

export function readScannerJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

export function writeScannerJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(value)); fs.renameSync(temp, file); }
  finally { try { fs.unlinkSync(temp); } catch (error) { if (error.code !== "ENOENT") throw error; } }
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
}

export function scanSummary(receipt) {
  if (!receipt) return null;
  const { discoveries, ownerPid, workerPid, childPid, ...summary } = receipt;
  return summary;
}

export function scannerReceipt(run, core, code, cancelled = false, message) {
  const valid = core && ["complete", "partial", "error"].includes(core.status)
    && core.coverage && ["complete", "partial", "error"].includes(core.coverage.status)
    && ["attempted", "succeeded", "failed"].every((key) => Number.isInteger(core.coverage[key]) && core.coverage[key] >= 0)
    && Array.isArray(core.coverage.sources)
    && ["rawFound", "admitted", "rejected", "newAdded"].every((key) => Number.isInteger(core[key]) && core[key] >= 0);
  const expectedExit = code === 0 || (code === 2 && core?.status !== "complete");
  const status = cancelled ? "cancelled" : !valid || !expectedExit ? "error"
    : core.status === "error" || core.coverage.status === "error" ? "error"
      : core.status === "partial" || core.coverage.status === "partial" ? "partial" : "complete";
  return { ...(valid ? core : {}), runId: run.runId, since: run.since, fresh: run.fresh,
    startedAt: run.startedAt, completedAt: new Date().toISOString(), status, exitCode: code,
    coverage: valid ? core.coverage : { status: cancelled ? "cancelled" : "error", attempted: null, succeeded: null, failed: null, sources: [] },
    ...(!valid ? { rawFound: null, admitted: null, rejected: null, newAdded: null } : {}),
    message: message || (cancelled ? "Pemindaian dibatalkan; hasil yang belum dikonfirmasi tidak dihitung."
      : !valid ? "Scanner tidak mengirim receipt akhir yang valid; hasil tersimpan belum terkonfirmasi."
        : !expectedExit ? `Scanner keluar dengan kode ${code ?? "signal"}.` : undefined) };
}

function finishUnlocked(root, receipt) {
  const files = scannerPaths(root, receipt.runId);
  const existing = readScannerJson(files.run);
  if (!existing && receipt.engineStopped !== false && receipt.status !== "cancelled"
      && fs.existsSync(files.cancel)) {
    receipt = { ...receipt, status: "cancelled",
      coverage: receipt.coverage.attempted == null ? { ...receipt.coverage, status: "cancelled" } : receipt.coverage,
      message: "Pemindaian dibatalkan; hanya hasil commit yang dikonfirmasi receipt dihitung." };
  }
  if (existing && TERMINAL_SCAN_STATES.includes(existing.status)) receipt = existing;
  else writeScannerJson(files.run, receipt);
  const lock = readScannerJson(files.lock);
  if (lock?.runId === receipt.runId) {
    if (readScannerJson(files.latest)?.runId !== receipt.runId) writeScannerJson(files.latest, scanSummary(receipt));
    if (!engineMayBeRunning(lock, receipt)) fs.unlinkSync(files.lock);
  }
  return receipt;
}

function engineMayBeRunning(active, receipt) {
  return receipt.engineStopped === false && alive(active.childPid ?? receipt.childPid);
}

export function scannerUnconfirmedReceipt(run, core, code) {
  return { ...scannerReceipt(run, core, code, false, unconfirmedProcessMessage), status: "error", engineStopped: false, childPid: run.childPid };
}

export function finishScannerRun(root, receipt) {
  return withRegistryLock(root, () => finishUnlocked(root, receipt));
}

export function registerScannerWorker(root, runId, pid, launchEngine) {
  return withRegistryLock(root, () => {
    const lock = scannerPaths(root).lock;
    const run = readScannerJson(lock);
    if (!run || run.runId !== runId || (run.workerPid && run.workerPid !== pid)) {
      throw new Error("Scanner ownership changed.");
    }
    const childPid = launchEngine(run);
    if (childPid) writeScannerJson(lock, { ...run, workerPid: pid, childPid });
  });
}

function statusUnlocked(root) {
  const files = scannerPaths(root);
  let active = readScannerJson(files.lock);
  let blocked = false;
  if (active) {
    const runFiles = scannerPaths(root, active.runId);
    const receipt = readScannerJson(runFiles.run);
    if (receipt && TERMINAL_SCAN_STATES.includes(receipt.status)) {
      // A crash between committing the receipt and releasing the lock is recoverable.
      finishUnlocked(root, receipt);
      blocked = fs.existsSync(files.lock);
      active = null;
    } else if ((active.workerPid && !alive(active.workerPid)) || (!active.workerPid && !alive(active.ownerPid))) {
      // Disk PIDs can fence a new writer, but cannot authorize sending a signal.
      // Only the live supervisor has the ChildProcess handle of the scan it launched.
      const final = alive(active.childPid) ? scannerUnconfirmedReceipt(active, null, null)
        : scannerReceipt(active, null, null, fs.existsSync(runFiles.cancel),
          fs.existsSync(runFiles.cancel) ? undefined : "Server scanner berhenti sebelum receipt akhir; proses tidak lagi aktif.");
      finishUnlocked(root, final);
      blocked = fs.existsSync(files.lock);
      active = null;
    } else if (!alive(active.ownerPid)) {
      if (!fs.existsSync(runFiles.cancel)) fs.writeFileSync(runFiles.cancel, "server-stopped");
      active = { ...active, status: "cancelling" };
    } else if (fs.existsSync(runFiles.cancel)) active = { ...active, status: "cancelling" };
  }
  return { activeRun: active ? scanSummary(active) : null, latestCompletedReceipt: readScannerJson(files.latest), blocked };
}

export function scannerStatus(root) {
  return withRegistryLock(root, () => statusUnlocked(root));
}

export function scannerInvocation(codeRoot, root, run) {
  return { script: resolveRootScript(codeRoot, "scan"), cwd: root,
    args: ["--json", "--since", String(run.since), ...(run.fresh ? ["--fresh"] : [])],
    env: { ...process.env, CAREER_OPS_ROOT: root, ...(run.fresh ? { CAREER_OPS_HTTP_CACHE: "0" } : {}) } };
}

function startUnlocked(root, codeRoot, options, launch) {
  const since = String(options.since ?? 60);
  if (since !== "all" && (!/^\d+$/.test(since) || Number(since) < 1 || Number(since) > 36500)) {
    throw new Error("Jangkauan harus berupa jumlah hari positif atau all.");
  }
  const current = statusUnlocked(root);
  if (current.activeRun) return { run: current.activeRun, joined: true };
  if (current.blocked) throw Object.assign(new Error(unconfirmedProcessMessage), { code: SCANNER_PROCESS_UNCONFIRMED });
  const workerScript = path.join(/* turbopackIgnore: true */ codeRoot, "web", "src", "lib", "scanner-worker.mjs");
  for (const script of [resolveRootScript(codeRoot, "scan"), workerScript]) {
    if (!fs.existsSync(script) || !fs.statSync(script).isFile()) throw new Error(`Kode scanner tidak ditemukan: ${script}. Periksa CAREER_OPS_CODE_ROOT.`);
  }
  const files = scannerPaths(root);
  fs.mkdirSync(path.join(files.base, "runs"), { recursive: true });
  const run = { runId: randomUUID(), status: "running", since, fresh: options.fresh !== false,
    startedAt: new Date().toISOString(), ownerPid: process.pid, workerPid: null };
  let fd;
  try { fd = fs.openSync(files.lock, "wx"); }
  catch (error) {
    if (error.code === "EEXIST") {
      const active = readScannerJson(files.lock);
      if (!active) throw new Error("Scanner sedang diinisialisasi. Segarkan status.");
      return { run: scanSummary(active), joined: true };
    }
    throw error;
  }
  try { fs.writeFileSync(fd, JSON.stringify(run)); } finally { fs.closeSync(fd); }
  try {
    const child = launch(process.execPath, [workerScript, root, codeRoot, run.runId], {
      cwd: root, env: { ...process.env, CAREER_OPS_ROOT: root }, windowsHide: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    run.workerPid = child.pid || null;
    writeScannerJson(files.lock, run);
    child.once("error", (error) => {
      void finishScannerRun(root, scannerReceipt(run, null, null, false, error.message)).catch((failure) => {
        console.error("Scanner launch receipt could not be persisted:", failure);
      });
    });
    // IPC disconnect tells the supervisor to cancel even if the web process crashes.
    // No request/subscriber owns the job; closing a browser never cancels it.
    return { run, joined: false };
  } catch (error) {
    finishUnlocked(root, scannerReceipt(run, null, null, false, error.message));
    throw error;
  }
}

export function startScanner(root, codeRoot, options = {}, launch = spawn) {
  return withRegistryLock(root, () => startUnlocked(root, codeRoot, options, launch));
}

export function cancelScanner(root, runId) {
  return withRegistryLock(root, () => {
    const status = statusUnlocked(root);
    if (!status.activeRun || status.activeRun.runId !== runId) return false;
    fs.writeFileSync(scannerPaths(root, runId).cancel, "user-stop");
    return true;
  });
}

export function readScannerEvents(root, runId, after = 0) {
  const files = scannerPaths(root, runId);
  // Read the commit first: once it exists the worker has stopped appending logs.
  const receipt = readScannerJson(files.run);
  let text = "";
  try { text = fs.readFileSync(files.events, "utf8"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  // Only complete NDJSON records are visible while the supervisor appends.
  const lines = text.split("\n"); lines.pop();
  const events = lines.slice(after).map((line, index) => ({ id: after + index + 1, ...JSON.parse(line) }));
  if (receipt && after <= lines.length) {
    const last = events.at(-1) ?? (lines.length ? JSON.parse(lines[lines.length - 1]) : null);
    if (last?.type !== "end") events.push({ id: lines.length + 1, type: "end", data: scanSummary(receipt) });
  }
  return events;
}

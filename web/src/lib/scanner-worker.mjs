import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { scannerPaths, registerScannerWorker, scannerInvocation, scannerReceipt, scannerUnconfirmedReceipt, scanSummary, finishScannerRun } from "./scanner-lifecycle.mjs";

const [root, codeRoot, runId] = process.argv.slice(2);
const files = scannerPaths(root, runId);
const windows = process.platform === "win32";
const graceMs = 2000;
const deadlineMs = 4500;
let run;
let child;
let stdout = "";
let stopping = false;
let cancelled = false;
let finished = false;
let exited = false;
let shutdown = false;
let exitCode = null;
let failure;
let forceTimer;
let deadline;
let poll;
let forced = false;

function event(type, data) {
  fs.appendFileSync(files.events, `${JSON.stringify({ type, data })}\n`);
}

function killDirect() {
  if (!child?.pid || exited) return;
  try { child.kill("SIGKILL"); } catch (error) { failure ??= error.message; }
}

function signalGroup(signal) {
  try { process.kill(-child.pid, signal); }
  catch (error) {
    if (error.code !== "ESRCH") failure ??= error.message;
    killDirect();
  }
}

function forceGroup() {
  if (!forced) {
    forced = true;
    signalGroup("SIGKILL");
  }
}

function stop(reason, requested = true) {
  if (finished || stopping) return;
  stopping = true;
  cancelled = requested;
  if (!child?.pid) { void finish(null); return; }
  // An exited engine doesn't imply EOF: descendants can inherit its pipes.
  // A termination deadline covers both the kill attempt and draining output.
  deadline = setTimeout(() => {
    if (!windows) forceGroup();
    killDirect();
    child.stdout.destroy();
    child.stderr.destroy();
    if (!exited) child.unref();
    void finish(exitCode, exited);
  }, deadlineMs);
  try { event("log", { text: `Menghentikan pemindaian: ${reason}`, stream: "stderr" }); }
  catch (error) { failure ??= error.message; }
  if (windows) {
    if (exited) return;
    // Use the system executable, not one found in the data directory or PATH.
    // This dedicated worker can block briefly while retaining the live child handle.
    const taskkill = process.env.SystemRoot && path.join(process.env.SystemRoot, "System32", "taskkill.exe");
    const killed = taskkill && spawnSync(taskkill, ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true, stdio: "ignore", timeout: graceMs, killSignal: "SIGKILL",
    });
    if (killed?.status !== 0) killDirect();
  } else {
    signalGroup("SIGTERM");
    forceTimer = setTimeout(forceGroup, graceMs);
  }
}

async function finish(code, engineStopped = true) {
  if (finished) return;
  finished = true;
  clearInterval(poll);
  clearTimeout(forceTimer);
  clearTimeout(deadline);
  if (stopping && !windows && child?.pid) forceGroup();
  let core;
  try { core = JSON.parse(stdout.trim()); } catch { /* Missing output never confirms success. */ }
  try {
    const receipt = engineStopped ? scannerReceipt(run, core, code, cancelled, failure)
      : scannerUnconfirmedReceipt(run, core, code);
    await finishScannerRun(root, receipt);
  } catch (error) {
    console.error("Scanner receipt could not be persisted:", error);
    process.exitCode = 1;
  } finally {
    if (process.connected) process.disconnect();
  }
}

function serverStopped() {
  shutdown = true;
  if (run) stop("server berhenti");
}
process.on("disconnect", serverStopped);
process.on("SIGTERM", serverStopped);
process.on("SIGINT", serverStopped);
try {
  // Check cancellation and record the engine PID while the same registry lock
  // holds ownership. Another request cannot repair/replace this run in between.
  await registerScannerWorker(root, runId, process.pid, (ownedRun) => {
    run = ownedRun;
    event("start", scanSummary(run));
    if (shutdown || !process.connected || fs.existsSync(files.cancel)) {
      stop(shutdown || !process.connected ? "server berhenti" : "permintaan pembatalan");
      return;
    }
    const invocation = scannerInvocation(codeRoot, root, run);
    child = spawn(process.execPath, [invocation.script, ...invocation.args], {
      cwd: invocation.cwd, env: invocation.env, windowsHide: true,
      detached: !windows, stdio: ["ignore", "pipe", "pipe"],
    });
    run.childPid = child.pid;
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (text) => {
      if (finished) return;
      try { event("log", { text, stream: "stderr" }); }
      catch (error) { failure ??= error.message; stop("log tidak dapat disimpan", false); }
    });
    child.once("exit", (code) => { exited = true; exitCode = code; });
    // `error` can be a failed signal, not proof the child has stopped.
    child.on("error", (error) => { failure ??= error.message; });
    child.once("close", (code) => { void finish(code); });
    poll = setInterval(() => {
      try { if (fs.existsSync(files.cancel)) stop("permintaan pembatalan"); }
      catch (error) { failure ??= error.message; stop("permintaan pembatalan tidak terbaca", false); }
    }, 250);
    return child.pid;
  });
} catch (error) {
  failure ??= error.message;
  if (run) stop("inisialisasi gagal", false);
  else throw error;
}

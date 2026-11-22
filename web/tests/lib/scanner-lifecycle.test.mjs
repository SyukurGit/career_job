import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { scannerPaths, scannerInvocation, scannerReceipt, scannerStatus, startScanner, cancelScanner, finishScannerRun, readScannerEvents, writeScannerJson, readScannerJson } from "../../src/lib/scanner-lifecycle.mjs";
import { confirmedScanSuccess, readScannerStream } from "../../src/lib/scanner-stream.mjs";
import "../helpers/web-ts-alias-loader.mjs";

const lib = fileURLToPath(new URL("../../src/lib/", import.meta.url));
const completeCore = {
  status: "complete", rawFound: 5, admitted: 3, rejected: 2, newAdded: 1,
  coverage: { status: "complete", attempted: 1, succeeded: 1, failed: 0, sources: [{ id: "fixture", status: "complete", found: 5 }] },
  discoveries: [{ company: "Fixture", title: "Engineer", url: "https://example.test/jobs/1" }],
};
const run = { runId: randomUUID(), startedAt: "2026-11-15T01:00:00.000Z", since: "60", fresh: true };
const completeOutput = `console.log(${JSON.stringify(JSON.stringify(completeCore))});`;
const waitingEngine = `
  process.on("SIGTERM", () => {});
  const idle = setInterval(() => {}, 1000);
  setTimeout(() => { clearInterval(idle); process.exitCode = 91; }, 10000);
  console.error("fixture ready");
`;

function fixture(t, source = completeOutput) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "career-scanner-fixture-"));
  const root = path.join(base, "private-data");
  const codeRoot = path.join(base, "checkout");
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "applications.md"), "preserve application decisions\n");
  const targetLib = path.join(codeRoot, "web", "src", "lib");
  fs.mkdirSync(path.join(targetLib, "core"), { recursive: true });
  for (const name of ["scanner-worker.mjs", "scanner-lifecycle.mjs", "core/code-root.mjs", "core/dir-lock.mjs"]) {
    fs.copyFileSync(path.join(lib, name), path.join(targetLib, name));
  }
  fs.writeFileSync(path.join(codeRoot, "scan.mjs"), source);
  const children = [];
  const launch = (executable, args, options) => {
    if (args[0].endsWith("scanner-worker.mjs")) options = { ...options, stdio: ["ignore", "ignore", "pipe", "ipc"] };
    const child = spawn(executable, args, options);
    // A parent-initiated disconnect closes IPC locally. Node's aggregate
    // ChildProcess "close" waits for IPC EOF and need not fire on that path.
    // Observe the actual process exit, pipe closure and IPC teardown instead.
    const exited = new Promise((resolve) => {
      child.once("exit", resolve);
      child.once("error", () => { if (!child.pid) resolve(); });
    });
    const disconnected = child.connected ? new Promise((resolve) => child.once("disconnect", resolve)) : null;
    const pipes = child.stdio.filter(Boolean).map((pipe) => new Promise((resolve) => pipe.once("close", resolve)));
    const record = { child, closed: Promise.all([exited, disconnected, ...pipes]), stderr: "" };
    child.stderr?.on("data", (chunk) => { record.stderr += chunk; });
    children.push(record);
    return child;
  };
  t.after(async () => {
    try {
      const active = (await scannerStatus(root)).activeRun;
      if (active) await cancelScanner(root, active.runId);
    } finally {
      for (const { child } of children) {
        if (child.connected && child.spawnargs.includes("--input-type=module")) child.disconnect();
      }
      const stopped = await closeWithin(children, 6000);
      if (!stopped) {
        // A regression must fail the suite, not make its cleanup wait forever.
        for (const { child } of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        if (!await closeWithin(children, 1000)) {
          for (const { child } of children) {
            child.channel?.unref();
            child.stderr?.destroy();
            child.unref();
          }
        }
      }
      fs.rmSync(base, { recursive: true, force: true });
      assert.equal(stopped, true, `Fixture supervisor did not stop: ${children.map(({ stderr }) => stderr).join("\n")}`);
    }
  });
  return { root, codeRoot, launch, children };
}

function withSupervisorHook(f, source) {
  const hook = path.join(f.codeRoot, "supervisor-fixture.mjs");
  fs.writeFileSync(hook, `
    import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    if (process.argv[1]?.endsWith("scanner-worker.mjs")) {
      ${source}
      syncBuiltinESMExports();
    }
  `);
  return (executable, args, options) => f.launch(executable, args, {
    ...options, env: { ...options.env, NODE_OPTIONS: `${options.env.NODE_OPTIONS || ""} --import=${pathToFileURL(hook).href}`.trim() },
  });
}

async function closeWithin(children, ms) {
  let deadline;
  try {
    return await Promise.race([
      Promise.all(children.map(({ closed }) => closed)).then(() => true),
      new Promise((resolve) => { deadline = setTimeout(resolve, ms, false); }),
    ]);
  } finally { clearTimeout(deadline); }
}

async function terminal(root, runId) {
  for (let attempt = 0; attempt < 150; attempt++) {
    await scannerStatus(root);
    const receipt = readScannerJson(scannerPaths(root, runId).run);
    if (receipt) return receipt;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("Fixture scanner did not finish");
}

function message(child, type) {
  return new Promise((resolve, reject) => {
    const onMessage = (data) => {
      if (data.type !== type) return;
      child.off("message", onMessage);
      child.off("error", reject);
      resolve(data);
    };
    child.on("message", onMessage);
    child.once("error", reject);
  });
}

test("complete requires confirmed zero exit; partial coverage keeps committed counters and exit 2", () => {
  assert.equal(confirmedScanSuccess(scannerReceipt(run, completeCore, 0)), true);
  assert.equal(scannerReceipt(run, completeCore, 7).status, "error");
  const core = { ...completeCore, status: "partial", coverage: { ...completeCore.coverage, status: "partial" } };
  const receipt = scannerReceipt(run, core, 2);
  assert.equal(receipt.status, "partial");
  assert.equal(receipt.newAdded, 1);
  assert.deepEqual(receipt.coverage, core.coverage);
  assert.equal(confirmedScanSuccess(receipt), false);
  assert.equal(scannerReceipt(run, core, 7).status, "error");
  assert.equal(scannerReceipt(run, null, 0).status, "error");
});

test("split layout resolves code from checkout, data from private root; missing code never claims active", async (t) => {
  const f = fixture(t);
  const invocation = scannerInvocation(f.codeRoot, f.root, run);
  assert.equal(invocation.script, path.join(f.codeRoot, "scan.mjs"));
  assert.equal(invocation.cwd, f.root);
  assert.deepEqual(invocation.args, ["--json", "--since", "60", "--fresh"]);
  assert.equal(invocation.env.CAREER_OPS_HTTP_CACHE, "0");
  await assert.rejects(startScanner(f.root, path.join(f.codeRoot, "missing")), /CAREER_OPS_CODE_ROOT/);
  assert.equal((await scannerStatus(f.root)).activeRun, null);
});

test("real supervisor persists nonzero exit as error, never green", { timeout: 12000 }, async (t) => {
  const f = fixture(t, `console.log(${JSON.stringify(JSON.stringify(completeCore))}); process.exitCode = 7;`);
  const started = await startScanner(f.root, f.codeRoot, {}, f.launch);
  const receipt = await terminal(f.root, started.run.runId);
  assert.equal(receipt.status, "error");
  assert.equal(receipt.exitCode, 7);
  assert.equal(receipt.newAdded, 1);
  assert.equal((await scannerStatus(f.root)).activeRun, null);
  assert.equal(confirmedScanSuccess(receipt), false);
});

test("explicit cancel waits for terminal cancelled receipt with unconfirmed counts and preserves applications", { timeout: 20000 }, async (t) => {
  const f = fixture(t, waitingEngine);
  const started = await startScanner(f.root, f.codeRoot, { since: "all" }, f.launch);
  const childPid = await runningEngine(f.root);
  assert.equal(await cancelScanner(f.root, started.run.runId), true);
  const receipt = await terminal(f.root, started.run.runId);
  assert.throws(() => process.kill(childPid, 0), { code: "ESRCH" });
  assert.equal(receipt.status, "cancelled");
  assert.equal(receipt.since, "all");
  assert.equal(receipt.rawFound, null);
  assert.equal(receipt.coverage.attempted, null);
  assert.equal(receipt.coverage.status, "cancelled");
  assert.equal(await cancelScanner(f.root, started.run.runId), false);
  assert.equal(fs.readFileSync(path.join(f.root, "data", "applications.md"), "utf8"), "preserve application decisions\n");
  assert.equal(readScannerEvents(f.root, started.run.runId).at(-1).data.status, "cancelled");
  fs.writeFileSync(path.join(f.codeRoot, "scan.mjs"), completeOutput);
  const next = await startScanner(f.root, f.codeRoot, {}, f.launch);
  assert.equal(next.joined, false);
  assert.notEqual(next.run.runId, started.run.runId);
  assert.equal((await terminal(f.root, next.run.runId)).status, "complete");
});

test("Windows falls back to the owned engine handle when taskkill exits nonzero", { skip: process.platform !== "win32", timeout: 20000 }, async (t) => {
  const f = fixture(t, waitingEngine);
  const launched = withSupervisorHook(f, `childProcess.spawnSync = () => ({ status: 17 });`);
  const started = await startScanner(f.root, f.codeRoot, {}, launched);
  const pid = await runningEngine(f.root);
  assert.equal(await cancelScanner(f.root, started.run.runId), true);
  const receipt = await terminal(f.root, started.run.runId);
  assert.equal(receipt.status, "cancelled");
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("cancellation has a deadline even when engine exit never yields stdio close", { timeout: 15000 }, async (t) => {
  const f = fixture(t, `${completeOutput}\n${waitingEngine}`);
  // Simulate a descendant holding an inherited pipe: the real engine dies,
  // but the close notification never reaches the worker.
  const launched = withSupervisorHook(f, `
    const spawn = childProcess.spawn;
    childProcess.spawn = (...args) => {
      const child = spawn(...args);
      const emit = child.emit;
      child.emit = (event, ...data) => event === "close" ? false : emit.call(child, event, ...data);
      return child;
    };
  `);
  const started = await startScanner(f.root, f.codeRoot, {}, launched);
  const pid = await runningEngine(f.root);
  assert.equal(await cancelScanner(f.root, started.run.runId), true);
  const receipt = await terminal(f.root, started.run.runId);
  assert.equal(receipt.status, "cancelled");
  assert.equal(receipt.newAdded, 1);
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  assert.equal((await scannerStatus(f.root)).blocked, false);
});

test("two independent processes starting simultaneously share one durable run ID and one launch", { timeout: 15000 }, async (t) => {
  const f = fixture(t);
  const moduleUrl = new URL("../../src/lib/scanner-lifecycle.mjs", import.meta.url).href;
  const client = `
    import fs from 'node:fs';
    import { EventEmitter } from 'node:events';
    import { startScanner } from ${JSON.stringify(moduleUrl)};
    process.on('message', async () => {
      try {
        const result = await startScanner(${JSON.stringify(f.root)}, ${JSON.stringify(f.codeRoot)}, {}, () => {
          fs.appendFileSync(${JSON.stringify(path.join(f.root, "launches"))}, 'launch\\n');
          return Object.assign(new EventEmitter(), { pid: process.pid });
        });
        process.send({ type: 'result', runId: result.run.runId, joined: result.joined });
      } catch (error) { process.send({ type: 'result', error: error.message }); }
    });
    process.send({ type: 'ready' });
  `;
  const clients = [0, 1].map(() => f.launch(process.execPath, ["--input-type=module", "-e", client], { stdio: ["ignore", "ignore", "inherit", "ipc"] }));
  await Promise.all(clients.map((child) => message(child, "ready")));
  const results = clients.map((child) => message(child, "result"));
  clients.forEach((child) => child.send("start"));
  const [first, second] = await Promise.all(results);
  assert.equal(first.error, undefined);
  assert.equal(second.error, undefined);
  assert.equal(first.runId, second.runId);
  assert.deepEqual([first.joined, second.joined].sort(), [false, true]);
  assert.equal(fs.readFileSync(path.join(f.root, "launches"), "utf8"), "launch\n");
});

test("stale dead PID is repaired, prior receipt is not active, and old completion cannot clear newer ownership", async (t) => {
  const f = fixture(t);
  const files = scannerPaths(f.root, run.runId);
  writeScannerJson(files.lock, { ...run, ownerPid: 2147483647, workerPid: 2147483647, status: "running" });
  let status = await scannerStatus(f.root);
  assert.equal(status.activeRun, null);
  assert.equal(status.latestCompletedReceipt.status, "error");
  const next = { ...run, runId: randomUUID(), ownerPid: process.pid, workerPid: process.pid, status: "running" };
  writeScannerJson(files.lock, next);
  await finishScannerRun(f.root, scannerReceipt(run, completeCore, 0));
  status = await scannerStatus(f.root);
  assert.equal(status.activeRun.runId, next.runId);
  assert.equal(status.latestCompletedReceipt.status, "error", "an old callback cannot replace the authoritative terminal receipt");
  assert.equal(status.activeRun.ownerPid, undefined);
});

test("orphan recovery emits an error and fences the next run without signalling a PID read from disk", { timeout: 12000 }, async (t) => {
  const f = fixture(t);
  const unrelated = f.launch(process.execPath, ["--input-type=module", "-e", `
    process.on("message", () => {});
    process.send({ type: "ready" });
  `], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  await message(unrelated, "ready");
  const files = scannerPaths(f.root, run.runId);
  writeScannerJson(files.lock, { ...run, ownerPid: 2147483647, workerPid: 2147483647, childPid: unrelated.pid, status: "running" });
  const status = await scannerStatus(f.root);
  assert.equal(status.activeRun, null);
  assert.equal(status.blocked, true);
  assert.equal(status.latestCompletedReceipt.status, "error");
  assert.equal(status.latestCompletedReceipt.newAdded, null);
  assert.equal(readScannerEvents(f.root, run.runId)[0].type, "end");
  await assert.rejects(startScanner(f.root, f.codeRoot, {}, f.launch), { code: "SCANNER_PROCESS_UNCONFIRMED" });
  assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
  unrelated.disconnect();
  assert.equal(await closeWithin([f.children[0]], 6000), true, "Unrelated fixture process did not stop");
  assert.equal((await scannerStatus(f.root)).blocked, false);
  const next = await startScanner(f.root, f.codeRoot, {}, f.launch);
  assert.equal((await terminal(f.root, next.run.runId)).status, "complete");
});

test("late and reconnected readers replay durable events by ID without rerunning scanner", async (t) => {
  const f = fixture(t);
  const files = scannerPaths(f.root, run.runId);
  fs.mkdirSync(path.dirname(files.events), { recursive: true });
  const receipt = scannerReceipt(run, completeCore, 0);
  writeScannerJson(files.run, receipt);
  const events = [{ type: "start", data: run }, { type: "log", data: { text: "fixture" } }];
  const jsonl = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  fs.writeFileSync(files.events, jsonl + "{\"type\":");
  assert.deepEqual(readScannerEvents(f.root, run.runId).map((event) => event.id), [1, 2, 3]);
  const resumed = readScannerEvents(f.root, run.runId, 2);
  assert.equal(resumed.length, 1);
  assert.equal(resumed[0].type, "end");
  assert.equal(resumed[0].data.runId, run.runId);
  assert.deepEqual(readScannerEvents(f.root, run.runId, 3), []);
  // A prior version may already have persisted the end event.
  fs.writeFileSync(files.events, jsonl + JSON.stringify({ type: "end", data: receipt }) + "\n");
  assert.deepEqual(readScannerEvents(f.root, run.runId).map(({ id }) => id), [1, 2, 3]);
  assert.deepEqual(readScannerEvents(f.root, run.runId, 3), []);
});

test("HTTP subscriber abort leaves the run active; Last-Event-ID resumes through confirmed cancellation", { timeout: 12000 }, async (t) => {
  const f = fixture(t, `${completeOutput}\n${waitingEngine}`);
  const restore = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = f.root;
  t.after(() => { if (restore === undefined) delete process.env.CAREER_OPS_ROOT; else process.env.CAREER_OPS_ROOT = restore; });
  const { GET, DELETE } = await import("../../src/app/api/scanner/route.ts");
  const started = await startScanner(f.root, f.codeRoot, {}, f.launch);
  const { runId } = started.run;
  await runningEngine(f.root);
  const url = `http://fixture.invalid/api/scanner?runId=${runId}&stream=1&after=0`;
  const abort = new AbortController();
  const first = await GET(new Request(url, { signal: abort.signal }));
  assert.match(first.headers.get("Content-Type"), /text\/event-stream/);
  const reader = first.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /^id: 1\nevent: start/);
  abort.abort();
  await reader.cancel();
  assert.equal((await scannerStatus(f.root)).activeRun.runId, runId);
  assert.equal(fs.existsSync(scannerPaths(f.root, runId).cancel), false);

  const resumed = await GET(new Request(url, { headers: { "Last-Event-ID": "1" } }));
  assert.equal((await DELETE(new Request(url, { method: "DELETE" }))).status, 202);
  const events = [];
  const receipt = await readScannerStream(resumed, (event) => events.push(event));
  assert.equal(receipt.status, "cancelled");
  assert.equal(receipt.newAdded, 1);
  assert.deepEqual(receipt.coverage, completeCore.coverage);
  assert.equal(events.some(({ type }) => type === "start"), false);
  assert.equal(events.every(({ id }) => id > 1), true);
  assert.equal(events.at(-1).type, "end");
  assert.equal(f.children.length, 1);
});

test("partial source coverage survives supervisor, durable receipt and status without substituting proposed additions", { timeout: 12000 }, async (t) => {
  const core = { ...completeCore, status: "partial", coverage: {
    status: "partial", attempted: 2, succeeded: 1, failed: 1,
    sources: [{ id: "fixture-a", status: "complete", found: 5 }, { id: "fixture-b", status: "error", reason: "fixture unavailable", found: 0 }],
  } };
  const f = fixture(t, `console.log(${JSON.stringify(JSON.stringify(core))}); process.exitCode = 2;`);
  const started = await startScanner(f.root, f.codeRoot, {}, f.launch);
  const receipt = await terminal(f.root, started.run.runId);
  assert.equal(receipt.status, "partial");
  assert.equal(receipt.newAdded, 1);
  assert.equal(receipt.admitted, 3);
  assert.deepEqual(receipt.coverage, core.coverage);
  assert.deepEqual(receipt.discoveries, core.discoveries);
  const status = await scannerStatus(f.root);
  assert.equal(status.activeRun, null);
  assert.equal(status.latestCompletedReceipt.status, "partial");
  assert.deepEqual(status.latestCompletedReceipt.coverage, core.coverage);
  assert.equal(status.latestCompletedReceipt.discoveries, undefined);
});

test("server IPC disconnect cancels its child and persists a terminal receipt", { timeout: 12000 }, async (t) => {
  const f = fixture(t, waitingEngine);
  const started = await startScanner(f.root, f.codeRoot, {}, f.launch);
  const childPid = await runningEngine(f.root);
  f.children[0].child.disconnect();
  const receipt = await terminal(f.root, started.run.runId);
  assert.equal(receipt.status, "cancelled");
  assert.equal(receipt.newAdded, null);
  assert.equal(receipt.coverage.status, "cancelled");
  assert.throws(() => process.kill(childPid, 0), { code: "ESRCH" });
  assert.equal((await scannerStatus(f.root)).activeRun, null);
});

async function runningEngine(root) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const active = readScannerJson(scannerPaths(root).lock);
    if (active?.childPid && readScannerEvents(root, active.runId)
      .some(({ type, data }) => type === "log" && data.text.includes("fixture ready"))) return active.childPid;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("Fixture engine did not start");
}

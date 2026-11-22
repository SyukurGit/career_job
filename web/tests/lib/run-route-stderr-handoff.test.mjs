import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import "../helpers/web-ts-alias-loader.mjs";

// The helper tests in run-cli-support.test.mjs call noOutputError() directly, so they
// would still pass if the route stopped handing it the captured stderr line. This goes
// through the real request handler with a stand-in CLI that prints one stderr line, no
// stdout, and exits 0 (what Antigravity does when headless mode auto-denies a tool).
const cliStub = `export const resolveCli = id => ({ spec: { id, name: "Fixture CLI" }, binPath: "/fixture/never-run" });
export const cliUnavailableError = () => ({ error: "Fixture CLI unavailable" });`;
const spawnStub = `import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
export function spawnHeadlessCli() {
  const plan = globalThis.__fakeCliRun;
  globalThis.__fakeCliSpawns++;
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = null;
  child.pid = 0;
  child.kill = () => true;
  setTimeout(() => {
    if (plan.stdout) child.stdout.write(plan.stdout);
    for (const chunk of plan.stderr) child.stderr.write(chunk);
    child.stdout.end();
    child.stderr.end();
    setTimeout(() => child.emit("close", plan.code, null), 20);
  }, 5);
  return child;
}`;
const realPersist = pathToFileURL(path.resolve(import.meta.dirname, "../../src/lib/report-persist.mjs")).href;
const persistStub = `export * from ${JSON.stringify(realPersist)};
export async function persistEvaluation(payload) {
  globalThis.__fakePersistCalls.push(payload);
  return globalThis.__fakePersistResult;
}`;
register(`data:text/javascript,${encodeURIComponent(`
  export function resolve(specifier, context, nextResolve) {
    const stubs = ${JSON.stringify({ "@/lib/clis": cliStub, "@/lib/spawn-cli.mjs": spawnStub, "@/lib/report-persist.mjs": persistStub })};
    if (Object.hasOwn(stubs, specifier)) return { url: "data:text/javascript," + encodeURIComponent(stubs[specifier]), shortCircuit: true };
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);
const { POST } = await import("../../src/app/api/run/route.ts");

const AGY_LINE =
  'jetski: no output produced — a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied. Add an allow-rule under permissions.allow in settings.json.\n';
const jd = "Full fictional role description: requirements, responsibilities and application details.\n".repeat(4).trimEnd();
const manual = "local:manual/fixture";
const verification = "unconfirmed (candidate-pasted text)";
const report = `# Evaluation: Fixture — Analyst\n\n**URL:** ${manual}\n**Verification:** ${verification}\n\n## A) Role summary\nFictional analyst role.\n\n## Job Description (archived verbatim)\n\n${jd}\n\n---\n\n## Machine Summary\n\n\`\`\`yaml\ncompany: Fixture\nrole: Analyst\nscore: 4.2\n\`\`\``;
const responseText = markdown => `<<report-md>>\n${markdown}\n<</report-md>>\nVERDICT: 4.2/5 — Fictional fit.`;

/** Exercise the real route with no network, model, or production data. */
async function streamedEvents(t, { stderr = [], code = 0, stdout, request = {}, persisted = { ok: true, num: "017", warnings: [] } }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "co-stderr-handoff-"));
  const previousRoot = process.env.CAREER_OPS_ROOT;
  const previousCode = process.env.CAREER_OPS_CODE_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  process.env.CAREER_OPS_CODE_ROOT = root;
  t.after(() => {
    if (previousRoot === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = previousRoot;
    if (previousCode === undefined) delete process.env.CAREER_OPS_CODE_ROOT;
    else process.env.CAREER_OPS_CODE_ROOT = previousCode;
    delete globalThis.__fakeCliRun;
    delete globalThis.__fakeCliSpawns;
    delete globalThis.__fakePersistCalls;
    delete globalThis.__fakePersistResult;
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, "modes"));
  fs.writeFileSync(path.join(root, "modes/oferta.md"), "# Fictional evaluation mode\n");
  fs.writeFileSync(path.join(root, "modes/cover.md"), "# Fictional cover mode\n");
  fs.writeFileSync(path.join(root, "cv.md"), "# Fictional candidate\n");
  globalThis.__fakeCliRun = { stderr, code, stdout };
  globalThis.__fakeCliSpawns = 0;
  globalThis.__fakePersistCalls = [];
  globalThis.__fakePersistResult = persisted;
  const response = await POST(new Request("http://fixture.invalid/api/run", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "evaluate", cliId: "claude", input: manual, brief: { jobDescription: jd }, ...request }),
  }));
  assert.equal(response.status, 200);
  return (await response.text()).split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

test("a clean exit with no stdout streams the CLI's own stderr reason through /api/run", async (t) => {
  const events = await streamedEvents(t, { stderr: [AGY_LINE], code: 0 });
  const error = events.find((event) => event.type === "error");
  assert.ok(error, `expected an error event, got ${JSON.stringify(events)}`);
  assert.match(error.msg, /^The CLI produced no output — is it installed and authenticated\? \(jetski: no output produced/);
  assert.match(error.msg, /headless mode cannot prompt for/);
  assert.equal(events.some((event) => event.type === "done"), false, "a run with no output is never reported as done");
});

test("a clean exit with no stdout and no stderr keeps the generic message", async (t) => {
  const events = await streamedEvents(t, { stderr: [], code: 0 });
  const error = events.find((event) => event.type === "error");
  assert.ok(error, `expected an error event, got ${JSON.stringify(events)}`);
  assert.equal(
    error.msg,
    "The CLI produced no output — is it installed and authenticated?",
  );
});

test("a closed or incomplete local posting gates before any CLI launch", async t => {
  const events = await streamedEvents(t, { request: { brief: { jobDescription: "Title only" } } });
  assert.match(events[0].message, /full posting and its liveness could not be confirmed/);
  assert.equal(events[0].type, "gated");
  assert.equal(globalThis.__fakeCliSpawns, 0);
  assert.equal(globalThis.__fakePersistCalls.length, 0);
});

test("source or archive mismatch cannot persist or display a score", async t => {
  const events = await streamedEvents(t, { stdout: responseText(report.replace(jd, "A rewritten summary.")) });
  assert.equal(globalThis.__fakePersistCalls.length, 0);
  assert.match(events.at(-1).msg, /verbatim/);
  assert.equal(events.some(event => event.type === "done" || event.type === "text"), false);
});

test("the report number and score are emitted only after confirmed persistence", async t => {
  const events = await streamedEvents(t, { stdout: responseText(report) });
  assert.equal(globalThis.__fakePersistCalls.length, 1);
  assert.equal(globalThis.__fakePersistCalls[0].url, manual);
  assert.equal(globalThis.__fakePersistCalls[0].markdown, report);
  assert.deepEqual(events.at(-1), { type: "done", tokens: 0, costUsd: null, reportN: 17 });
  assert.equal(events.at(-2).text, "VERDICT: 4.2/5 — Fictional fit.\n");
});

test("partial persistence is a single failure with no success score", async t => {
  const events = await streamedEvents(t, {
    stdout: responseText(report), persisted: { ok: false, error: "Report exists but tracker merge was not acknowledged." },
  });
  assert.equal(globalThis.__fakePersistCalls.length, 1);
  assert.deepEqual(events.filter(event => ["done", "gated", "text", "error"].includes(event.type)),
    [{ type: "error", msg: "Report exists but tracker merge was not acknowledged." }]);
});

test("cover transport exposes only the validated draft (and never writes a report)", async t => {
  const events = await streamedEvents(t, { request: { kind: "cover" }, stdout: "<<cover-draft>>\nDear hiring team,\nThis is my draft.\n<</cover-draft>>" });
  assert.equal(globalThis.__fakePersistCalls.length, 0);
  assert.deepEqual(events.filter(event => ["done", "gated", "text", "error"].includes(event.type)), [
    { type: "text", text: "Dear hiring team,\nThis is my draft." },
    { type: "done", tokens: 0, costUsd: null },
  ]);
});

test("OMP research and portal repair are refused before invoking any process", async () => {
  for (const kind of ["research", "fix-portal"]) {
    const response = await POST(new Request("http://fixture.invalid/api/run", {
      method: "POST", body: JSON.stringify({ kind, input: "Fixture", cliId: "omp" }),
    }));
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /verified permission adapter.*No replacement/);
  }
});

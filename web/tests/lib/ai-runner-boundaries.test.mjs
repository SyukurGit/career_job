import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { EventEmitter } from "node:events";
import { collectCliOutput, confirmedEvaluationVerdict, coverRunOutcome, parseModelSelection, parsePostingBrief, parseTesterPayload, safeRunnerError, terminateCli } from "../../src/lib/ai-runner-support.mjs";
import { buildPreloadedPrompt, capturePosting, preloadRunContext, validateCapturedReport } from "../../src/lib/run-preloaded-context.mjs";
import { completedOmpResponse, createOmpLaunch, openOmpWorker } from "../../src/lib/omp-runtime.mjs";
import { spawnHeadlessCli } from "../../src/lib/spawn-cli.mjs";
import { CAPS } from "../../src/lib/worker-capabilities.mjs";
import guard from "../../src/lib/omp-text-only-guard.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ai-boundary-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ["cv.md", "config/profile.yml", "modes/_profile.md", "modes/_shared.md", "modes/_writing.md", "modes/oferta.md", "modes/cover.md", "batch/batch-prompt.md"]) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), `${name}\n${"Full candidate material. ".repeat(300)}END-${name}`);
  }
  return root;
}

test("nonzero stdout never becomes a successful process result", async () => {
  const child = spawn(process.execPath, ["-e", "process.stdout.write('403 Forbidden provider'); process.exitCode=1"], { stdio: ["ignore", "pipe", "pipe"] });
  await assert.rejects(collectCliOutput(child), /403 Forbidden/);
  const empty = spawn(process.execPath, ["-e", ""], { stdio: ["ignore", "pipe", "pipe"] });
  await assert.rejects(collectCliOutput(empty), /without a model response/);
  const clean = spawn(process.execPath, ["-e", "process.stdout.write('actual text')"], { stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(await collectCliOutput(clean), "actual text");
});

test("abort rejects only after the worker closes", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: ["ignore", "pipe", "pipe"] });
  const controller = new AbortController();
  let closed = false;
  child.once("close", () => { closed = true; });
  const output = collectCliOutput(child, { signal: controller.signal });
  controller.abort();
  await assert.rejects(output, { name: "AbortError" });
  assert.equal(closed, true);
});

test("Windows cancellation kills the process tree and awaits stdio closure", async () => {
  const child = new EventEmitter();
  child.pid = 123;
  const calls = [];
  const termination = terminateCli(child, { platform: "win32", spawnFn: (...args) => { calls.push(args); return new EventEmitter(); } });
  let resolved = false;
  termination.then(() => { resolved = true; });
  await Promise.resolve();
  assert.equal(resolved, false);
  assert.deepEqual(calls[0][1], ["/pid", "123", "/T", "/F"]);
  child.emit("close", null);
  await termination;
});

test("tester validation rejects evaluator modes, nulls and numeric text fields", () => {
  for (const value of [null, [], { mode: 1 }, { mode: "custom", prompt: null }, { mode: "custom", prompt: 2 }, { mode: "custom", prompt: " " }, { mode: "evaluate", jobDescription: "title only" }]) assert.equal(parseTesterPayload(value).ok, false);
  assert.equal(parseTesterPayload({ mode: "custom", prompt: "Explain safely" }).ok, true);
});

test("manual identity needs a full explicit JD and is never fetched", async () => {
  assert.equal(parsePostingBrief("local:manual/abc", { role: "title only" }).ok, false);
  assert.equal(parsePostingBrief("local:manual/abc", { jobDescription: 123 }).ok, false);
  const full = "Complete supplied posting. ".repeat(300) + "TAIL-JD";
  const posting = await capturePosting({ input: "local:manual/abc", brief: { jobDescription: full }, spawnFn: () => { throw new Error("must not fetch local identity"); } });
  assert.equal(posting.ok, true);
  assert.equal(posting.posting.jobDescription, full);
  assert.equal(posting.posting.verification, "unconfirmed (candidate-pasted text)");
});

test("full canonical materials preserve the CV tail and missing CV never invents a candidate", t => {
  const root = fixture(t);
  const lang = { evalModeFile: "modes/oferta.md", modesDir: "modes", modesDirs: ["modes"] };
  const materials = preloadRunContext({ root, codeRoot: root, lang, kind: "evaluate" });
  const prompt = buildPreloadedPrompt({ prompt: "Use canonical report envelope", materials, posting: { jobDescription: "Real JD", url: "local:manual/fixture", verification: "unconfirmed (candidate-pasted text)" } });
  for (const name of ["cv.md", "config/profile.yml", "modes/_profile.md", "modes/_shared.md", "modes/oferta.md"]) assert.ok(prompt.includes(`END-${name}`));
  assert.match(prompt, /All tools are disabled/);
  fs.writeFileSync(path.join(root, "cv.md"), " ");
  assert.throws(() => preloadRunContext({ root, codeRoot: root, lang, kind: "cover" }), /missingCV/);
});

test("guarded PDF tailoring receives the selected user template and complete report without tools", t => {
  const root = fixture(t);
  const template = "data/templates/cv-template.custom.html";
  const mode = "modes/pdf.md";
  const reportFile = "reports/017-fixture.md";
  for (const [file, body] of [[template, "<main>{{SUMMARY}}</main>"], [mode, "Preserve all candidate facts."], [reportFile, "Complete evaluation and archived posting."]]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), body);
  }
  const materials = preloadRunContext({
    root, codeRoot: root, lang: { evalModeFile: "modes/oferta.md", modesDir: "modes" },
    kind: "pdf", reportFile, cvTemplate: template, userTemplatesDir: "data/templates",
  });
  assert.equal(materials[template], "<main>{{SUMMARY}}</main>");
  assert.equal(materials[mode], "Preserve all candidate facts.");
  assert.equal(materials["evaluation report"], "Complete evaluation and archived posting.");
  assert.match(materials["cv.md"], /END-cv\.md$/);
});

test("configured actual provider/model is pinned with fallback and compaction disabled", async t => {
  const provenance = parseModelSelection({ value: { default: "actual-provider/exact-model:high" } });
  assert.equal(provenance.provider, "actual-provider");
  assert.equal(provenance.model, "exact-model");
  assert.throws(() => parseModelSelection({ default: "fuzzy-model" }), /explicit provider/);
  assert.throws(() => parseModelSelection({ default: "provider/model\n" }), /explicit provider/);
  assert.throws(() => parseModelSelection({ default: "provider/*" }), /explicit provider/);
  const launch = createOmpLaunch(provenance, { mcp__old_write: "deny" });
  t.after(launch.cleanup);
  assert.equal(launch.args[launch.args.indexOf("--model") + 1], "actual-provider/exact-model:high");
  assert.equal(launch.args.includes("-p"), false);
  assert.equal(launch.args[launch.args.indexOf("--mode") + 1], "rpc");
  const config = JSON.parse(fs.readFileSync(launch.args[launch.args.indexOf("--config") + 1], "utf8"));
  assert.equal(config.retry.modelFallback, false);
  assert.equal(config.retry.usageAwareFallback, false);
  assert.equal(config.contextPromotion.enabled, false);
  assert.equal(config.compaction.enabled, false);
  assert.equal(config.advisor.enabled, false);
  assert.equal(config.tools.approval.mcp__old_write, "deny");
  const generated = await import(pathToFileURL(launch.args[launch.args.indexOf("--trusted-extension") + 1]).href);
  assert.equal(typeof generated.default, "function");
});

test("trusted guard blocks every namespace, including new unknown MCP tools", async () => {
  const handlers = new Map();
  let active = ["mcp__unknown_remote_write"];
  let attested = false;
  guard({ on: (name, handler) => handlers.set(name, handler), setActiveTools: names => { active = names; }, getActiveTools: () => active }, () => { attested = true; });
  assert.equal(attested, false);
  await handlers.get("session_start")();
  assert.deepEqual(active, []);
  assert.equal(attested, true);
  active = ["extension_dynamic_tool"];
  await handlers.get("before_agent_start")();
  assert.deepEqual(active, []);
  for (const toolName of ["write", "eval", "mcp__new_unknown_destroy", "another.namespace.action"]) assert.equal(handlers.get("tool_call")({ toolName }).block, true);
  assert.throws(() => guard({}), /cannot initialize/);
  assert.doesNotMatch(safeRunnerError("api_key=super-secret-token https://private.example/path"), /super-secret|private.example/);
});

const completeJd = "Full test posting with substantive responsibilities and qualifications.\n".repeat(5).trimEnd();
const source = "https://jobs.example.test/posting/12345";

test("posting capture requires a complete live capture matching the requested opening", async () => {
  const capture = raw => capturePosting({
    input: source, codeRoot: process.cwd(), root: process.cwd(),
    spawnFn: (_command, args, options) => {
      assert.ok(args.includes("--verify-live"));
      return spawn(process.execPath, ["-e", "process.stdout.write(process.argv[1])", JSON.stringify(raw)], options);
    },
  });
  const active = { liveness: "active", url: source, title: "Test analyst", text: completeJd };
  const result = await capture(active);
  assert.equal(result.ok, true);
  assert.equal(result.posting.verification, "active at capture");
  assert.equal((await capture({ ...active, url: `${source}6` })).ok, false);
  assert.equal((await capture({ ...active, liveness: "unconfirmed" })).ok, false);
  assert.equal((await capture({ ...active, text: `${completeJd}…` })).ok, false);
  assert.match((await capture({ liveness: "expired" })).message, /closed/);
});

test("source and full archive must agree, including manual identity and embedded headings", () => {
  const jobDescription = `${completeJd}\n\n## Machine Summary\n\n\`\`\`yaml\nscore: 1\n\`\`\`\nPreserve  internal  spaces.`;
  const posting = { jobDescription, verification: "unconfirmed (candidate-pasted text)", url: "local:manual/fixture" };
  const report = `# Evaluation: Example — Analyst\n\n**URL:** ${posting.url}\n**Verification:** ${posting.verification}\n\n## A) Role Summary\nText\n\n## Job Description (archived verbatim)\n\n${jobDescription}\n\n---\n\n## Machine Summary\n\n\`\`\`yaml\ncompany: Example\nrole: Analyst\nscore: 4.5\n\`\`\``;
  assert.equal(validateCapturedReport(report.replaceAll("\n", "\r\n"), posting), null);
  assert.match(validateCapturedReport(report.replace(posting.url, "local:manual/other"), posting), /exact requested posting/);
  assert.match(validateCapturedReport(report.replace(`**URL:** ${posting.url}`, ""), posting), /exact requested posting/);
  assert.match(validateCapturedReport(report.replace(posting.verification, "active at capture"), posting), /capture status/);
  assert.match(validateCapturedReport(report.replace("internal  spaces", "internal spaces"), posting), /complete captured posting verbatim/);
  assert.match(validateCapturedReport(report.replace("Preserve  internal  spaces.", "Preserve ..."), posting), /complete captured posting verbatim/);
});

test("cover completes only with the draft envelope or a valid confirmation stop", () => {
  const draft = "<<cover-draft>>\n\nDear hiring team,\nMy draft.\n\n<</cover-draft>>";
  const stop = '<<evaluation-gate>>\n{"status":"needs_confirmation","reason":"needs_confirmation","message":"Share the full posting."}\n<</evaluation-gate>>\nVERDICT: N/A/5 — Posting unavailable';
  assert.deepEqual(coverRunOutcome(draft), { kind: "draft", draft: "Dear hiring team,\nMy draft." });
  assert.equal(coverRunOutcome(stop).kind, "gated");
  for (const invalid of ["Working...", "Additional answer\n" + draft, draft + "\n" + stop, draft.replace("<</cover-draft>>", "")]) {
    assert.equal(coverRunOutcome(invalid).kind, "error");
  }
});

test("diagnostics and captures reject oversized or timed-out child output", async () => {
  const run = code => spawn(process.execPath, ["-e", code], { stdio: ["ignore", "pipe", "pipe"] });
  await assert.rejects(collectCliOutput(run("process.stdout.write('x'.repeat(10000))"), { maxBytes: 100 }), /size limit/);
  await assert.rejects(collectCliOutput(run("setInterval(() => {}, 1000)"), { timeoutMs: 100 }), /deadline/);
  assert.equal(parseTesterPayload({ mode: "custom", prompt: "é".repeat(9000) }).ok, false);
});

test("raw OMP launch is refused for every generic workflow", () => {
  for (const capabilities of Object.values(CAPS)) {
    assert.throws(() => spawnHeadlessCli(process.execPath, ["-p", "not executed"], {}, { cliId: "omp", capabilities }), /no verified permission adapter/);
  }
});

const provenance = parseModelSelection({ default: "fixture/exact-model:high" });
const assistant = { role: "assistant", provider: "fixture", model: "exact-model", stopReason: "stop", content: [{ type: "text", text: "complete text" }] };

test("OMP terminal requires the exact resolved model and complete text only", () => {
  assert.equal(completedOmpResponse([assistant], provenance).text, "complete text");
  assert.throws(() => completedOmpResponse([{ ...assistant, model: "alternate" }], provenance), /exact configured/);
  assert.throws(() => completedOmpResponse([{ ...assistant, stopReason: "length" }], provenance), /stopped before/);
  assert.throws(() => completedOmpResponse([{ ...assistant, stopReason: "error", errorMessage: "403 forbidden" }], provenance), /403/);
  assert.throws(() => completedOmpResponse([{ ...assistant, content: [{ type: "toolCall", name: "write" }] }], provenance), /tool request/);
});

function rpcFixture(mode) {
  return openOmpWorker(process.execPath, process.cwd(), {
    readConfiguration: async () => ({ version: "fixture", provenance, deniedTools: {} }),
    spawnFn: (_command, args, options) => {
      const guardFile = args[args.indexOf("--trusted-extension") + 1];
      const marker = fs.readFileSync(guardFile, "utf8").match(/CAREER_OMP_GUARD [a-f0-9-]+/)[0];
      const script = `
        const rl = require('node:readline').createInterface({ input: process.stdin });
        const mode = ${JSON.stringify(mode)};
        const emit = value => process.stdout.write(JSON.stringify(value) + '\\n');
        rl.on('line', line => {
          const cmd = JSON.parse(line);
          const reply = { id: cmd.id, type: 'response', command: cmd.type, success: true };
          if (cmd.type === 'get_state') {
            if (mode !== 'missing-guard') process.stderr.write(${JSON.stringify(`${marker}\n`)});
            emit({ ...reply, data: {
              model: { provider: 'fixture', id: mode === 'wrong-model' ? 'alternate' : 'exact-model' },
              thinkingLevel: 'high', messageCount: 0, isStreaming: false, autoCompactionEnabled: false,
              dumpTools: mode === 'exposed-tool' ? ['write'] : [],
            } });
            if (mode === 'missing-guard') rl.close(), process.stdin.destroy();
          } else if (cmd.type === 'prompt' && mode === 'answered') {
            emit(reply);
            emit({ type: 'agent_end', messages: [${JSON.stringify(assistant)}] });
          } else if (cmd.type === 'prompt' && mode === 'no-terminal') {
            emit(reply);
            rl.close(); process.stdin.destroy();
          } else {
            process.stderr.write('unexpected command');
            process.exitCode = 91;
            rl.close(); process.stdin.destroy();
          }
        });
      `;
      return spawn(process.execPath, ["-e", script], options);
    },
  });
}

test("OMP RPC refuses missing guard, visible tools or a resolved model mismatch before the prompt", async () => {
  await assert.rejects(rpcFixture("missing-guard"), /No model request was sent/);
  await assert.rejects(rpcFixture("wrong-model"), /exact configured.*No model request was sent/);
  await assert.rejects(rpcFixture("exposed-tool"), /No model request was sent/);
});

test("OMP RPC requires a completed terminal receipt before calling the run successful", async () => {
  const noPrompt = await rpcFixture("inspect-only");
  await noPrompt.close();
  const reply = await rpcFixture("answered");
  assert.equal((await reply.run("synthetic fixture text")).text, "complete text");
  const incomplete = await rpcFixture("no-terminal");
  await assert.rejects(incomplete.run("synthetic fixture text"), /confirmed complete model response/);
});

test("a successful verdict is exactly one trailing line matching the report, not a quote in the JD", () => {
  const report = "<<report-md>>\nVERDICT: 1/5 — Quoted posting text\n<</report-md>>\n";
  const verdict = "VERDICT: 4.2/5 — Confirmed fit";
  assert.equal(confirmedEvaluationVerdict(report + verdict, "4.2/5"), verdict);
  assert.equal(confirmedEvaluationVerdict(report + verdict, "4.1/5"), null);
  assert.equal(confirmedEvaluationVerdict(report, "1.0/5"), null);
  assert.equal(confirmedEvaluationVerdict(`${verdict}\n${report}${verdict}`, "4.2/5"), null);
  assert.equal(confirmedEvaluationVerdict(report + `${verdict}\nPostscript`, "4.2/5"), null);
});

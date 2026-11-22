import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import "../helpers/web-ts-alias-loader.mjs";
import { enrichSavedJobs, readSavedJobs } from "../../src/lib/saved-jobs-store.mjs";
import { authoritativeReportUrl, canonicalPostingKey, matchJobIdentity, mergeJobMetadata } from "../../src/lib/job-identity.mjs";
import { addManualApplication } from "../../src/lib/manual-application.mjs";

const codeRoot = fileURLToPath(new URL("../../../", import.meta.url));
const envKeys = ["CAREER_OPS_ROOT", "CAREER_OPS_CODE_ROOT", "CAREER_OPS_DATA_DIR", "CAREER_OPS_TRACKER", "CAREER_OPS_ADDITIONS", "CAREER_OPS_BATCH_STATE"];
const header = "# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n";
const bookmark = (id, extra = {}) => ({ id, url: `https://jobs.example.test/${id}`, company: `Company ${id}`, role: "Engineer", savedAt: "2026-01-02T00:00:00.000Z", status: "saved", ...extra });

function fixture(t, jobs = [bookmark("one"), bookmark("two"), bookmark("three")]) {
  const root = fs.mkdtempSync(path.join(tmpdir(), "career-saved-behavior-"));
  const prior = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  process.env.CAREER_OPS_ROOT = root;
  process.env.CAREER_OPS_CODE_ROOT = codeRoot;
  process.env.CAREER_OPS_ADDITIONS = "custom-additions";
  fs.mkdirSync(path.join(root, "data"));
  fs.mkdirSync(path.join(root, "reports"));
  const file = path.join(root, "data", "saved-jobs.json");
  const tracker = path.join(root, "data", "applications.md");
  fs.writeFileSync(file, JSON.stringify(jobs, null, 2));
  fs.writeFileSync(tracker, header);
  t.after(() => {
    for (const key of envKeys) {
      if (prior[key] === undefined) delete process.env[key];
      else process.env[key] = prior[key];
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, file, tracker };
}

async function post(body) {
  const { POST } = await import("@/app/api/saved-jobs/route.ts");
  const response = await POST(new Request("http://localhost/api/saved-jobs", { method: "POST", body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json() };
}

for (const [name, input] of [
  ["ID only", { id: "two" }], ["URL only", { url: "https://jobs.example.test/two?utm_source=test" }],
  ["both selectors", { id: "two", url: "https://jobs.example.test/two" }],
]) {
  test(`saved DELETE ${name} removes only its posting and backs up original bytes`, async (t) => {
    const { file } = fixture(t);
    const original = fs.readFileSync(file, "utf8");
    const result = await post({ action: "delete", ...input });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual(readSavedJobs(file).map((job) => job.id), ["one", "three"]);
    const backups = fs.readdirSync(path.dirname(file)).filter((name) => name.startsWith("saved-jobs.json.bak-"));
    assert.equal(backups.length, 1);
    assert.equal(fs.readFileSync(path.join(path.dirname(file), backups[0]), "utf8"), original);
  });
}

test("nonexistent deletion does not rewrite bookmarks or create a backup", async (t) => {
  const { file } = fixture(t);
  const original = fs.readFileSync(file, "utf8");
  const result = await post({ action: "delete", id: "missing" });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(fs.readFileSync(file, "utf8"), original);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["applications.md", "saved-jobs.json"]);
});

test("conflicting bookmark ID and URL cannot delete, toggle, or update either posting", async (t) => {
  const { file, tracker } = fixture(t);
  const bookmarksBefore = fs.readFileSync(file, "utf8");
  const trackerBefore = fs.readFileSync(tracker, "utf8");
  for (const action of ["delete", "toggle", "update_status"]) {
    const result = await post({ action, id: "one", url: "https://jobs.example.test/two", status: "Applied" });
    assert.equal(result.status, 409, JSON.stringify(result.body));
  }
  assert.equal(fs.readFileSync(file, "utf8"), bookmarksBefore);
  assert.equal(fs.readFileSync(tracker, "utf8"), trackerBefore);
});

for (const bytes of ["broken json", "{}", '[{"id":"one","url":"https://jobs.example.test/one"}]']) {
  test(`corrupt bookmarks fail closed on read and write: ${bytes}`, async (t) => {
    const { file } = fixture(t);
    fs.writeFileSync(file, bytes);
    const { GET } = await import("@/app/api/saved-jobs/route.ts");
    assert.equal((await GET()).status, 500);
    const result = await post({ action: "delete", id: "one" });
    assert.equal(result.status, 500);
    assert.equal(fs.readFileSync(file, "utf8"), bytes);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ["applications.md", "saved-jobs.json"]);
  });
}

test("manual upsert preserves original identity, timestamp, status, description and known snapshot facts", async (t) => {
  const original = bookmark("manual-one", { url: "local:manual/manual-one", source: "Recruiter", description: "Complete original job description", status: "interview", postedAt: "2026-01-01", yrs: "3–5", workplaceType: "remote", eligibility: "unknown", firstSeenAt: "2026-01-01T00:00:00Z" });
  const { file } = fixture(t, [original]);
  const result = await post({ action: "manual", id: original.id, title: original.role, company: original.company, notes: "Updated note", postedAt: "", yrs: "", eligibility: "", lastSeenAt: "2026-01-03T00:00:00Z" });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const [saved] = readSavedJobs(file);
  for (const key of ["id", "url", "savedAt", "status", "source", "description", "postedAt", "yrs", "workplaceType", "eligibility", "firstSeenAt"]) assert.equal(saved[key], original[key], key);
  assert.equal(saved.notes, "Updated note");
  assert.equal(saved.lastSeenAt, "2026-01-03T00:00:00Z");
});

test("saved status updates the old no-URL tracker through the authoritative report header", async (t) => {
  const saved = bookmark("one", { company: "Acme", role: "Engineer" });
  const { root, tracker, file } = fixture(t, [saved]);
  fs.writeFileSync(path.join(root, "reports", "007-acme.md"), `# Evaluation: Acme — Engineer\n\n**URL:** ${saved.url}\n\n## Archived JD\nOther link: https://jobs.example.test/unrelated\n`);
  fs.writeFileSync(tracker, `${header}| 7 | 2026-01-01 | Acme | Engineer | 4.1/5 | Evaluated | ❌ | [7](../reports/007-acme.md) | original notes |\n`);
  const originalBookmarks = fs.readFileSync(file, "utf8");
  const result = await post({ action: "update_status", id: "one", status: "applied" });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.job.applicationStatus, "Applied");
  assert.equal(result.body.job.trackerN, "7");
  assert.match(fs.readFileSync(tracker, "utf8"), /\| Applied \|/);
  assert.equal(fs.readFileSync(file, "utf8"), originalBookmarks, "canonical status must not be copied into a second bookmark tracker");
  assert.equal(fs.existsSync(path.join(root, "custom-additions")), false, "must not append a duplicate manual application");
});

test("untracked pasted job creates a real manual tracker addition without fabricating an evaluation", async (t) => {
  const saved = bookmark("manual-one", { url: "local:manual/manual-one", description: "A complete pasted job description", notes: "User notes", source: "Manual" });
  const { root, tracker, file } = fixture(t, [saved]);
  const result = await post({ action: "update_status", id: saved.id, status: "applied" });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.job.applicationStatus, "Applied");
  assert.ok(result.body.job.trackerN);
  const text = fs.readFileSync(tracker, "utf8");
  assert.match(text, /\| Applied \|/);
  assert.match(text, /local:manual\/manual-one/);
  assert.match(text, /Manual job ID: manual-one/);
  assert.doesNotMatch(text, /Evaluated|\d\.\d\/5|\]\(.*reports\//);
  assert.deepEqual(fs.readdirSync(path.join(root, "reports")), []);
  assert.equal(readSavedJobs(file)[0].description, saved.description);
  const archive = path.join(root, "custom-additions", "merged");
  assert.equal(fs.readdirSync(archive).filter((name) => name.endsWith(".tsv")).length, 1);
  const again = await post({ action: "update_status", id: saved.id, status: "interview" });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.job.applicationStatus, "Interview");
  assert.equal(fs.readFileSync(tracker, "utf8").split("\n").filter((line) => /^\| \d+ \|/.test(line)).length, 1);
});

test("report identity never matches an unrelated URL mentioned in archived text", () => {
  const target = { url: "https://jobs.example.test/7", company: "Acme", role: "Engineer" };
  const wrong = { company: target.company, role: target.role, url: authoritativeReportUrl(`# Evaluation: Acme — Engineer\n\n**URL:** https://jobs.example.test/70\n\n## JD\nSee ${target.url}`) };
  assert.equal(matchJobIdentity(target, [wrong]).match, null);
  assert.equal(authoritativeReportUrl(`# Evaluation: Acme — Engineer\n\n## JD\n**URL:** ${target.url}`), "");
  assert.equal(authoritativeReportUrl(`# Evaluation: Acme — Engineer\n\n**URL:** [Original posting](${target.url})\n\n## JD`), target.url);
  assert.equal(matchJobIdentity(target, [{ ...target }, { ...target }]).ambiguous, true);
  const glints = "https://glints.com/id/opportunities/jobs/old-title/12345678-1234-1234-1234-123456789abc";
  assert.equal(canonicalPostingKey(glints), canonicalPostingKey(glints.replace("old-title", "new-title")));
  assert.notEqual(canonicalPostingKey(glints), canonicalPostingKey(glints.replace("789abc", "789abd")));
});

test("metadata and tracker status are enriched without mutating the bookmark", () => {
  const saved = bookmark("one", { description: "Pasted JD", status: "interview", postedAt: "2026-01-01" });
  const [enriched] = enrichSavedJobs([saved], [{ n: "7", url: saved.url, company: saved.company, role: saved.role, status: "Applied", score: "4.2/5" }]);
  assert.equal(enriched.status, "applied");
  assert.equal(enriched.applicationStatus, "Applied");
  assert.equal(saved.status, "interview");
  const merged = mergeJobMetadata(saved, { url: saved.url, location: "Aceh", postedAt: "2026-01-02", yrs: "5", description: undefined });
  assert.equal(merged.description, "Pasted JD");
  assert.equal(merged.postedAt, "2026-01-02");
  assert.equal(merged.yrs, "5");
});

test("cross-process bookmark mutations hold the file lock across read, backup and write", { timeout: 20_000 }, async (t) => {
  const { file } = fixture(t, []);
  const storeUrl = new URL("../../src/lib/saved-jobs-store.mjs", import.meta.url).href;
  const writerUrl = new URL("../../src/lib/core/safe-write.ts", import.meta.url).href;
  const lockFile = path.join(codeRoot, "pipeline-lock.mjs");
  const source = `import { mutateSavedJobs, applyBookmarkMutation } from ${JSON.stringify(storeUrl)};\nimport { atomicWriteWithBackup } from ${JSON.stringify(writerUrl)};\nconst [file, lockFile, id] = process.argv.slice(1);\nif (id === 'second') process.send?.('attempting');\nawait mutateSavedJobs(file, lockFile, atomicWriteWithBackup, async (jobs) => {\n process.send?.('locked');\n if (id === 'first') await new Promise(resolve => process.once('message', resolve));\n return applyBookmarkMutation(jobs, { action: 'manual', id, title: 'Engineer', company: id });\n});\nprocess.disconnect?.();`;
  const start = (id) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", source, file, lockFile, id], { stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const done = once(child, "exit").then(([code]) => assert.equal(code, 0, stderr));
    return { child, done };
  };
  const first = start("first");
  await once(first.child, "message");
  const second = start("second");
  const events = [];
  second.child.on("message", (message) => events.push(message));
  assert.equal((await once(second.child, "message"))[0], "attempting");
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.deepEqual(events, ["attempting"], "the second process must not read while the first holds the lock");
  assert.equal(fs.existsSync(`${file}.lock`), true);
  first.child.send("release");
  await Promise.all([first.done, second.done]);
  assert.deepEqual(new Set(readSavedJobs(file).map((job) => job.id)), new Set(["first", "second"]));
  assert.equal(fs.existsSync(`${file}.lock`), false);
  assert.equal(fs.readdirSync(path.dirname(file)).filter((name) => name.startsWith("saved-jobs.json.bak-")).length, 2);
});

test("Glints slug updates retain the old bookmark ID and metadata without touching another UUID", async (t) => {
  const uuid = "12345678-1234-1234-1234-123456789abc";
  const oldUrl = `https://glints.com/id/opportunities/jobs/old-title/${uuid}`;
  const newUrl = oldUrl.replace("old-title", "new-title");
  const old = bookmark("old-url-hash", { url: oldUrl, company: "Acme", role: "Engineer", description: "Original pasted description", postedAt: "2026-01-01" });
  const distinct = bookmark("different-uuid", { ...old, id: "different-uuid", url: oldUrl.replace("789abc", "789abd") });
  const { file } = fixture(t, [old, distinct]);
  const result = await post({ action: "add", job: { id: "new-url-hash", url: newUrl, company: old.company, role: old.role, yrs: "3–5" } });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.job.id, old.id);
  const rows = readSavedJobs(file);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, old.id);
  assert.equal(rows[0].description, old.description);
  assert.equal(rows[0].postedAt, old.postedAt);
  assert.equal(rows[0].yrs, "3–5");
  const toggled = await post({ action: "toggle", id: "new-url-hash", url: newUrl, job: { company: old.company, role: old.role } });
  assert.equal(toggled.body.id, old.id);
  assert.equal(toggled.status, 200, JSON.stringify(toggled.body));
  assert.deepEqual(readSavedJobs(file), [distinct]);
});

test("manual tracker creation keeps a pending TSV on missing acknowledgement and retries it unchanged", async (t) => {
  const { root } = fixture(t, []);
  const job = bookmark("manual-retry", { url: "local:manual/manual-retry" });
  const options = { root, job, status: "Applied", write: (file, text) => fs.writeFileSync(file, text) };
  let pending;
  await assert.rejects(addManualApplication({ ...options, runMerge: async (args) => {
    pending = path.join(root, "custom-additions", args[1]);
    assert.ok(fs.existsSync(pending));
    return { code: 0, stdout: "" };
  } }), /belum dikonfirmasi/);
  const bytes = fs.readFileSync(pending, "utf8");
  const n = await addManualApplication({ ...options, status: "Interview", runMerge: async (args) => {
    assert.equal(fs.readFileSync(pending, "utf8"), bytes, "retry must not rewrite an in-flight addition");
    return { code: 0, stdout: JSON.stringify({ ok: true, tsv: args[1], trackerRow: 7 }) };
  } });
  assert.equal(n, "7");
  assert.deepEqual(fs.readdirSync(path.join(root, "reports")), []);
});

test("bookmark snapshots retain explicit closing metadata across incomplete updates", async (t) => {
  const { file } = fixture(t, []);
  const job = bookmark("closing", { closesAt: "2026-12-01", postingStatus: "open" });
  const added = await post({ action: "add", job });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  assert.equal(readSavedJobs(file)[0].closesAt, job.closesAt);
  assert.equal(readSavedJobs(file)[0].postingStatus, "open");
  const updated = await post({ action: "add", job: { ...job, closesAt: "", postingStatus: "" } });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(readSavedJobs(file)[0].closesAt, job.closesAt);
  assert.equal(readSavedJobs(file)[0].postingStatus, "open");
});

test("personal notes and generated cover drafts persist permanently on bookmarks and preserve fail-closed validation", async (t) => {
  const { file } = fixture(t, [bookmark("one")]);
  const noteRes = await post({ action: "update_notes", id: "one", notes: "HRD minta portofolio Go & Next.js" });
  assert.equal(noteRes.status, 200, JSON.stringify(noteRes.body));
  assert.equal(readSavedJobs(file)[0].notes, "HRD minta portofolio Go & Next.js");

  const coverRes = await post({
    action: "save_cover",
    id: "one",
    coverDraft: "Yth. Tim Rekrutmen, saya tertarik melamar posisi Backend Engineer.",
    coverProvider: "github-copilot",
    coverModel: "claude-sonnet-4",
    coverSource: "live",
  });
  assert.equal(coverRes.status, 200, JSON.stringify(coverRes.body));
  const stored = readSavedJobs(file)[0];
  assert.equal(stored.coverDraft, "Yth. Tim Rekrutmen, saya tertarik melamar posisi Backend Engineer.");
  assert.equal(stored.coverProvider, "github-copilot");
  assert.equal(stored.coverModel, "claude-sonnet-4");
  assert.ok(stored.coverDraftAt);

  // Conflict check must still fail closed with 409
  const { file: conflictFile } = fixture(t, [bookmark("one"), bookmark("two")]);
  const conflictRes = await post({ action: "save_cover", id: "one", url: "https://jobs.example.test/two", coverDraft: "Draft" });
  assert.equal(conflictRes.status, 409);
  assert.equal(readSavedJobs(conflictFile)[0].coverDraft, undefined);

  // Upsert on-the-fly from detail page creates valid bookmark cleanly
  const upsertNote = await post({
    action: "update_notes",
    id: "new-detail-id",
    notes: "Follow up Senin",
    job: { id: "new-detail-id", url: "https://jobs.example.test/new", company: "New Co", role: "Backend Developer" },
  });
  assert.equal(upsertNote.status, 200);
  assert.equal(readSavedJobs(conflictFile)[0].notes, "Follow up Senin");
});

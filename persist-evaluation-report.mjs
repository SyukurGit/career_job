#!/usr/bin/env node
/**
 * persist-evaluation-report.mjs
 *
 * Write one evaluation report and one headed tracker-addition TSV.
 * Stdin is one JSON object:
 * { markdown, num, today, company, role, score, via, url, notes, reportFile }
 *
 * The web app validates the report, reserves the number, and merges.
 * This script does neither. It writes under the process cwd, which the
 * caller sets to the data root.
 *
 * Success prints {"ok":true, tsv, reportFile} and exits 0. Failure prints on
 * stderr and exits 1; complete published artifacts remain safe to retry.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isMainModule } from "./lib/is-main-module.mjs";
import { isPostingUrl, trackerTsvLine } from "./lib/tracker-addition.mjs";

const ISO_DATE_RE = /^20\d{2}-\d{2}-\d{2}$/;
const NUM_RE = /^\d{3,}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SCORE_RE = /^\d+\.\d\/5$/;
const TSV_BREAK = /[\t\r\n]/;

function fail(error) {
  return { ok: false, error };
}

/** tsvSafe collapses tabs. This writer refuses them instead. */
function textProblem(name, value) {
  if (typeof value !== "string") return `${name} must be a string`;
  if (TSV_BREAK.test(value)) return `${name} has a tab or newline`;
  return null;
}

/**
 * @param {string} root
 * @param {object} payload
 * @param {Partial<typeof fs>} [fsImpl]
 * @returns {{ok: true, tsv: string, reportFile: string} | {ok: false, error: string}}
 */
export function writeEvaluationArtifacts(root, payload, fsImpl = fs) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fail("expected one JSON object");
  }
  const { markdown, num, today, company, role, score, notes, reportFile } = payload;
  const via = payload.via == null || payload.via === "" ? null : payload.via;
  const url = payload.url == null || payload.url === "" ? "" : payload.url;

  if (typeof markdown !== "string" || markdown.length === 0) return fail("markdown is required");
  if (typeof num !== "string" || !NUM_RE.test(num)) return fail(`unusable report number "${num}"`);
  if (typeof today !== "string" || !ISO_DATE_RE.test(today)) return fail(`invalid evaluation date "${today}"`);
  if (typeof reportFile !== "string" || path.basename(reportFile) !== reportFile || reportFile.includes("..")) {
    return fail(`refusing to write report "${reportFile}"`);
  }
  for (const [name, value] of [["num", num], ["today", today], ["company", company], ["role", role], ["score", score], ["notes", notes]]) {
    const problem = textProblem(name, value);
    if (problem) return fail(problem);
  }
  if (!company || !role) return fail("company and role are required");
  if (via != null) {
    const problem = textProblem("via", via);
    if (problem) return fail(problem);
  }
  if (url !== "") {
    const problem = textProblem("url", url);
    if (problem) return fail(problem);
    if (!isPostingUrl(url) && !/^local:manual\/[A-Za-z0-9_-]+$/.test(url)) {
      return fail("url is not an http(s) posting URL or a manual job ID");
    }
  }
  if (!SCORE_RE.test(score)) return fail(`score is not an X.X/5 cell: "${score}"`);
  const scoreN = Number(score.slice(0, score.length - 2));
  if (!Number.isFinite(scoreN) || scoreN < 0 || scoreN > 5) return fail(`score is out of range: "${score}"`);

  const prefix = `${num}-`;
  const suffix = `-${today}.md`;
  if (!reportFile.startsWith(prefix) || !reportFile.endsWith(suffix)) {
    return fail("reportFile does not match the report number and date");
  }
  const slug = reportFile.slice(prefix.length, reportFile.length - suffix.length);
  if (!SLUG_RE.test(slug)) return fail(`report slug is not a single path segment: "${slug}"`);

  const reportsDir = path.join(root, "reports");
  const additionsDir = path.resolve(root, process.env.CAREER_OPS_ADDITIONS || path.join("batch", "tracker-additions"));
  const reportPath = path.join(reportsDir, reportFile);
  const tsvPath = path.join(additionsDir, `${num}-${slug}.tsv`);
  if (path.dirname(reportPath) !== reportsDir || path.dirname(tsvPath) !== additionsDir) {
    return fail("refusing to persist outside reports/ or batch/tracker-additions/");
  }

  const tsv = trackerTsvLine({ num, today, company, role, score, reportFile, notes, via, url });
  const io = { ...fs, ...fsImpl };
  const staged = [];
  try {
    io.mkdirSync(reportsDir, { recursive: true });
    io.mkdirSync(additionsDir, { recursive: true });
    for (const [filePath, content] of [[reportPath, markdown], [tsvPath, tsv]]) {
      if (io.existsSync(filePath)) {
        if (io.readFileSync(filePath, "utf8") !== content) throw new Error(`refusing to overwrite existing ${path.basename(filePath)}`);
        continue;
      }
      const temp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
      staged.push({ temp, filePath });
      const fd = io.openSync(temp, "wx");
      try { io.writeFileSync(fd, content, "utf8"); io.fsyncSync(fd); }
      finally { io.closeSync(fd); }
    }
    // Publish complete bytes only. Hard-link creation is exclusive: a concurrent
    // writer cannot replace either artifact between the existence check and here.
    for (const { temp, filePath } of staged) {
      io.linkSync(temp, filePath);
      io.unlinkSync(temp);
    }
  } catch (err) {
    for (const { temp } of staged) {
      try { io.unlinkSync(temp); } catch { /* preserve the original failure */ }
    }
    // A report published before a TSV failure is retained, never truncated or
    // rolled back. Replaying identical input safely completes the missing half.
    return fail(`Could not save the evaluation artifacts (existing files retained; retry is safe): ${err.message}`);
  }
  return { ok: true, tsv: path.basename(tsvPath), reportFile };
}


function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

const USAGE_LINES = [
  "Usage: node persist-evaluation-report.mjs < payload.json",
  "",
  "Read one JSON object on stdin and write the evaluation report plus a",
  "headed tracker-addition TSV under the process cwd (the data root).",
  "Does not reserve a report number and does not merge the tracker.",
  "",
  "  --help, -h    print this help and exit",
];

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${USAGE_LINES.join("\n")}\n`);
    return;
  }
  if (args.length > 0) {
    process.stderr.write(`persist-evaluation-report: unrecognized argument: ${args[0]}\n${USAGE_LINES.join("\n")}\n`);
    process.exitCode = 1;
    return;
  }
  let payload;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    process.stderr.write("stdin is not one JSON object\n");
    process.exitCode = 1;
    return;
  }
  const result = writeEvaluationArtifacts(process.cwd(), payload);
  if (!result.ok) {
    process.stderr.write(`${result.error}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}

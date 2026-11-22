import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { mergeAcknowledgement } from "./report-persist.mjs";

export function manualAddition(job, status, today) {
  const clean = (value) => String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
  const notes = `Manual job ID: ${clean(job.id)}; ${clean(job.notes)}`;
  return ["num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl\tlocation",
    [1, today, job.company, job.role, status, "—", "❌", "—", notes, job.url, job.location || "—"].map(clean).join("\t"), ""].join("\n");
}

export async function addManualApplication({ root, job, status, runMerge, write }) {
  const dir = path.resolve(root, process.env.CAREER_OPS_ADDITIONS || path.join("batch", "tracker-additions"));
  const key = createHash("sha256").update(job.id).digest("hex").slice(0, 24);
  const tsv = `manual-${key}.tsv`;
  const file = path.join(dir, tsv);
  fs.mkdirSync(dir, { recursive: true });
  // Retry the existing pending addition unchanged, never rewrite an in-flight TSV.
  if (!fs.existsSync(file)) write(file, manualAddition(job, status, new Date().toISOString().slice(0, 10)));
  const result = await runMerge(["--ack-tsv", tsv]);
  const receipt = result.code === 0 && mergeAcknowledgement(result.stdout, tsv);
  if (!receipt) throw Object.assign(new Error("Lamaran belum dikonfirmasi tersimpan di tracker; bookmark tetap aman. Coba lagi."), { status: 503 });
  return String(receipt.trackerRow);
}

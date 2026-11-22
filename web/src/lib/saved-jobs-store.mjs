import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { canonicalPostingKey, makeJobId, matchJobIdentity } from "./job-identity.mjs";

const STRING_FIELDS = ["id", "url", "company", "role", "savedAt", "location", "compensation", "source", "description", "notes", "status", "postedAt", "yrs", "firstSeenAt", "lastSeenAt", "sourceUpdatedAt", "closesAt", "postingStatus", "workplaceType", "eligibility", "eligibilityReason", "evaluatedScore", "reportFile", "coverDraft", "coverDraftAt", "coverProvider", "coverModel", "coverSource"];
export function validateSavedJobs(value) {
  if (!Array.isArray(value)) throw new Error("saved-jobs.json must contain an array; restore its backup before editing bookmarks");
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)
      || ["id", "url", "company", "role", "savedAt"].some((field) => typeof row[field] !== "string" || !row[field].trim())
      || STRING_FIELDS.some((field) => row[field] != null && typeof row[field] !== "string")
      || !Number.isFinite(Date.parse(row.savedAt))
      || (row.status && !["saved", "applied", "interview", "rejected", "discarded"].includes(row.status))
      || (row.workplaceType && !["remote", "hybrid", "onsite", "unknown"].includes(row.workplaceType))
      || (row.eligibility && !["eligible", "restricted", "unknown"].includes(row.eligibility))
      || (row.postingStatus && !["open", "closed", "unknown"].includes(row.postingStatus))) {
      throw new Error("saved-jobs.json contains an invalid bookmark; no changes were written");
    }
  }
  return value;
}
export function readSavedJobs(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  try { return validateSavedJobs(JSON.parse(text)); }
  catch (error) { throw new Error(`Bookmarks cannot be read safely: ${error.message}`, { cause: error }); }
}

export async function mutateSavedJobs(file, lockModule, write, mutate) {
  const { withPipelineLock } = await import(/* webpackIgnore: true */ pathToFileURL(lockModule).href);
  return withPipelineLock(file, async () => {
    const jobs = readSavedJobs(file);
    const before = JSON.stringify(jobs);
    const result = await mutate(jobs);
    validateSavedJobs(jobs);
    if (JSON.stringify(jobs) !== before) write(file, JSON.stringify(jobs, null, 2));
    return { ...result, jobs };
  });
}

export function findBookmarkIndex(jobs, id, url) {
  const index = id ? jobs.findIndex(row => row.id === id) : -1;
  if (!url) return index;
  const key = canonicalPostingKey(url) || url;
  const matchesUrl = (row) => (canonicalPostingKey(row.url) || row.url) === key;
  if (index < 0) return jobs.findIndex(matchesUrl);
  if (!matchesUrl(jobs[index])) {
    throw Object.assign(new Error("ID dan URL menunjuk lowongan yang berbeda."), { status: 409 });
  }
  return index;
}

function upsertBookmarkEntry(jobs, body, index, action, now) {
  const incoming = body.job || {};
  const id = String(body.id || incoming.id || "").trim();
  const url = String(body.url || incoming.url || "").trim();
  const role = String(incoming.role || body.title || body.role || "").trim();
  const company = String(incoming.company || body.company || "").trim();
  if (!role || !company) throw Object.assign(new Error("Posisi dan perusahaan wajib diisi"), { status: 400 });
  const previous = index >= 0 ? jobs[index] : null;
  const jobId = previous?.id || id || (url ? makeJobId(url, company, role) : `manual-${randomUUID()}`);
  const snapshot = { ...incoming, company, role };
  for (const field of STRING_FIELDS) if (body[field] !== undefined && !["status", "savedAt", "id"].includes(field)) snapshot[field] = body[field];
  for (const key of Object.keys(snapshot)) if (!STRING_FIELDS.includes(key) || snapshot[key] === undefined) delete snapshot[key];
  // An incomplete catalogue snapshot must not erase previously known facts.
  // Notes/description remain editable text and can deliberately be cleared.
  if (previous) {
    for (const field of ["location", "compensation", "postedAt", "yrs", "firstSeenAt", "lastSeenAt", "sourceUpdatedAt", "closesAt", "postingStatus", "workplaceType", "eligibility", "eligibilityReason", "coverDraft", "coverDraftAt", "coverProvider", "coverModel", "coverSource"]) {
      if (snapshot[field] == null || snapshot[field] === "") delete snapshot[field];
    }
  }
  const job = { ...(previous || {}), ...snapshot, id: jobId, url: url || previous?.url || `local:manual/${jobId}`, savedAt: previous?.savedAt || now, status: previous?.status || "saved", source: previous?.source || snapshot.source || (action === "manual" ? "Manual" : undefined) };
  if (previous) jobs[index] = job; else jobs.unshift(job);
  return { index: previous ? index : 0, job };
}

export function applyBookmarkMutation(jobs, body, now = new Date().toISOString()) {
  const action = body.action || "toggle";
  const incoming = body.job || {};
  const id = String(body.id || incoming.id || "").trim();
  const url = String(body.url || incoming.url || "").trim();
  const index = findBookmarkIndex(jobs, id, url);
  if (action === "delete") {
    if (!id && !url) throw Object.assign(new Error("ID atau URL lowongan dibutuhkan"), { status: 400 });
    if (index >= 0) jobs.splice(index, 1);
    return { action: "deleted" };
  }
  if (action === "update_notes" || action === "save_cover") {
    let targetIndex = index;
    if (targetIndex < 0) {
      const role = String(incoming.role || body.title || body.role || "").trim();
      const company = String(incoming.company || body.company || "").trim();
      if (!role || !company) throw Object.assign(new Error("Lowongan tidak ditemukan"), { status: 404 });
      targetIndex = upsertBookmarkEntry(jobs, body, -1, "add", now).index;
    }
    const updated = { ...jobs[targetIndex] };
    if (action === "update_notes") {
      if (typeof body.notes !== "string") throw Object.assign(new Error("Catatan harus berupa teks"), { status: 400 });
      if (body.notes.trim()) updated.notes = body.notes.trim();
      else delete updated.notes;
      jobs[targetIndex] = updated;
      return { action: "notes_updated", jobId: updated.id, job: updated };
    }
    if (typeof body.coverDraft !== "string" || !body.coverDraft.trim()) {
      throw Object.assign(new Error("Teks draf surat lamaran wajib diisi"), { status: 400 });
    }
    updated.coverDraft = body.coverDraft;
    updated.coverDraftAt = typeof body.coverDraftAt === "string" && body.coverDraftAt.trim() ? body.coverDraftAt.trim() : now;
    for (const [key, src] of [["coverProvider", body.coverProvider], ["coverModel", body.coverModel], ["coverSource", body.coverSource]]) {
      if (typeof src === "string" && src.trim()) updated[key] = src.trim();
      else delete updated[key];
    }
    jobs[targetIndex] = updated;
    return { action: "cover_saved", jobId: updated.id, job: updated };
  }
  if (action !== "manual" && action !== "toggle" && action !== "add") throw Object.assign(new Error("Unknown bookmark action"), { status: 400 });
  if (action === "toggle" && index >= 0) {
    const [removed] = jobs.splice(index, 1);
    return { action: "removed", saved: false, id: removed.id };
  }
  const { job } = upsertBookmarkEntry(jobs, body, index, action, now);
  return { action: action === "manual" ? "manual_saved" : "added", saved: true, id: job.id, job };
}

export function enrichSavedJobs(jobs, applications) {
  return jobs.map((job) => {
    const identity = matchJobIdentity(job, applications);
    const app = identity.match;
    const label = String(app?.status || "").replace(/\*/g, "").toLowerCase();
    const status = label.includes("interview") ? "interview" : label.includes("reject") ? "rejected" : label.includes("discard") ? "discarded" : label.includes("applied") ? "applied" : "saved";
    return { ...job, status, ...(app ? { trackerN: app.n, applicationStatus: app.status, evaluatedScore: app.score } : {}), ...(identity.ambiguous ? { identityWarning: "Beberapa lamaran cocok; pilih baris tracker yang benar sebelum mengubah status." } : {}) };
  });
}

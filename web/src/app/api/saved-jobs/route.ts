import { NextResponse } from "next/server";
import path from "node:path";
import { careerOpsRoot, rootScript, readApplications } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { canonicalizeStatus } from "@/lib/core/states";
import { runCoreCli } from "@/lib/core-cli";
import { readJsonObject } from "@/lib/json-body";
import { readSavedJobsFromDisk } from "@/lib/saved-jobs";
import { applyBookmarkMutation, enrichSavedJobs, findBookmarkIndex, mutateSavedJobs } from "@/lib/saved-jobs-store.mjs";
import { matchJobIdentity } from "@/lib/job-identity.mjs";
import { addManualApplication } from "@/lib/manual-application.mjs";
import { POST as updateTrackerStatus } from "@/app/api/status/route";
import type { SavedJob } from "@/lib/saved-job";

export const runtime = "nodejs";

function failure(error: unknown) {
  const e = error as Error & { status?: number; code?: string };
  console.error("/api/saved-jobs:", e.message);
  return NextResponse.json({ ok: false, error: e.status ? e.message : "Bookmark tidak dapat dibaca/disimpan dengan aman. Periksa saved-jobs.json dan backup; tidak ada data yang ditimpa." }, { status: e.status || (e.code === "LOCK_TIMEOUT" ? 503 : 500) });
}

export async function GET() {
  try { return NextResponse.json({ ok: true, jobs: readSavedJobsFromDisk() }); }
  catch (error) { return failure(error); }
}

export async function POST(req: Request) {
  const body = await readJsonObject<Record<string, unknown> & { job?: Partial<SavedJob>; id?: string; url?: string; action?: string; status?: string }>(req);
  if (!body) return NextResponse.json({ ok: false, error: "Format request tidak valid" }, { status: 400 });
  try {
    // The core lock protocol covers the complete read/modify/backup/write,
    // including other Next workers/processes, not merely this event loop.
    const result = await mutateSavedJobs(
      path.join(careerOpsRoot(), "data", "saved-jobs.json"),
      path.join(path.dirname(rootScript("merge-tracker")), "pipeline-lock.mjs"),
      atomicWriteWithBackup,
      async (jobs: SavedJob[]) => {
        if (body.action !== "update_status") return applyBookmarkMutation(jobs, body);
        const id = body.id || body.job?.id || "";
        const url = body.url || body.job?.url || "";
        const existingIndex = findBookmarkIndex(jobs, id, url);
        let job = jobs[existingIndex];
        if (!job) {
          if (body.job?.role && body.job?.company) {
            job = applyBookmarkMutation(jobs, { action: "add", id, url, job: body.job }).job;
          } else {
            throw Object.assign(new Error("Lowongan tidak ditemukan"), { status: 404 });
          }
        }
        const requested = body.status || body.job?.status;
        if (requested === "saved") throw Object.assign(new Error("Tersimpan adalah bookmark, bukan status lamaran. Gunakan tracker untuk status lamaran."), { status: 400 });
        const status = typeof requested === "string" ? canonicalizeStatus(requested) : null;
        if (!status) throw Object.assign(new Error("Status lamaran tidak valid"), { status: 400 });
        const identity = matchJobIdentity(job, readApplications());
        if (identity.ambiguous) throw Object.assign(new Error("Beberapa baris tracker cocok. Ubah status langsung pada baris tracker yang benar."), { status: 409 });
        const n = identity.match?.n || await addManualApplication({ root: careerOpsRoot(), job, status, write: atomicWriteWithBackup, runMerge: (args: string[]) => runCoreCli("merge-tracker", args) });
        const response = await updateTrackerStatus(new Request("http://localhost/api/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ n, status }) }));
        const saved = await response.json();
        if (!response.ok || !saved.ok) throw Object.assign(new Error(saved.error || "Status tracker gagal disimpan"), { status: response.status });
        return { action: "status_updated", jobId: job.id };
      },
    );
    const jobs = enrichSavedJobs(result.jobs, readApplications()) as SavedJob[];
    const jobId = result.jobId || result.job?.id;
    return NextResponse.json({ ok: true, ...result, jobs, ...(jobId ? { job: jobs.find((job) => job.id === jobId) } : {}) });
  } catch (error) { return failure(error); }
}

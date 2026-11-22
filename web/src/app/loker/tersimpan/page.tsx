import { Suspense } from "react";
import { pipelineSummary, readApplications, withCloseDates } from "@/lib/career-ops";
import { readSavedJobsFromDisk } from "@/lib/saved-jobs";
import { pipelineStageCounts } from "@/lib/pipeline-insights.mjs";
import { matchJobIdentity } from "@/lib/job-identity.mjs";
import { SavedView } from "@/components/loker/saved-view";

export const dynamic = "force-dynamic";

export default async function SavedJobsPage() {
  const rawSaved = readSavedJobsFromDisk();
  const apps = await withCloseDates(readApplications());
  const summary = pipelineSummary();
  const pipelineStats = pipelineStageCounts(apps);
  const savedJobs = rawSaved.map((job) => {
    const app = (job.trackerN ? apps.find((a) => a.n === job.trackerN) : undefined) || matchJobIdentity(job, apps).match;
    const inbox = matchJobIdentity(job, summary.inbox).match;
    return {
      ...job,
      ...(app?.date ? { appliedDate: app.date } : {}),
      ...(app?.followUp ? { followUp: app.followUp } : {}),
      ...(app?.closesAt || inbox?.closesAt || job.closesAt ? { closesAt: app?.closesAt || inbox?.closesAt || job.closesAt } : {}),
    };
  });

  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-muted">Memuat lowongan tersimpan...</div>}>
      <SavedView initialJobs={savedJobs} pipelineStats={pipelineStats} />
    </Suspense>
  );
}

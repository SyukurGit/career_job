import { Suspense } from "react";
import fs from "node:fs";
import * as yaml from "js-yaml";
import { pipelineSummary, careerOpsRoot, readScanMetadata } from "@/lib/career-ops";
import { readSavedJobsFromDisk } from "@/lib/saved-jobs";
import { loadWorkplaceClassifier } from "@/lib/core/workplace-policy.mjs";
import { getProfilePath } from "@/lib/core/profile-path.mjs";
import { canonicalJobKey } from "@/lib/core/url-key.mjs";
import { deriveSource } from "@/lib/catalog-source.mjs";
import { parsePostingFacts, withPostingMetadata } from "@/lib/catalog-metadata.mjs";
import { readCatalogRun } from "@/lib/catalog-receipt.mjs";
import { makeJobId, matchJobIdentity } from "@/lib/job-identity.mjs";
import type { CatalogJob } from "@/lib/catalog-job";
import { LokerView } from "@/components/loker/loker-view";

export const dynamic = "force-dynamic";

function readQuickRoles(root: string): string[] {
  try {
    const parsed = yaml.load(fs.readFileSync(getProfilePath(root), "utf8")) as { target_roles?: { primary?: unknown[] } } | null;
    const primary = parsed?.target_roles?.primary;
    if (!Array.isArray(primary)) return [];
    return primary.filter((role): role is string => typeof role === "string" && role.trim().length > 0).map((r) => r.trim());
  } catch {
    return [];
  }
}

export default async function LokerPage({ searchParams }: { searchParams: Promise<{ scanRun?: string }> }) {
  const root = careerOpsRoot();
  const { scanRun } = await searchParams;
  const receipt = scanRun ? readCatalogRun(root, scanRun) : null;
  const metadata = readScanMetadata();
  const summary = pipelineSummary();
  const rawJobs = scanRun
    ? (receipt?.discoveries ?? []).map((job: Record<string, unknown>) => withPostingMetadata({
      ...parsePostingFacts(job),
      url: String(job.url), company: typeof job.company === "string" ? job.company : "",
      role: typeof job.role === "string" ? job.role : typeof job.title === "string" ? job.title : "",
      location: typeof job.location === "string" ? job.location : undefined,
      compensation: typeof job.compensation === "string" ? job.compensation : undefined,
      note: typeof job.note === "string" ? job.note : undefined,
      yrs: typeof job.yrs === "string" ? job.yrs : undefined,
    }, metadata))
    : summary.inbox;
  const classify = await loadWorkplaceClassifier(root);
  const seen = new Set<string>();
  const catalogJobs: CatalogJob[] = [];
  for (const job of rawJobs) {
    const key = canonicalJobKey(job.url) || job.url;
    if (seen.has(key)) continue;
    seen.add(key);
    if (job.postingStatus === "closed") continue;
    // Reclassify from actual available evidence/current policy. Old rows are
    // never rewritten, and remote provenance is not country authorization.
    const classification = classify(job);
    if (classification.eligibility === "restricted") continue;
    const matchedApp = matchJobIdentity(job, summary.applications);
    const app = !matchedApp.ambiguous ? matchedApp.match : null;
    catalogJobs.push({
      ...job,
      ...classification,
      id: makeJobId(job.url, job.company, job.role),
      source: deriveSource(job.url),
      ...(app?.score && /^(?:[0-4](?:\.\d+)?|5(?:\.0+)?)\/5$/.test(app.score.trim()) ? { evaluatedScore: app.score.trim() } : {}),
      ...(app?.score || app?.report ? { isEvaluated: true } : {}),
      ...(app?.status ? { trackerStatus: app.status } : {}),
    });
  }
  const savedJobs = readSavedJobsFromDisk();
  const quickRoles = readQuickRoles(root);

  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-muted">Memuat katalog lowongan...</div>}>
      {scanRun && (
        <div className="mx-auto max-w-7xl px-4 pt-6 text-sm text-muted" role="status">
          {receipt ? `Penemuan scan ini · ${receipt.status ?? "status tidak diketahui"} · ${receipt.discoveries.length} lowongan tercatat` : "Hasil scan tidak tersedia. Tidak menampilkan lowongan dari scan lain."}
        </div>
      )}
      <LokerView initialJobs={catalogJobs} initialSaved={savedJobs} quickRoles={quickRoles} />
    </Suspense>
  );
}

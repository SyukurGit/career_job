import { notFound } from "next/navigation";
import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, pipelineSummary, readLinkedReport, isRegularContainedFile, pdfPathStatusForReport, withCloseDates } from "@/lib/career-ops";
import { readSavedJobsFromDisk } from "@/lib/saved-jobs";
import { tailoredCvOnDisk } from "@/lib/tailored-cv-ready.mjs";
import { resolveTailoredCover } from "@/lib/apply/cover";
import { readRuntimePolicy } from "@/lib/read-runtime-policy";
import { authoritativeReportUrl, canonicalPostingKey, makeJobId, matchJobIdentity, mergeJobMetadata } from "@/lib/job-identity.mjs";
import { loadWorkplaceClassifier } from "@/lib/core/workplace-policy.mjs";
import { firstMarkdownLinkTarget } from "@/lib/posting-url.mjs";
import { DetailView, type DetailJob } from "@/components/loker/detail-view";

export const dynamic = "force-dynamic";

function deriveSource(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, "") || "Manual"; }
  catch { return "Manual"; }
}

export default async function LokerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const root = careerOpsRoot();
  const summary = pipelineSummary();
  const appsWithDates = await withCloseDates(summary.applications);
  const savedJobs = readSavedJobsFromDisk();
  const saved = savedJobs.find((job) => job.id === id || job.url === id);
  const numericApp = /^\d+$/.test(id) ? appsWithDates.find((app) => Number(app.n) === Number(id)) : undefined;
  const inboxById = summary.inbox.find((job) => makeJobId(job.url, job.company, job.role) === id || job.url === id);
  const target = numericApp || inboxById || saved;
  if (!target) notFound();
  const appIdentity = numericApp ? { match: numericApp, ambiguous: false } : matchJobIdentity(target, appsWithDates);
  const app = appIdentity.match;
  const inboxIdentity = inboxById ? { match: inboxById, ambiguous: false } : matchJobIdentity(target, summary.inbox);
  const inbox = inboxIdentity.match;
  const bookmark = saved || matchJobIdentity(target, savedJobs).match;
  // Canonical pipeline facts win; bookmark-only description/notes survive.
  const canonical = mergeJobMetadata(app ? { ...app, source: deriveSource(app.url) } : {}, inbox || {});
  const resolved = mergeJobMetadata(bookmark ? { ...bookmark, note: bookmark.notes } : {}, canonical) as Partial<DetailJob>;
  if (!resolved.role) notFound();
  const url = resolved.url || "";
  const classify = await loadWorkplaceClassifier(root);
  let identityWarning = appIdentity.ambiguous || inboxIdentity.ambiguous
    ? "Beberapa lowongan/lamaran cocok. Laporan tidak dipilih berdasarkan judul saja; periksa tracker." : undefined;
  let reportContent: string | null = null;
  let reportFile: string | null = null;
  let reportNum: string | null = null;
  if (app?.report && !appIdentity.ambiguous) {
    const content = readLinkedReport(app);
    const reportUrl = authoritativeReportUrl(content);
    if (content && !(canonicalPostingKey(url) && canonicalPostingKey(reportUrl) && canonicalPostingKey(url) !== canonicalPostingKey(reportUrl))) {
      reportContent = content;
      reportFile = path.basename(firstMarkdownLinkTarget(app.report) || "") || null;
      reportNum = reportFile?.match(/^(\d+)-/)?.[1] || null;
    } else if (content) identityWarning = "URL laporan berbeda dari lowongan ini. Laporan tidak ditautkan otomatis.";
  }
  if (!reportContent && !appIdentity.ambiguous) {
    const reportsDir = path.join(root, "reports");
    let files: string[] = [];
    try { files = fs.readdirSync(reportsDir).filter((file) => file.endsWith(".md")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const candidates = files.flatMap((file) => {
      const full = path.join(reportsDir, file);
      if (!isRegularContainedFile(full, root)) return [];
      const content = fs.readFileSync(/* turbopackIgnore: true */ full, "utf8");
      const title = content.match(/^#\s+(?:Evaluation|Evaluasi):\s+(.+?)\s+(?:—|--|–)\s+(.+)$/m);
      return [{ file, content, url: authoritativeReportUrl(content), company: title?.[1] || "", role: title?.[2] || "" }];
    });
    const identity = matchJobIdentity({ url, company: resolved.company, role: resolved.role }, candidates);
    if (identity.ambiguous) identityWarning = "Beberapa laporan cocok; pilih laporan yang benar melalui tracker.";
    if (identity.match) {
      reportContent = identity.match.content;
      reportFile = identity.match.file;
      reportNum = identity.match.file.match(/^(\d+)-/)?.[1] || null;
    }
  }
  let hasTailoredPdf = false;
  if (reportNum) {
    const pdfStatus = await pdfPathStatusForReport(reportNum);
    if (pdfStatus.status === "found") {
      hasTailoredPdf = true;
    } else if (pdfStatus.status !== "rejected") {
      let filenames: string[] = [];
      try { filenames = fs.readdirSync(path.join(root, "output")); } catch { filenames = []; }
      hasTailoredPdf = tailoredCvOnDisk({ indexStatus: pdfStatus.status, filenames, company: resolved.company || "" });
    }
  }
  const hasTailoredCoverPdf = Boolean(await resolveTailoredCover(resolved.company || "", app?.n));
  const runtime = await readRuntimePolicy().catch(() => null);
  const job: DetailJob = {
    ...resolved,
    ...classify(resolved),
    id: bookmark?.id || inboxById && makeJobId(inboxById.url, inboxById.company, inboxById.role) || id,
    url,
    company: resolved.company || "Perusahaan",
    role: resolved.role,
    source: resolved.source || deriveSource(url),
    isSaved: Boolean(bookmark),
    reportContent,
    reportFile,
    reportNum,
    trackerN: app?.n,
    applicationStatus: app?.status,
    evaluatedScore: app?.score,
    appliedDate: app?.date,
    followUp: app?.followUp,
    hasTailoredPdf,
    hasTailoredCoverPdf,
    candidateName: runtime?.candidate?.name || undefined,
    candidateHeadline: runtime?.candidate?.headline || undefined,
    candidateLocation: runtime?.candidate?.location || undefined,
    notes: bookmark?.notes,
    coverDraft: bookmark?.coverDraft,
    coverDraftAt: bookmark?.coverDraftAt,
    coverProvider: bookmark?.coverProvider,
    coverModel: bookmark?.coverModel,
    coverSource: bookmark?.coverSource,
    identityWarning,
  };
  return <DetailView job={job} initialSaved={Boolean(bookmark)} />;
}

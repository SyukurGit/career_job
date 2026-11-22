"use client";

import { useEffect, useRef, useState, useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  MapPin,
  DollarSign,
  Sparkles,
  ExternalLink,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  ShieldCheck,
  Briefcase,
  FileText,
  Loader2,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Download,
  StickyNote,
  Save,
  Send,
  CalendarClock,
} from "lucide-react";
import { CompanyLogo } from "@/components/company-logo";
import type { CatalogJob } from "@/lib/catalog-job";
import { cn } from "@/lib/cn";
import { useJobs } from "@/components/jobs/job-store";
import { ReportMarkdown } from "@/components/report-markdown";
import { splitSections, cleanHeading } from "@/lib/report-sections.mjs";
import { CANONICAL_STATES, canonStatus, parseReport } from "@/lib/format";
import { ESSENTIAL_EVALUATION } from "@/lib/evaluation-options.mjs";
import { canonicalJobKey } from "@/lib/core/url-key.mjs";
import { classifyCatalogGeography } from "@/lib/catalog-ui.mjs";
import { JobTimestampChips } from "@/components/loker/timestamp-chips";
import { closesSoonInfo, followUpDueInfo } from "@/lib/pipeline-insights.mjs";
import { buildOutreachMessages } from "@/lib/outreach-templates.mjs";

export type DetailJob = CatalogJob & {
  description?: string;
  isSaved: boolean;
  reportContent?: string | null;
  reportFile?: string | null;
  reportNum?: string | null;
  identityWarning?: string;
  applicationStatus?: string;
  trackerN?: string;
  appliedDate?: string;
  followUp?: string;
  hasTailoredPdf?: boolean;
  hasTailoredCoverPdf?: boolean;
  candidateName?: string;
  candidateHeadline?: string;
  candidateLocation?: string;
  notes?: string;
  coverDraft?: string;
  coverDraftAt?: string;
  coverProvider?: string;
  coverModel?: string;
  coverSource?: string;
};

function bookmarkSnapshot(job: DetailJob) {
  return {
    id: job.id,
    url: job.url,
    company: job.company,
    role: job.role,
    location: job.location,
    compensation: job.compensation,
    source: job.source,
    notes: job.notes ?? job.note,
    description: job.description,
    postedAt: job.postedAt,
    firstSeenAt: job.firstSeenAt,
    lastSeenAt: job.lastSeenAt,
    sourceUpdatedAt: job.sourceUpdatedAt,
    workplaceType: job.workplaceType,
    eligibility: job.eligibility,
    eligibilityReason: job.eligibilityReason,
  };
}

export function DetailView({
  job,
  initialSaved,
}: {
  job: DetailJob;
  initialSaved: boolean;
}) {
  const { jobs: runningJobs, startJob } = useJobs();
  const router = useRouter();
  const lastRefreshedReport = useRef<number | null>(null);
  const [isRefreshingReport, refreshReport] = useTransition();
  const [isSaved, setIsSaved] = useState(initialSaved);
  const [isSaving, setIsSaving] = useState(false);
  const [appStatus, setAppStatus] = useState(job.applicationStatus || "");
  const [trackerN, setTrackerN] = useState(job.trackerN || "");
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [notesInput, setNotesInput] = useState(job.notes || "");
  const [savedNotesText, setSavedNotesText] = useState(job.notes || "");
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSavedNotice, setNotesSavedNotice] = useState(false);
  const [persistedCover, setPersistedCover] = useState({
    text: job.coverDraft || "",
    provider: job.coverProvider || "",
    model: job.coverModel || "",
    source: job.coverSource || "",
    savedAt: job.coverDraftAt || "",
  });
  const savedCoverTextRef = useRef(job.coverDraft || "");
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    "B) Kecocokan dengan CV": true,
    "B) CV Match": true,
    "A) Ringkasan role": true,
    "A) Role Summary": true,
  });

  const [actionError, setActionError] = useState("");
  const [copiedCoverLetter, setCopiedCoverLetter] = useState(false);
  const [hasCoverPdf, setHasCoverPdf] = useState(Boolean(job.hasTailoredCoverPdf));
  const [generatingCoverPdf, setGeneratingCoverPdf] = useState(false);
  const [showOutreach, setShowOutreach] = useState(false);
  const [outreachTab, setOutreachTab] = useState<"email" | "whatsapp" | "linkedin">("email");
  const [copiedOutreachKey, setCopiedOutreachKey] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [catalogSearch, setCatalogSearch] = useState("");
  useEffect(() => { setNowMs(Date.now()); setCatalogSearch(window.location.search); }, []);
  const analysisInput = job.url || `local:manual/${job.id}`;
  const launch = (kind: "evaluate" | "cover", focused = false) => {
    setActionError("");
    if (!/^https?:\/\//i.test(job.url) && !job.description?.trim()) {
      setActionError("Tambahkan deskripsi lowongan lengkap sebelum menjalankan analisis.");
      return;
    }
    try {
      startJob({
        title: `${kind === "cover" ? "Surat lamaran" : "Evaluasi"} · ${job.company}`,
        subtitle: job.role,
        kind,
        input: analysisInput,
        page: `/loker/${job.id}`,
        ...(job.description?.trim() ? { brief: { jobDescription: job.description, role: job.role, company: job.company } } : {}),
        ...(focused ? { evaluationSections: [...ESSENTIAL_EVALUATION] } : {}),
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Tidak dapat memulai analisis.");
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCoverLetter(true);
      setTimeout(() => setCopiedCoverLetter(false), 2000);
    } catch {
      setActionError("Tidak dapat menyalin teks. Pilih dan salin teks secara manual.");
    }
  };
  // Check if there is an active runner for this job's URL
  const analysisKey = canonicalJobKey(analysisInput) || analysisInput;
  const activeRunner = runningJobs.find((rj) => (canonicalJobKey(rj.input) || rj.input) === analysisKey && rj.kind === "evaluate");
  const coverRunner = runningJobs.find((rj) => (canonicalJobKey(rj.input) || rj.input) === analysisKey && rj.kind === "cover");
  const pdfTargetN = job.reportNum || trackerN || "";
  const pdfRunner = runningJobs.find((rj) => rj.kind === "pdf" && (pdfTargetN ? rj.input === pdfTargetN : rj.subtitle === job.role));
  const isRunning = activeRunner?.status === "running";
  const isGeneratingCoverLetter = coverRunner?.status === "running";
  const isGeneratingPdf = pdfRunner?.status === "running";
  const liveCoverText = coverRunner?.status === "done" ? coverRunner.text : null;
  const coverLetterResult = liveCoverText || persistedCover.text || null;
  const coverProviderLabel = (liveCoverText ? coverRunner?.provenance?.provider : persistedCover.provider) || coverRunner?.provenance?.provider || "Belum diketahui";
  const coverModelLabel = (liveCoverText ? coverRunner?.provenance?.model : persistedCover.model) || coverRunner?.provenance?.model || "Belum diketahui";
  const hasTailoredPdf = Boolean(job.hasTailoredPdf || pdfRunner?.status === "done");

  useEffect(() => {
    if (coverRunner?.status !== "done" || !coverRunner.text?.trim()) return;
    if (savedCoverTextRef.current === coverRunner.text) return;
    savedCoverTextRef.current = coverRunner.text;
    const controller = new AbortController();
    fetch("/api/saved-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        action: "save_cover",
        id: job.id,
        url: job.url,
        coverDraft: coverRunner.text,
        coverProvider: coverRunner.provenance?.provider ?? "",
        coverModel: coverRunner.provenance?.model ?? "",
        coverSource: coverRunner.provenance?.source ?? "",
        job: bookmarkSnapshot(job),
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data?.ok) {
          setIsSaved(true);
          setPersistedCover({
            text: coverRunner.text,
            provider: coverRunner.provenance?.provider || "",
            model: coverRunner.provenance?.model || "",
            source: coverRunner.provenance?.source || "",
            savedAt: new Date().toISOString(),
          });
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [coverRunner?.status, coverRunner?.text, coverRunner?.provenance, job]);

  const launchPdf = () => {
    setActionError("");
    const target = job.trackerN || trackerN || job.reportNum || "";
    if (!target) {
      setActionError("Jalankan Analisis AI atau catat status tracker terlebih dahulu sebelum membuat CV PDF.");
      return;
    }
    try {
      startJob({
        title: `CV PDF · ${job.company}`,
        subtitle: job.role,
        kind: "pdf",
        input: target,
        page: `/loker/${job.id}`,
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Tidak dapat membuat CV PDF.");
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    setUpdatingStatus(true);
    setActionError("");
    try {
      const res = await fetch("/api/saved-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_status",
          id: job.id,
          url: job.url,
          status: newStatus,
          job: bookmarkSnapshot(job),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Gagal memperbarui status lamaran.");
      setIsSaved(true);
      if (data.job?.applicationStatus) setAppStatus(data.job.applicationStatus);
      else setAppStatus(newStatus);
      if (data.job?.trackerN) setTrackerN(data.job.trackerN);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal memperbarui status lamaran.");
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleSaveNotes = async () => {
    setSavingNotes(true);
    setActionError("");
    setNotesSavedNotice(false);
    try {
      const res = await fetch("/api/saved-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_notes",
          id: job.id,
          url: job.url,
          notes: notesInput,
          job: bookmarkSnapshot(job),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Gagal menyimpan catatan.");
      setIsSaved(true);
      setSavedNotesText(notesInput.trim());
      setNotesSavedNotice(true);
      setTimeout(() => setNotesSavedNotice(false), 2500);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal menyimpan catatan.");
    } finally {
      setSavingNotes(false);
    }
  };

  const handleGenerateCoverPdf = async () => {
    if (!coverLetterResult?.trim()) return;
    setGeneratingCoverPdf(true);
    setActionError("");
    try {
      const res = await fetch("/api/cover-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: job.company,
          role: job.role,
          draft: coverLetterResult,
          trackerN: trackerN || job.reportNum || "",
          location: job.location || "",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Gagal membuat PDF surat lamaran.");
      setHasCoverPdf(true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal membuat PDF surat lamaran.");
    } finally {
      setGeneratingCoverPdf(false);
    }
  };

  const closingInfo = closesSoonInfo(job.closesAt);
  const followUpInfo = followUpDueInfo({ applicationStatus: appStatus, date: job.appliedDate, followUp: job.followUp });
  const outreachMessages = useMemo(
    () => buildOutreachMessages({
      role: job.role,
      company: job.company,
      location: job.location,
      candidateName: job.candidateName,
      candidateHeadline: job.candidateHeadline,
      candidateLocation: job.candidateLocation,
      coverDraft: coverLetterResult || "",
    }),
    [job.role, job.company, job.location, job.candidateName, job.candidateHeadline, job.candidateLocation, coverLetterResult]
  );
  const reportText = job.reportContent || null;
  const persistedReportN = job.reportNum ? Number(job.reportNum) : null;
  const completedReportN = activeRunner?.status === "done" ? activeRunner.reportN : null;
  const reportProvenance = completedReportN != null && completedReportN === persistedReportN ? activeRunner?.provenance : undefined;
  useEffect(() => {
    if (completedReportN == null || completedReportN === persistedReportN || completedReportN === lastRefreshedReport.current) return;
    lastRefreshedReport.current = completedReportN;
    refreshReport(() => router.refresh());
  }, [completedReportN, persistedReportN, router]);
  const parsedMeta = useMemo(() => (reportText ? parseReport(reportText) : null), [reportText]);

  const sections = useMemo(() => {
    if (!parsedMeta?.body) return [];
    return splitSections(parsedMeta.body).sections.filter(
      (s) => !/machine summary|submitted|archive verbatim/i.test(s.heading)
    );
  }, [parsedMeta]);

  // Extract score & decision
  const scoreVal = parsedMeta?.fields.find((f) => f.label === "Score")?.value || null;
  const decisionVal = parsedMeta?.fields.find((f) => f.label === "Decision")?.value || null;
  const reportVerification = parsedMeta?.fields.find((f) => f.label === "Verification")?.value;

  const legitimacyVal = useMemo(() => {
    return parsedMeta?.legitimacy || parsedMeta?.fields.find((f) => f.label === "Legitimacy")?.value || null;
  }, [parsedMeta]);

  const toggleSave = async () => {
    setIsSaving(true);
    setActionError("");
    try {
      const res = await fetch("/api/saved-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggle",
          job: bookmarkSnapshot(job),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Gagal mengubah simpanan.");
      setIsSaved(data.saved);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal mengubah simpanan.");
    } finally {
      setIsSaving(false);
    }
  };


  const toggleSection = (heading: string) => {
    setOpenSections((prev) => ({ ...prev, [heading]: !prev[heading] }));
  };

  const isRemote = job.workplaceType === "remote";

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Back Link */}
      <div className="mb-6">
        <Link
          href={`/loker${catalogSearch}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Kembali ke Katalog Lowongan
        </Link>
      </div>

      {/* Hero Header Card */}
      <div className="mb-8 rounded-3xl border border-border bg-surface p-6 shadow-sm sm:p-8">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-start">
          {/* Company & Role Details */}
          <div className="flex items-start gap-5">
            <CompanyLogo name={job.company} size={64} className="rounded-2xl border border-border bg-surface shrink-0" />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-md border border-border bg-background/70 px-2 py-0.5 text-xs font-medium text-muted">
                  {job.source}
                </span>
                {(() => {
                  const geo = classifyCatalogGeography(job);
                  if (geo.tier === "aceh_focus" || geo.tier === "aceh_onsite") {
                    return (
                      <span className="rounded-full border border-emerald-500/35 bg-emerald-500/15 px-3 py-0.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                        {geo.label}
                      </span>
                    );
                  }
                  if (isRemote) {
                    return (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-3 py-0.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                        {geo.label}
                      </span>
                    );
                  }
                  return (
                    <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-3 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                      {job.workplaceType === "hybrid" ? "Hybrid" : job.workplaceType === "onsite" ? "Onsite" : "Sistem kerja belum diketahui"}
                    </span>
                  );
                })()}
                <JobTimestampChips job={job} nowMs={nowMs} />
              </div>

              <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                {job.role}
              </h1>

              <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-muted">
                <span className="font-semibold text-foreground flex items-center gap-1.5">
                  <Building2 className="size-4 text-muted" />
                  {job.company}
                </span>
                {job.location && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="size-4 text-muted" />
                    {job.location}
                  </span>
                )}
                {job.yrs && (
                  <span className="rounded-md bg-background/70 border border-border/60 px-2 py-0.5 text-xs text-muted">
                    Pengalaman: {job.yrs}
                  </span>
                )}
              </div>

              {/* Gaji Highlight */}
              {job.compensation && job.compensation !== "-" && (
                <div className="mt-3">
                  <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/15 px-3 py-1 text-sm font-bold text-emerald-800 dark:text-emerald-300">
                    <DollarSign className="size-4" />
                    {job.compensation}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {/* Tombol Simpan */}
            <button
              type="button"
              disabled={isSaving}
              onClick={toggleSave}
              className={cn(
                "inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl border px-4 text-sm font-medium transition-colors shadow-2xs disabled:opacity-50",
                isSaved
                  ? "border-brand/45 bg-brand-soft text-brand-text hover:bg-brand/20"
                  : "border-border bg-background text-foreground hover:border-brand/40 hover:bg-surface-hover"
              )}
            >
              {isSaved ? (
                <>
                  <BookmarkCheck className="size-4 text-brand-text" />
                  <span>Lowongan Tersimpan</span>
                </>
              ) : (
                <>
                  <Bookmark className="size-4 text-muted" />
                  <span>Simpan Loker</span>
                </>
              )}
            </button>

            {/* Tombol Iklan Asli */}
            {job.url && !job.url.startsWith("local:") && (
              <a
                href={job.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:border-brand/40 hover:bg-surface-hover"
              >
                <span>Buka Iklan Asli</span>
                <ExternalLink className="size-4 text-muted" />
              </a>
            )}
          </div>
        </div>
      </div>
      {job.identityWarning && <p role="alert" className="mb-4 text-sm text-amber-800 dark:text-amber-300">{job.identityWarning}</p>}
      <div className="mb-8 rounded-2xl border border-border bg-surface p-4 sm:p-5 text-sm space-y-4">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <p className="font-semibold">{job.eligibility === "eligible" ? "Lokasi memenuhi kebijakan" : job.eligibility === "restricted" ? "Lokasi dibatasi" : "Perlu cek lokasi"}</p>
            <p className="mt-1 text-xs text-muted">{job.eligibilityReason || "Konfirmasi izin bekerja dari domisili Anda pada iklan asli."}</p>
            {job.postingStatus === "closed" && <p role="alert" className="mt-2 text-amber-800 dark:text-amber-300">Iklan ini tercatat sudah ditutup. Bookmark dan status lamaran tetap dipertahankan.</p>}
            {(closingInfo || followUpInfo.due) && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {closingInfo && (
                  <span className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                    closingInfo.urgent ? "border-amber-500/45 bg-amber-500/15 text-amber-800 dark:text-amber-300" : "border-border bg-background text-muted"
                  )}>
                    <CalendarClock className="size-3.5" />
                    Batas iklan: {closingInfo.label} ({job.closesAt})
                  </span>
                )}
                {followUpInfo.due && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/15 px-2.5 py-0.5 text-xs font-semibold text-sky-800 dark:text-sky-300">
                    <Send className="size-3.5" />
                    {followUpInfo.label}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <label htmlFor="detail-app-status" className="text-xs font-medium text-muted">Status tracker:</label>
            <select
              id="detail-app-status"
              aria-label={`Status lamaran ${job.role} di ${job.company}`}
              disabled={updatingStatus}
              value={CANONICAL_STATES.find((s) => canonStatus(s) === canonStatus(appStatus)) || appStatus || ""}
              onChange={(e) => handleStatusChange(e.target.value)}
              className={cn(
                "h-9 rounded-xl border px-3 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-brand/25",
                canonStatus(appStatus) === "applied"
                  ? "border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-200"
                  : canonStatus(appStatus) === "interview"
                  ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-800 dark:text-emerald-200"
                  : canonStatus(appStatus) === "rejected"
                  ? "border-rose-500/35 bg-rose-500/15 text-rose-700 dark:text-rose-300"
                  : "border-border bg-background text-foreground"
              )}
            >
              {!appStatus && <option value="" disabled>Belum dilacak</option>}
              {CANONICAL_STATES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
            {trackerN && <span className="text-xs text-muted tabular-nums">#{trackerN}</span>}
          </div>
        </div>

        <div className="border-t border-border pt-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
            <label htmlFor="detail-personal-notes" className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <StickyNote className="size-3.5 text-brand-text" />
              Catatan Pribadi
            </label>
            <span className="text-[11px] text-muted">
              {notesSavedNotice ? "Catatan tersimpan" : notesInput.trim() !== savedNotesText ? "Belum disimpan" : savedNotesText ? "Tersimpan di bookmark" : "Opsional — tersimpan permanen"}
            </span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <textarea
              id="detail-personal-notes"
              rows={2}
              value={notesInput}
              onChange={(e) => { setNotesInput(e.target.value); setNotesSavedNotice(false); }}
              placeholder="Catat kontak HRD, progres wawancara, catatan gaji, atau hal penting untuk role ini..."
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
            <button
              type="button"
              disabled={savingNotes || notesInput.trim() === savedNotesText}
              onClick={handleSaveNotes}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-border bg-background px-3.5 text-xs font-semibold text-foreground transition-colors hover:border-brand/40 hover:bg-surface-hover hover:text-brand-text disabled:opacity-50"
            >
              {savingNotes ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              <span>{savingNotes ? "Menyimpan..." : "Simpan Catatan"}</span>
            </button>
          </div>
        </div>
      </div>
      {activeRunner?.persistenceError && <p role="alert" className="mb-4 text-sm text-red-700 dark:text-red-300">{activeRunner.persistenceError}</p>}
      {coverRunner?.persistenceError && <p role="alert" className="mb-4 text-sm text-red-700 dark:text-red-300">{coverRunner.persistenceError}</p>}
      {(activeRunner?.status === "error" || activeRunner?.status === "gated") && <p className="mb-2 text-xs text-muted">Provider evaluasi: {activeRunner.provenance?.provider || "Belum diketahui"} • Model: {activeRunner.provenance?.model || "Belum diketahui"}</p>}
      {(coverRunner?.status === "error" || coverRunner?.status === "gated") && <p className="mb-2 text-xs text-muted">Provider surat: {coverRunner.provenance?.provider || "Belum diketahui"} • Model: {coverRunner.provenance?.model || "Belum diketahui"}</p>}
      {(actionError || activeRunner?.status === "error" || activeRunner?.status === "gated" || coverRunner?.status === "error" || coverRunner?.status === "gated") && (
        <p role="alert" className="mb-4 text-sm text-red-700 dark:text-red-300">{actionError || (activeRunner?.status === "error" || activeRunner?.status === "gated" ? activeRunner.gate?.message || activeRunner.error || activeRunner.steps.at(-1)?.label : "") || (coverRunner?.status === "error" || coverRunner?.status === "gated" ? coverRunner.gate?.message || coverRunner.error || coverRunner.steps.at(-1)?.label : "") || "Analisis gagal. Input tetap tersimpan; coba kembali."}</p>
      )}

      {/* Main Grid: AI Evaluation vs JD Details */}
      <div className="space-y-8">
        {/* Panel Evaluasi AI */}
        <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm sm:p-8">
          <div className="border-b border-border pb-4 mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
                <Sparkles className="size-5 text-brand-text" />
                Laporan Analisis AI (Versi Bahasa Indonesia)
              </h2>
              <p className="mt-1 text-xs text-muted">
                <strong>Analisis Terfokus</strong> untuk skor &amp; screening cepat; <strong>Analisis Lengkap</strong> untuk laporan penuh A–H &amp; strategi wawancara.
              </p>
            </div>

            {/* Action Buttons Group */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isRunning}
                title="Ringkas — cek skor kecocokan CV dengan cepat"
                onClick={() => launch("evaluate", true)}
                className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-brand/40 bg-brand-soft px-3.5 text-xs font-semibold text-brand-text transition-colors hover:bg-brand/20 disabled:opacity-50"
              >
                {isRunning ? (
                  <><Loader2 className="size-3.5 animate-spin" /><span>Menganalisis...</span></>
                ) : (
                  <>
                    <Sparkles className="size-3.5" />
                    <span>Analisis Terfokus</span>
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={isGeneratingCoverLetter}
                title="Susun draf cover letter yang tersimpan otomatis"
                onClick={() => launch("cover")}
                className={cn(
                  "inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border px-3.5 text-xs font-semibold shadow-2xs transition-colors",
                  isGeneratingCoverLetter
                    ? "border-purple-500/40 bg-purple-500/20 text-purple-800 dark:text-purple-300 cursor-not-allowed opacity-70"
                    : "border-purple-500/35 bg-purple-500/12 text-purple-800 dark:text-purple-300 hover:bg-purple-500/20"
                )}
              >
                {isGeneratingCoverLetter ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>Membuat Surat...</span>
                  </>
                ) : (
                  <>
                    <FileText className="size-3.5" />
                    <span>{coverLetterResult ? "Buat Ulang Surat Lamaran" : "Draf Surat Lamaran"}</span>
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={isRunning}
                title="Lengkap — laporan mendalam A–H, gap analisis & verifikasi perusahaan"
                onClick={() => launch("evaluate")}
                className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-border bg-background px-3.5 text-xs font-semibold text-foreground transition-colors hover:border-brand/40 hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isRunning ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>Analisis berjalan...</span>
                  </>
                ) : (
                  <span>Analisis Lengkap</span>
                )}
              </button>

              {(job.trackerN || trackerN || job.reportNum) && (
                <button
                  type="button"
                  disabled={isGeneratingPdf}
                  onClick={launchPdf}
                  className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-border bg-background px-3.5 text-xs font-semibold text-foreground transition-colors hover:border-brand/40 hover:bg-surface-hover disabled:opacity-50"
                >
                  {isGeneratingPdf ? (
                    <><Loader2 className="size-3.5 animate-spin" /><span>Membuat PDF...</span></>
                  ) : (
                    <>
                      <FileText className="size-3.5 text-brand-text" />
                      <span>{hasTailoredPdf ? "Perbarui CV PDF" : "Buat CV PDF"}</span>
                    </>
                  )}
                </button>
              )}

              {hasTailoredPdf && pdfTargetN && (
                <a
                  href={`/api/cv-pdf?n=${encodeURIComponent(pdfTargetN)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-emerald-500/35 bg-emerald-500/15 px-3.5 text-xs font-semibold text-emerald-800 transition-colors hover:bg-emerald-500/25 dark:text-emerald-300"
                >
                  <Download className="size-3.5" />
                  <span>Lihat CV PDF</span>
                </a>
              )}
            </div>
          </div>


          {/* Cover Letter Result Box */}
          {isGeneratingCoverLetter && (
            <div className="mb-6 rounded-2xl border border-purple-500/30 bg-purple-500/10 p-5 text-center animate-pulse">
              <Loader2 className="mx-auto size-7 animate-spin text-purple-600 dark:text-purple-400" />
              <p className="mt-2 text-xs font-semibold text-foreground">
                Menyusun draf Cover Letter dan Pitching HRD yang dipersonalisasi...
              </p>
            </div>
          )}

          {coverLetterResult && !isGeneratingCoverLetter && (
            <div className="mb-6 rounded-2xl border border-purple-500/30 bg-purple-500/5 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 mb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-lg bg-purple-500/20 text-purple-700 dark:text-purple-300 text-xs font-bold">
                    📝
                  </span>
                  <h3 className="text-sm font-bold text-foreground">Draf Surat Lamaran — tinjau sebelum mengirim</h3>
                  <p className="text-xs text-muted">Provider: {coverProviderLabel} • Model: {coverModelLabel}{persistedCover.text ? " • Tersimpan" : ""}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={generatingCoverPdf}
                    onClick={() => void handleGenerateCoverPdf()}
                    className="inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:border-brand/40 hover:bg-surface-hover disabled:opacity-50"
                  >
                    {generatingCoverPdf ? <Loader2 className="size-3 animate-spin" /> : <FileText className="size-3 text-brand-text" />}
                    <span>{generatingCoverPdf ? "Membuat PDF..." : hasCoverPdf ? "Perbarui Cover PDF" : "Buat Cover PDF"}</span>
                  </button>
                  {hasCoverPdf && (
                    <a
                      href={`/api/cover-pdf?company=${encodeURIComponent(job.company)}${trackerN ? `&application=${encodeURIComponent(trackerN)}` : ""}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-emerald-500/35 bg-emerald-500/15 px-3 text-xs font-semibold text-emerald-800 transition-colors hover:bg-emerald-500/25 dark:text-emerald-300"
                    >
                      <Download className="size-3" />
                      <span>Lihat Cover PDF</span>
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => copyToClipboard(coverLetterResult)}
                    className="inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover"
                  >
                    {copiedCoverLetter ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                    <span>{copiedCoverLetter ? "Tersalin!" : "Salin Surat Lamaran"}</span>
                  </button>
                </div>
              </div>
              <div className="text-xs leading-relaxed prose dark:prose-invert max-w-none">
                <ReportMarkdown>{coverLetterResult}</ReportMarkdown>
              </div>
            </div>
          )}

          {/* Paket Outreach Cepat (Email / WA HRD / LinkedIn DM) */}
          <div className="mb-6 rounded-2xl border border-border bg-background/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Send className="size-4 text-brand-text" />
                <span className="text-xs font-semibold text-foreground">Paket Kirim Cepat (Email, WhatsApp HRD &amp; LinkedIn DM)</span>
              </div>
              <button
                type="button"
                aria-expanded={showOutreach}
                onClick={() => setShowOutreach((v) => !v)}
                className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-3 text-xs font-medium text-brand-text transition-colors hover:border-brand/40 hover:bg-surface-hover"
              >
                {showOutreach ? "Tutup template kirim" : "Buka template kirim cepat"}
              </button>
            </div>
            {showOutreach && (
              <div className="mt-3 space-y-3 border-t border-border pt-3">
                <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Pilih saluran outreach">
                  {([
                    ["email", "Email + Subjek"],
                    ["whatsapp", "WhatsApp HRD"],
                    ["linkedin", "LinkedIn DM"],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={outreachTab === key}
                      onClick={() => setOutreachTab(key)}
                      className={cn(
                        "inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium transition-colors",
                        outreachTab === key
                          ? "border-brand/50 bg-brand-soft font-semibold text-brand-text"
                          : "border-border bg-surface text-muted hover:text-foreground"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={async () => {
                      const payload = outreachTab === "email"
                        ? `Subjek: ${outreachMessages.emailSubject}\n\n${outreachMessages.emailBody}`
                        : outreachTab === "whatsapp"
                        ? outreachMessages.whatsapp
                        : outreachMessages.linkedin;
                      try {
                        await navigator.clipboard.writeText(payload);
                        setCopiedOutreachKey(outreachTab);
                        setTimeout(() => setCopiedOutreachKey(null), 2000);
                      } catch { setActionError("Gagal menyalin template outreach."); }
                    }}
                    className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-foreground hover:border-brand/40 hover:text-brand-text"
                  >
                    {copiedOutreachKey === outreachTab ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                    <span>{copiedOutreachKey === outreachTab ? "Tersalin!" : "Salin Pesan"}</span>
                  </button>
                </div>
                {outreachTab === "email" && (
                  <p className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-foreground">
                    <strong className="text-muted">Subjek:</strong> {outreachMessages.emailSubject}
                  </p>
                )}
                <pre className="whitespace-pre-wrap rounded-xl border border-border bg-surface p-3 font-sans text-xs leading-relaxed text-foreground">
                  {outreachTab === "email"
                    ? outreachMessages.emailBody
                    : outreachTab === "whatsapp"
                    ? outreachMessages.whatsapp
                    : outreachMessages.linkedin}
                </pre>
              </div>
            )}
          </div>

          {/* Running State Progress Indicator */}
          {isRunning && (
            <div className="rounded-2xl border border-brand/35 bg-brand-soft p-6 text-center animate-pulse">
              <Loader2 className="mx-auto size-8 animate-spin text-brand-text" />
              <h3 className="mt-3 text-sm font-semibold text-foreground">
                AI sedang mengevaluasi lowongan ini secara mendalam...
              </h3>
              <p className="mt-1 text-xs text-muted max-w-md mx-auto">
                Membaca lowongan lengkap dan mencocokkannya dengan CV tersimpan.
              </p>
            </div>
          )}

          {/* If Not Evaluated Yet */}
          {isRefreshingReport && !reportText && <p role="status">Memuat laporan evaluasi tersimpan…</p>}
          {!isRunning && !isRefreshingReport && !reportText && (
            <div className="rounded-2xl border border-dashed border-border bg-background/40 p-10 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand-text mb-3">
                <Sparkles className="size-6" />
              </div>
              <h3 className="text-base font-semibold text-foreground">
                Lowongan ini belum pernah dianalisis dengan AI
              </h3>
              <p className="mt-1.5 text-xs text-muted max-w-md mx-auto leading-relaxed">
                Jalankan evaluasi untuk mengetahui skor kecocokan dengan CV Anda (1-5), daftar skill yang cocok vs kurang, rekomendasi kalimat lamaran, dan deteksi red flag perusahaan.
              </p>
              <button
                type="button"
                onClick={() => launch("evaluate")}
                className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-semibold text-brand-foreground shadow-xs transition-colors hover:bg-brand-200"
              >
                <Sparkles className="size-4" />
                Mulai Analisis AI Sekarang (Bahasa Indonesia)
              </button>
            </div>
          )}

          {/* If Evaluated: Show Score Summary & Sections */}
          {!isRunning && reportText && (
            <div className="space-y-6">
              <p className="text-xs text-muted">Provider evaluasi: {reportProvenance?.provider || "Belum diketahui"} • Model: {reportProvenance?.model || "Belum diketahui"}</p>
              {reportVerification && <p className="text-xs text-muted">Verifikasi iklan: {reportVerification === "active at capture" ? "Aktif saat dibaca" : reportVerification === "unconfirmed (candidate-pasted text)" ? "Belum terkonfirmasi — JD ditempel kandidat" : reportVerification}</p>}
              {/* Scorecard Callout Header */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 rounded-2xl border border-border bg-background/50 p-5">
                <div className="border-b border-border pb-3 sm:border-b-0 sm:border-r sm:pr-4">
                  <span className="text-xs font-medium text-muted">Skor Kesesuaian CV</span>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold text-foreground">{scoreVal || "Belum tersedia"}</span>
                    <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-400">
                      {scoreVal ? parseFloat(scoreVal) >= 4.0 ? "Sangat Direkomendasikan" : "Periksa Kesenjangan" : "Belum dinilai"}
                    </span>
                  </div>
                </div>

                <div className="border-b border-border pb-3 sm:border-b-0 sm:border-r sm:px-4">
                  <span className="text-xs font-medium text-muted">Keputusan AI</span>
                  <div className="mt-1 flex items-center gap-2">
                    <CheckCircle2 className="size-5 text-emerald-500" />
                    <span className="text-base font-bold text-foreground">{decisionVal || "Belum tersedia"}</span>
                  </div>
                </div>

                <div className="sm:pl-4">
                  <span className="text-xs font-medium text-muted">Keabsahan Lowongan (Legitimacy)</span>
                  <div className="mt-1 flex items-center gap-2">
                    <ShieldCheck className="size-5 text-emerald-500" />
                    <span className="text-sm font-semibold text-foreground">{legitimacyVal || "Belum dinilai"}</span>
                  </div>
                </div>
              </div>

              {/* Sections Accordion */}
              <div className="space-y-4">
                {sections.map((sec) => {
                  const isOpen = !!openSections[sec.heading];
                  const cleanTitle = cleanHeading(sec.heading);

                  return (
                    <div
                      key={sec.heading}
                      className="overflow-hidden rounded-2xl border border-border bg-surface transition-all"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSection(sec.heading)}
                        aria-expanded={isOpen}
                        className="flex w-full items-center justify-between border-b border-border/50 bg-background/40 px-5 py-3.5 text-left text-sm font-semibold text-foreground hover:bg-surface-hover"
                      >
                        <span className="flex items-center gap-2">
                          <FileText className="size-4 text-brand-text" />
                          {cleanTitle}
                        </span>
                        {isOpen ? <ChevronUp className="size-4 text-muted" /> : <ChevronDown className="size-4 text-muted" />}
                      </button>

                      {isOpen && (
                        <div className="p-5 text-sm leading-relaxed prose dark:prose-invert max-w-none">
                          <ReportMarkdown>{sec.content}</ReportMarkdown>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Informasi Lowongan Asli / Catatan Scan */}
        <div className="rounded-3xl border border-border bg-surface p-6 shadow-sm sm:p-8">
          <h2 className="text-base font-bold text-foreground mb-3 flex items-center gap-2">
            <Briefcase className="size-4 text-muted" />
            Catatan Tambahan Lowongan
          </h2>
          <div className="space-y-2 text-xs text-muted leading-relaxed">
            {job.note && <p><strong className="text-foreground">Catatan Scan:</strong> {job.note}</p>}
            {job.description && (
              <div className="mt-3 rounded-xl border border-border bg-background p-4 font-mono text-[11px] whitespace-pre-wrap text-foreground/90">
                {job.description}
              </div>
            )}
              {job.url && !job.url.startsWith("local:") && <p className="mt-2 text-muted">Link lowongan asli: <a href={job.url} target="_blank" rel="noreferrer" className="text-brand-text underline break-all">{job.url}</a></p>}
          </div>
        </div>
      </div>
    </div>
  );
}

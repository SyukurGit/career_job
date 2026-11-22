"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bookmark,
  Building2,
  MapPin,
  DollarSign,
  Clock,
  Sparkles,
  ExternalLink,
  Trash2,
  Plus,
  Loader2,
  FileText,
  AlertCircle,
  CheckCircle2,
  StickyNote,
  Save,
  CalendarClock,
  Send,
} from "lucide-react";
import { CompanyLogo } from "@/components/company-logo";
import { cn } from "@/lib/cn";
import { useJobs } from "@/components/jobs/job-store";
import { formatJakartaTimestamp } from "@/lib/catalog-metadata.mjs";
import { ReportMarkdown } from "@/components/report-markdown";
import type { SavedJob } from "@/lib/saved-job";
import { CANONICAL_STATES, canonStatus } from "@/lib/format";
import { ESSENTIAL_EVALUATION } from "@/lib/evaluation-options.mjs";
import { canonicalJobKey } from "@/lib/core/url-key.mjs";
import { closesSoonInfo, followUpDueInfo } from "@/lib/pipeline-insights.mjs";

export type EnrichedSavedJob = SavedJob & {
  appliedDate?: string;
  followUp?: string;
};

type PipelineStats = {
  total: number;
  evaluated: number;
  applied: number;
  interview: number;
  closed: number;
  needsFollowUp: number;
};

export function SavedView({ initialJobs, pipelineStats }: { initialJobs: EnrichedSavedJob[]; pipelineStats?: PipelineStats }) {
  const { jobs: runningJobs, startJob } = useJobs();
  const [savedJobs, setSavedJobs] = useState<EnrichedSavedJob[]>(initialJobs);
  const [showManualForm, setShowManualForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [actionError, setActionError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [notesDrafts, setNotesDrafts] = useState<Record<string, string>>({});
  const [savingNotesId, setSavingNotesId] = useState<string | null>(null);
  const savedCoversRef = useRef<Record<string, string>>({});
  // Form State
  const [formRole, setFormRole] = useState("");
  const [formCompany, setFormCompany] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formLocation, setFormLocation] = useState("");
  const [formCompensation, setFormCompensation] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const handleDelete = async (job: SavedJob) => {
    if (pendingDelete !== job.id) { setPendingDelete(job.id); return; }
    setDeletingId(job.id);
    setActionError("");
    try {
      const res = await fetch("/api/saved-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id: job.id, url: job.url }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok || !Array.isArray(data.jobs)) throw new Error(data.error || "Gagal menghapus lowongan.");
      setSavedJobs(data.jobs);
      setPendingDelete(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal menghapus lowongan.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleUpdateStatus = async (job: SavedJob, newStatus: string) => {
    setUpdatingId(job.id);
    setActionError("");
    try {
      const res = await fetch("/api/saved-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_status", id: job.id, url: job.url, status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok || !Array.isArray(data.jobs)) throw new Error(data.error || "Gagal memperbarui status.");
      setSavedJobs(data.jobs);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal memperbarui status.");
    } finally {
      setUpdatingId(null);
    }
  };

  const handleSaveNotes = async (job: SavedJob) => {
    const notes = notesDrafts[job.id] ?? job.notes ?? "";
    setSavingNotesId(job.id);
    setActionError("");
    try {
      const res = await fetch("/api/saved-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_notes", id: job.id, url: job.url, notes, job }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok || !Array.isArray(data.jobs)) throw new Error(data.error || "Gagal menyimpan catatan.");
      setSavedJobs(data.jobs);
      setEditingNotesId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal menyimpan catatan.");
    } finally {
      setSavingNotesId(null);
    }
  };

  useEffect(() => {
    for (const job of savedJobs) {
      const analysisInput = job.url || `local:manual/${job.id}`;
      const coverRunner = runningJobs.find(
        (rj) => rj.kind === "cover" && (canonicalJobKey(rj.input) || rj.input) === (canonicalJobKey(analysisInput) || analysisInput)
      );
      if (coverRunner?.status !== "done" || !coverRunner.text?.trim()) continue;
      if (job.coverDraft === coverRunner.text || savedCoversRef.current[job.id] === coverRunner.text) continue;
      savedCoversRef.current[job.id] = coverRunner.text;
      fetch("/api/saved-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_cover",
          id: job.id,
          url: job.url,
          coverDraft: coverRunner.text,
          coverProvider: coverRunner.provenance?.provider ?? "",
          coverModel: coverRunner.provenance?.model ?? "",
          coverSource: coverRunner.provenance?.source ?? "",
          job,
        }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data?.ok && Array.isArray(data.jobs)) setSavedJobs(data.jobs);
        })
        .catch(() => {});
    }
  }, [runningJobs, savedJobs]);

  const launch = (job: SavedJob, kind: "evaluate" | "cover", focused = false) => {
    setActionError("");
    if (!/^https?:\/\//i.test(job.url) && !job.description?.trim()) {
      setActionError(`Tambahkan deskripsi lengkap untuk ${job.role} sebelum menjalankan analisis.`);
      return false;
    }
    try {
      startJob({
        title: `${kind === "cover" ? "Surat lamaran" : "Evaluasi"} · ${job.company}`,
        subtitle: job.role,
        kind,
        input: job.url || `local:manual/${job.id}`,
        page: `/loker/${job.id}`,
        ...(job.description?.trim() ? { brief: { jobDescription: job.description, role: job.role, company: job.company } } : {}),
        ...(focused ? { evaluationSections: [...ESSENTIAL_EVALUATION] } : {}),
      });
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Gagal memulai analisis.");
      return false;
    }
  };

  const copyResult = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      setActionError("Tidak dapat menyalin. Pilih teks hasil untuk menyalin secara manual.");
    }
  };
  const handleManualSubmit = async (e: React.FormEvent, andAnalyze = false) => {
    e.preventDefault();
    if (!formRole.trim() || !formCompany.trim()) {
      setFormError("Nama Posisi dan Nama Perusahaan wajib diisi.");
      return;
    }
    if (formUrl.trim() && !/^https?:\/\/[^/\s]+/i.test(formUrl.trim())) {
      setFormError("URL iklan harus memakai http:// atau https://.");
      return;
    }
    if (andAnalyze && !formUrl.trim() && !formDescription.trim()) {
      setFormError("Tempel deskripsi lengkap atau URL iklan publik sebelum analisis.");
      return;
    }
    setFormSubmitting(true);
    setFormError("");

    try {
      const res = await fetch("/api/saved-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "manual",
          title: formRole.trim(),
          company: formCompany.trim(),
          url: formUrl.trim(),
          location: formLocation.trim(),
          compensation: formCompensation.trim(),
          description: formDescription.trim(),
          source: formUrl.trim() ? "Manual (URL)" : "Manual (Teks)",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok || !Array.isArray(data.jobs) || !data.job) {
        setFormError(data.error || "Gagal menyimpan lowongan manual");
        return;
      }

      if (Array.isArray(data.jobs)) {
        setSavedJobs(data.jobs);
      }

      const savedItem: SavedJob = data.job;
      if (andAnalyze && !launch(savedItem, "evaluate")) {
        setFormError("Lowongan tersimpan, tetapi analisis belum dimulai. Input Anda tetap tersedia.");
        return;
      }

      // Reset form
      setFormRole("");
      setFormCompany("");
      setFormUrl("");
      setFormLocation("");
      setFormCompensation("");
      setFormDescription("");
      setShowManualForm(false);

    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Terjadi kesalahan koneksi");
    } finally {
      setFormSubmitting(false);
    }
  };


  const filtered = savedJobs.filter((j) => {
    const currentStatus = j.trackerN && j.applicationStatus ? canonStatus(j.applicationStatus) : "untracked";
    if (statusFilter === "followup") {
      if (!followUpDueInfo(j).due) return false;
    } else if (statusFilter !== "ALL" && currentStatus !== statusFilter) {
      return false;
    }
    if (!searchQuery.trim()) return true;
    const term = searchQuery.toLowerCase();
    return (
      j.role.toLowerCase().includes(term) ||
      j.company.toLowerCase().includes(term) ||
      (j.location || "").toLowerCase().includes(term) ||
      (j.notes || "").toLowerCase().includes(term)
    );
  });
  const followUpDueCount = savedJobs.filter((j) => followUpDueInfo(j).due).length;


  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Top Navigation Bar */}
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <Link
            href="/loker"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground mb-2"
          >
            <ArrowLeft className="size-3.5" />
            Kembali ke Katalog Lowongan
          </Link>
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl bg-brand-soft text-brand-text">
              <Bookmark className="size-5" />
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Lowongan Tersimpan &amp; Analisis
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted">
            Kelola lowongan favorit Anda, jalankan analisis mendalam Bahasa Indonesia, atau tambahkan iklan dari luar portal.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowManualForm(!showManualForm)}
          aria-expanded={showManualForm}
          aria-controls="manual-job-form"
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-brand px-4 text-sm font-semibold text-brand-foreground shadow-xs transition-colors hover:bg-brand-200"
        >
          <Plus className="size-4" />
          <span>Tambah Loker Manual</span>
        </button>
      </div>
      {pipelineStats && pipelineStats.total > 0 && (
        <section aria-label="Ringkasan pipeline tracker" className="mb-6 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
          {[
            ["Total Dilacak", pipelineStats.total, "text-foreground"],
            ["Evaluated", pipelineStats.evaluated, "text-brand-text"],
            ["Applied", pipelineStats.applied, "text-amber-800 dark:text-amber-300"],
            ["Interview", pipelineStats.interview, "text-emerald-800 dark:text-emerald-300"],
            ["Follow-up (>=7h)", pipelineStats.needsFollowUp, pipelineStats.needsFollowUp > 0 ? "text-sky-700 dark:text-sky-300" : "text-muted"],
          ].map(([label, val, tone]) => (
            <div key={String(label)} className="rounded-2xl border border-border bg-surface px-3.5 py-2.5">
              <span className="block text-[11px] font-medium text-muted">{label}</span>
              <span className={cn("mt-0.5 block text-lg font-bold tabular-nums", tone)}>{val}</span>
            </div>
          ))}
        </section>
      )}
      {actionError && <p role="alert" className="mb-4 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-2.5 text-sm text-red-700 dark:text-red-300">{actionError}</p>}

      {/* Manual Input Form Modal / Card */}
      {showManualForm && (
        <form
          onSubmit={(e) => handleManualSubmit(e, false)}
          id="manual-job-form"
          className="mb-8 rounded-2xl border border-brand/35 bg-surface p-6 shadow-md"
        >
          <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <Sparkles className="size-4 text-brand-text" />
              Input Lowongan Manual (Link Iklan atau Teks Deskripsi)
            </h2>
            <button
              type="button"
              onClick={() => setShowManualForm(false)}
              className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-3 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              Tutup
            </button>
          </div>

          {formError && (
            <div role="alert" className="mb-4 flex items-center gap-2 rounded-lg bg-red-500/10 p-3 text-xs text-red-800 dark:text-red-400">
              <AlertCircle className="size-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                Posisi / Jabatan Lowongan <span className="text-red-700 dark:text-red-400">*</span>
              </label>
              <input
                type="text"
                aria-label="Posisi / Jabatan Lowongan"
                required
                value={formRole}
                onChange={(e) => setFormRole(e.target.value)}
                placeholder="mis. Backend Developer (Laravel / Go)"
                className="h-10 w-full rounded-xl border border-border bg-background px-3.5 text-sm text-foreground placeholder:text-faint transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                Nama Perusahaan <span className="text-red-700 dark:text-red-400">*</span>
              </label>
              <input
                type="text"
                aria-label="Nama Perusahaan"
                required
                value={formCompany}
                onChange={(e) => setFormCompany(e.target.value)}
                placeholder="mis. PT Solusi Digital Nusantara"
                className="h-10 w-full rounded-xl border border-border bg-background px-3.5 text-sm text-foreground placeholder:text-faint transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted mb-1">
                Link URL Iklan (JobStreet / LinkedIn / Website Kantor)
              </label>
              <input
                type="url"
                aria-label="Link URL Iklan"
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
                placeholder="https://..."
                className="h-10 w-full rounded-xl border border-border bg-background px-3.5 text-sm text-foreground placeholder:text-faint transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Lokasi / Sistem</label>
                <input
                  type="text"
                  aria-label="Lokasi / Sistem"
                  value={formLocation}
                  onChange={(e) => setFormLocation(e.target.value)}
                  placeholder="Banda Aceh / Remote Global"
                  className="h-10 w-full rounded-xl border border-border bg-background px-3.5 text-sm text-foreground placeholder:text-faint transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Estimasi Gaji</label>
                <input
                  type="text"
                  aria-label="Estimasi Gaji"
                  value={formCompensation}
                  onChange={(e) => setFormCompensation(e.target.value)}
                  placeholder="mis. Rp 5 - 8 jt / bln"
                  className="h-10 w-full rounded-xl border border-border bg-background px-3.5 text-sm text-foreground placeholder:text-faint transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-muted mb-1">
                Teks Deskripsi / Kualifikasi Lowongan (Paste dari WA, Telegram, atau LinkedIn)
              </label>
              <textarea
                rows={4}
                aria-label="Teks Deskripsi / Kualifikasi Lowongan Lengkap"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Tempel teks kualifikasi lengkap di sini jika lowongan berupa pesan teks atau tidak ada link publik..."
                className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-faint transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-end gap-2.5 border-t border-border pt-4">
            <button
              type="button"
              onClick={() => setShowManualForm(false)}
              className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-xl border border-border bg-background px-4 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={formSubmitting}
              className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-xl border border-border bg-surface-hover px-4 text-xs font-semibold text-foreground transition-colors hover:border-brand/40 hover:text-brand-text disabled:opacity-50"
            >
              Simpan ke Daftar
            </button>
            {(formUrl.trim() || formDescription.trim()) && (
              <button
                type="button"
                disabled={formSubmitting}
                onClick={(e) => handleManualSubmit(e, true)}
                className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-brand px-4 text-xs font-semibold text-brand-foreground shadow-xs transition-colors hover:bg-brand-200 disabled:opacity-50"
              >
                <Sparkles className="size-3.5" />
                Simpan &amp; Analisis AI Langsung
              </button>
            )}
          </div>
        </form>
      )}

      {/* Search Filter for Saved List */}
      {/* Status Filter & Search Toolbar */}
      <div className="mb-6 space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-xs">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <input
              type="text"
              aria-label="Cari lowongan tersimpan"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari posisi, perusahaan, atau catatan tersimpan..."
              className="h-9 w-full rounded-xl border border-border bg-background px-3.5 text-xs text-foreground placeholder:text-faint transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <span role="status" className="text-xs text-muted font-medium">{filtered.length} sesuai filter / {savedJobs.length} tersimpan</span>
        </div>

        {/* Status Triage Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
          <span className="mr-1 text-xs font-medium text-muted">Status:</span>
          {[
            ["ALL", `Semua (${savedJobs.length})`],
            ...(followUpDueCount > 0 ? [["followup", `Perlu Follow-up (${followUpDueCount})`]] : []),
            ["untracked", `Belum dilacak (${savedJobs.filter((j) => !j.trackerN).length})`],
            ...CANONICAL_STATES.map((status) => [canonStatus(status), `${status} (${savedJobs.filter((j) => j.trackerN && canonStatus(j.applicationStatus || "") === canonStatus(status)).length})`]),
          ].map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => setStatusFilter(val)}
              aria-pressed={statusFilter === val}
              className={cn(
                "inline-flex h-8 items-center rounded-lg border px-2.5 text-xs font-medium whitespace-nowrap transition-colors",
                statusFilter === val
                  ? "border-brand/50 bg-brand-soft text-brand-text font-semibold shadow-xs"
                  : "border-border bg-background text-muted hover:border-brand/35 hover:bg-surface-hover hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Saved Jobs List */}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-xs">
        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <Bookmark className="mx-auto size-10 text-muted/30" />
            <h3 className="mt-3 text-sm font-semibold text-foreground">{savedJobs.length ? "Tidak ada lowongan sesuai filter" : "Belum ada lowongan tersimpan"}</h3>
            <p className="mt-1 text-xs text-muted max-w-md mx-auto">
              {savedJobs.length ? "Ubah kata kunci atau pilih Semua status. Lowongan tersimpan Anda tetap ada." : "Simpan dari Katalog Lowongan atau tambahkan lowongan manual."}
            </p>
            <Link
              href="/loker"
              className="mt-4 inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-brand px-4 text-xs font-semibold text-brand-foreground shadow-xs transition-colors hover:bg-brand-200"
            >
              Buka Katalog Lowongan
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((job) => {
              // Check if there is an active running job or completed result for this URL
              const analysisInput = job.url || `local:manual/${job.id}`;
              const activeRunner = runningJobs.find((rj) => rj.kind === "evaluate" && (canonicalJobKey(rj.input) || rj.input) === (canonicalJobKey(analysisInput) || analysisInput));
              const coverRunner = runningJobs.find((rj) => rj.kind === "cover" && (canonicalJobKey(rj.input) || rj.input) === (canonicalJobKey(analysisInput) || analysisInput));
              const isRunning = activeRunner?.status === "running";
              const isDone = activeRunner?.status === "done";
              const trackerScore = job.evaluatedScore?.trim();
              const savedScore = isDone && activeRunner.reportN && activeRunner.result?.score != null
                ? `${activeRunner.result.score}/5`
                : trackerScore && /^(?:[0-4](?:\.\d+)?|5(?:\.0+)?)\/5$/.test(trackerScore) ? trackerScore : null;
              const currentStatus = CANONICAL_STATES.find((status) => canonStatus(status) === canonStatus(job.applicationStatus || "")) || job.applicationStatus || "";
              const statusTone = canonStatus(currentStatus);
              const isDeleting = deletingId === job.id;
              const effectiveCoverText = coverRunner?.status === "done" && coverRunner.text ? coverRunner.text : job.coverDraft || "";
              const coverProvider = (coverRunner?.status === "done" ? coverRunner.provenance?.provider : job.coverProvider) || coverRunner?.provenance?.provider || "Belum diketahui";
              const coverModel = (coverRunner?.status === "done" ? coverRunner.provenance?.model : job.coverModel) || coverRunner?.provenance?.model || "Belum diketahui";
              const closing = closesSoonInfo(job.closesAt);
              const followUp = followUpDueInfo(job);

              return (
                <div key={job.id || job.url} className="divide-y divide-border/40 transition-colors hover:bg-surface-hover/30">
                  <div className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-center sm:px-6">
                  {/* Left Column: Details */}
                  <div className="flex min-w-0 flex-1 items-start gap-4">
                    <CompanyLogo name={job.company} size={44} className="mt-0.5 rounded-xl border border-border bg-surface shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/loker/${job.id}`}
                          className="font-medium text-foreground hover:text-brand-text hover:underline text-base"
                        >
                          {job.role}
                        </Link>
                        <span className="inline-flex items-center rounded-md border border-border bg-background/60 px-2 py-0.5 text-[11px] font-normal text-muted">
                          {job.source || "Manual"}
                        </span>
                        {job.workplaceType === "remote" && (
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:text-emerald-400">
                            Remote / WFH
                          </span>
                        )}
                        {closing && !closing.expired && (
                          <span className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                            closing.urgent ? "border-amber-500/45 bg-amber-500/15 text-amber-800 dark:text-amber-300" : "border-border bg-background text-muted"
                          )}>
                            <CalendarClock className="size-3" />
                            {closing.label}
                          </span>
                        )}
                        {followUp.due && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold text-sky-800 dark:text-sky-300">
                            <Send className="size-3" />
                            {followUp.label}
                          </span>
                        )}
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                        <span className="font-medium text-foreground/80 flex items-center gap-1">
                          <Building2 className="size-3 text-muted" />
                          {job.company}
                        </span>
                        {job.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="size-3 text-muted" />
                            {job.location}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="size-3 text-muted" />
                          Disimpan: {formatJakartaTimestamp(job.savedAt) || "Belum diketahui"}
                        </span>
                      </div>

                      {/* Kompensasi & Preview Deskripsi */}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {job.compensation && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                            <DollarSign className="size-3" />
                            {job.compensation}
                          </span>
                        )}
                        {job.description && (
                          <span className="text-xs text-muted truncate max-w-lg italic">
                            &quot;{job.description.slice(0, 120)}...&quot;
                          </span>
                        )}
                      </div>
                      {job.identityWarning && <p role="alert" className="mt-2 text-xs text-amber-800 dark:text-amber-300">{job.identityWarning}</p>}
                      {job.trackerN && <p className="mt-2 text-xs text-muted">Status tracker: {job.applicationStatus || "Belum diketahui"} • #{job.trackerN}</p>}
                      {(activeRunner?.status === "error" || activeRunner?.status === "gated") && <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-300">{activeRunner.gate?.message || activeRunner.error || activeRunner.steps.at(-1)?.label || "Evaluasi gagal. Coba kembali."}</p>}
                      {(coverRunner?.status === "error" || coverRunner?.status === "gated") && <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-300">{coverRunner.gate?.message || coverRunner.error || coverRunner.steps.at(-1)?.label || "Draf surat gagal. Coba kembali."}</p>}
                      {activeRunner?.persistenceError && <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-300">{activeRunner.persistenceError}</p>}
                      {coverRunner?.persistenceError && <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-300">{coverRunner.persistenceError}</p>}
                      {(activeRunner?.status === "error" || activeRunner?.status === "gated") && <p className="mt-2 text-xs text-muted">Provider evaluasi: {activeRunner.provenance?.provider || "Belum diketahui"} • Model: {activeRunner.provenance?.model || "Belum diketahui"}</p>}
                      {(coverRunner?.status === "error" || coverRunner?.status === "gated") && <p className="mt-2 text-xs text-muted">Provider surat: {coverRunner.provenance?.provider || "Belum diketahui"} • Model: {coverRunner.provenance?.model || "Belum diketahui"}</p>}

                      {/* Status Evaluasi AI */}
                      {isRunning && (
                        <div className="mt-2.5 inline-flex items-center gap-2 rounded-lg bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-text animate-pulse">
                          <Loader2 className="size-3.5 animate-spin" />
                          Sedang menganalisis kecocokan CV secara mendalam (Bahasa Indonesia)...
                        </div>
                      )}

                      {(savedScore || job.reportFile || (isDone && activeRunner.reportN)) && (
                        <div className="mt-2.5 flex items-center gap-3">
                          {savedScore && <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:text-emerald-400">
                            <CheckCircle2 className="size-3.5" />
                            Skor Evaluasi: {savedScore}
                          </span>}
                          {isDone && <span className="text-xs text-muted">Provider evaluasi: {activeRunner.provenance?.provider || "Belum diketahui"} • Model: {activeRunner.provenance?.model || "Belum diketahui"}</span>}
                          {(job.reportFile || activeRunner?.reportN) && (
                            <Link
                              href={`/loker/${job.id}`}
                              className="text-xs font-medium text-brand-text hover:underline flex items-center gap-1"
                            >
                              <FileText className="size-3.5" />
                              Buka Evaluasi Loker
                            </Link>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Column: Actions */}
                  <div className="flex flex-col gap-2.5 shrink-0 sm:items-end">
                    {/* Status Selector Dropdown */}
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-muted">Status:</span>
                      <select
                        aria-label={`Status lamaran ${job.role} di ${job.company}`}
                        disabled={updatingId !== null || deletingId !== null}
                        value={currentStatus}
                        onChange={(e) => handleUpdateStatus(job, e.target.value)}
                        className={cn(
                          "h-8 rounded-lg border px-2.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-brand/25",
                          statusTone === "applied"
                            ? "border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-200"
                            : statusTone === "interview"
                            ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 font-bold shadow-2xs"
                            : statusTone === "rejected" || statusTone === "discarded"
                            ? "border-rose-500/35 bg-rose-500/15 text-rose-700 dark:text-rose-300"
                            : "border-sky-500/35 bg-sky-500/15 text-sky-700 dark:text-sky-300"
                        )}
                      >
                        {!currentStatus && <option value="" disabled>Belum dilacak</option>}
                        {currentStatus && !CANONICAL_STATES.some((status) => status === currentStatus) && <option value={currentStatus} disabled>{currentStatus}</option>}
                        {CANONICAL_STATES.map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <button
                        type="button"
                        disabled={isRunning}
                        title="Ringkas — cek skor & kecocokan cepat"
                        onClick={() => launch(job, "evaluate", true)}
                        className="inline-flex h-8 items-center justify-center whitespace-nowrap rounded-lg border border-brand/40 bg-brand-soft px-3 text-xs font-semibold text-brand-text transition-colors hover:bg-brand/20 disabled:opacity-50"
                      >
                        Analisis Terfokus
                      </button>
                      <button
                        type="button"
                        disabled={isRunning}
                        title="Lengkap — laporan penuh A–H & strategi lamaran"
                        onClick={() => launch(job, "evaluate")}
                        className="inline-flex h-8 items-center justify-center whitespace-nowrap rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground transition-colors hover:border-brand/40 hover:bg-surface-hover disabled:opacity-50"
                      >
                        {isRunning ? "Menganalisis..." : "Analisis Lengkap"}
                      </button>
                      <button
                        type="button"
                        disabled={coverRunner?.status === "running"}
                        onClick={() => launch(job, "cover")}
                        className="inline-flex h-8 items-center justify-center whitespace-nowrap rounded-lg border border-purple-500/35 bg-purple-500/10 px-3 text-xs font-semibold text-purple-800 transition-colors hover:bg-purple-500/20 dark:text-purple-300 disabled:opacity-50"
                      >
                        {coverRunner?.status === "running" ? "Menyusun..." : "Draf Surat Lamaran"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingNotesId((prev) => (prev === job.id ? null : job.id));
                          setNotesDrafts((prev) => ({ ...prev, [job.id]: prev[job.id] ?? job.notes ?? "" }));
                        }}
                        className={cn(
                          "inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-lg border px-2.5 text-xs font-medium transition-colors",
                          editingNotesId === job.id || job.notes
                            ? "border-brand/40 bg-brand-soft text-brand-text"
                            : "border-border bg-background text-muted hover:border-brand/35 hover:text-foreground"
                        )}
                      >
                        <StickyNote className="size-3.5" />
                        <span>{job.notes ? "Catatan" : "Tambah Catatan"}</span>
                      </button>

                      {/* Tombol Link Asli */}
                      {job.url && !job.url.startsWith("local:") && (
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-background text-muted transition-colors hover:border-brand/40 hover:bg-surface-hover hover:text-foreground"
                          title="Buka situs lowongan asli"
                          aria-label={`Buka iklan asli ${job.role}`}
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      )}

                      {/* Tombol Hapus */}
                      <button
                        type="button"
                        disabled={deletingId !== null || updatingId !== null}
                        onClick={() => handleDelete(job)}
                        className={cn(
                          "inline-flex h-8 items-center justify-center gap-1 whitespace-nowrap rounded-lg border text-xs transition-colors",
                          pendingDelete === job.id
                            ? "border-red-500/45 bg-red-500/15 px-2.5 font-semibold text-red-700 dark:text-red-300"
                            : "w-8 border-border bg-background text-muted hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-400"
                        )}
                        title="Hapus dari daftar tersimpan"
                        aria-label={pendingDelete === job.id ? `Konfirmasi hapus ${job.role}` : `Hapus ${job.role} dari tersimpan`}
                      >
                        {isDeleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                        {pendingDelete === job.id && <span>Konfirmasi hapus</span>}
                      </button>
                      {pendingDelete === job.id && (
                        <button
                          type="button"
                          onClick={() => setPendingDelete(null)}
                          className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-muted hover:bg-surface-hover hover:text-foreground"
                        >
                          Batal
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {editingNotesId === job.id && (
                  <div className="border-t border-border bg-background/40 p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                        <StickyNote className="size-3.5 text-brand-text" />
                        Catatan Pribadi — tersimpan permanen
                      </span>
                      <button type="button" onClick={() => setEditingNotesId(null)} className="text-xs text-muted hover:text-foreground">
                        Tutup
                      </button>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <textarea
                        rows={2}
                        aria-label={`Catatan pribadi ${job.role}`}
                        value={notesDrafts[job.id] ?? job.notes ?? ""}
                        onChange={(e) => setNotesDrafts((prev) => ({ ...prev, [job.id]: e.target.value }))}
                        placeholder="Catat kontak HRD, nominal tawaran, atau pengingat follow-up..."
                        className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-xs text-foreground placeholder:text-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                      />
                      <button
                        type="button"
                        disabled={savingNotesId === job.id}
                        onClick={() => handleSaveNotes(job)}
                        className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-border bg-surface px-3.5 text-xs font-semibold text-foreground transition-colors hover:border-brand/40 hover:text-brand-text disabled:opacity-50"
                      >
                        {savingNotesId === job.id ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                        <span>Simpan Catatan</span>
                      </button>
                    </div>
                  </div>
                )}

                {effectiveCoverText && (
                  <div className="border-t border-border bg-background/40 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Draf Surat Lamaran — tinjau sebelum mengirim</h3><button type="button" onClick={() => copyResult(job.id, effectiveCoverText)} className="inline-flex h-8 items-center rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-brand-text hover:bg-surface-hover">{copiedKey === job.id ? "Tersalin" : "Salin surat"}</button></div>
                    <p className="mb-3 text-xs text-muted">Provider: {coverProvider} • Model: {coverModel}{job.coverDraft ? " • Tersimpan di bookmark" : ""}</p>
                    <ReportMarkdown>{effectiveCoverText}</ReportMarkdown>
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

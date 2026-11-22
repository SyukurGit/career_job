"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bookmark, BookmarkCheck, ExternalLink, Search, Radar, ChevronLeft, ChevronRight, X, EyeOff, RotateCcw, Sparkles, CalendarClock, Loader2 } from "lucide-react";
import { CompanyLogo } from "@/components/company-logo";
import { cn } from "@/lib/cn";
import type { CatalogJob } from "@/lib/catalog-job";
import type { SavedJob } from "@/lib/saved-job";
import { salaryMonthlyComparable } from "@/lib/salary.mjs";
import { CONFIG_KEY, subscribeConfig } from "@/lib/config-events.mjs";
import { readCatalogQuery, writeCatalogQuery, selectCatalogJobs, classifyCatalogGeography, isNewCatalogJob } from "@/lib/catalog-ui.mjs";
import { JobTimestampChips } from "@/components/loker/timestamp-chips";
import { closesSoonInfo } from "@/lib/pipeline-insights.mjs";
import { useJobs } from "@/components/jobs/job-store";
import { canonicalJobKey } from "@/lib/core/url-key.mjs";
import { ESSENTIAL_EVALUATION } from "@/lib/evaluation-options.mjs";

const HIDDEN_JOBS_KEY = "dreamkur-job:hidden-jobs";
const DEFAULT_STACK_CHIPS = ["Backend", "Software Engineer", "System Integration", "Full Stack", "Laravel", "Go", "Node.js", "Next.js"];

export function LokerView({ initialJobs, initialSaved, quickRoles = [] }: { initialJobs: CatalogJob[]; initialSaved: SavedJob[]; quickRoles?: string[] }) {
  const [filters, setFilters] = useState(() => readCatalogQuery());
  const [ready, setReady] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [preferences, setPreferences] = useState({ onlyRemoteDefault: false, minSalary: 5000000 });
  const [savedJobs, setSavedJobs] = useState(initialSaved);
  const { startJob } = useJobs();
  const [savingUrl, setSavingUrl] = useState<string | null>(null);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setNowMs(Date.now());
    setFilters(readCatalogQuery(window.location.search));
    setCatalogSearch(window.location.search);
    setReady(true);
    try {
      const storedHidden = JSON.parse(localStorage.getItem(HIDDEN_JOBS_KEY) || "[]");
      if (Array.isArray(storedHidden)) setHiddenIds(storedHidden.filter((id): id is string => typeof id === "string"));
    } catch { /* ignore invalid localStorage */ }
    const load = () => {
      try {
        const value = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
        setPreferences({ onlyRemoteDefault: typeof value.onlyRemoteDefault === "boolean" ? value.onlyRemoteDefault : false, minSalary: Number.isFinite(Number(value.minSalary)) && Number(value.minSalary) >= 0 ? Number(value.minSalary) : 5000000 });
      } catch { setError("Preferensi browser tidak dapat dibaca; menggunakan nilai bawaan."); }
    };
    load();
    const unsubscribe = subscribeConfig(window, load);
    const restore = () => { setFilters(readCatalogQuery(window.location.search)); setCatalogSearch(window.location.search); };
    window.addEventListener("popstate", restore);
    return () => { unsubscribe(); window.removeEventListener("popstate", restore); };
  }, []);
  useEffect(() => {
    if (ready) window.history.replaceState(window.history.state, "", `/loker${writeCatalogQuery(filters, catalogSearch)}`);
  }, [filters, ready, catalogSearch]);
  const update = (patch: Partial<typeof filters>) => setFilters((old) => ({ ...old, ...patch, page: 1 }));
  const toggleHideJob = (id: string) => {
    setHiddenIds((prev) => {
      const next = prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id];
      try { localStorage.setItem(HIDDEN_JOBS_KEY, JSON.stringify(next)); } catch { /* ignore quota error */ }
      return next;
    });
  };
  const clearHiddenJobs = () => {
    setHiddenIds([]);
    setShowHidden(false);
    try { localStorage.removeItem(HIDDEN_JOBS_KEY); } catch { /* ignore */ }
  };
  const hiddenSet = useMemo(() => new Set(hiddenIds), [hiddenIds]);
  const onlyRemote = filters.remote ?? preferences.onlyRemoteDefault;
  const savedUrls = useMemo(() => new Set(savedJobs.map((job) => canonicalJobKey(job.url) || job.url)), [savedJobs]);
  const eligibleCount = initialJobs.filter((job) => job.eligibility === "eligible").length;
  const unknownCount = initialJobs.filter((job) => !job.eligibility || job.eligibility === "unknown").length;
  const focusCounts = useMemo(() => {
    let aceh = 0;
    let remoteGlobal = 0;
    let remoteId = 0;
    let fresh = 0;
    for (const job of initialJobs) {
      if ((job.eligibility || "unknown") !== filters.eligibility) continue;
      if (hiddenSet.has(job.id)) continue;
      const geo = classifyCatalogGeography(job);
      if (geo.tier === "aceh_focus" || geo.tier === "aceh_onsite") aceh++;
      if (geo.tier === "remote_global") remoteGlobal++;
      if (geo.tier === "remote_id" || (geo.tier === "remote_global" && /\bindonesia\b/i.test(job.location || ""))) remoteId++;
      if (isNewCatalogJob(job)) fresh++;
    }
    return { aceh, remoteGlobal, remoteId, fresh };
  }, [initialJobs, filters.eligibility, hiddenSet]);
  const quickChips = useMemo(() => {
    const merged = [...quickRoles.map((r) => r.replace(/\s+Developer$/i, "")), ...DEFAULT_STACK_CHIPS];
    const out: string[] = [];
    for (const item of merged) {
      const norm = item.trim();
      if (!norm) continue;
      const key = norm.toLowerCase();
      if (out.some((existing) => existing.toLowerCase() === key || existing.toLowerCase().includes(key))) continue;
      out.push(norm);
      if (out.length >= 8) break;
    }
    return out;
  }, [quickRoles]);
  const { results: rawResults, contextualCount, portals } = useMemo(
    () => selectCatalogJobs(initialJobs, filters, preferences, savedJobs),
    [initialJobs, filters, preferences, savedJobs]
  );
  const results = rawResults as CatalogJob[];
  const visibleResults = useMemo(
    () => (showHidden || hiddenSet.size === 0 ? results : results.filter((job) => !hiddenSet.has(job.id))),
    [results, showHidden, hiddenSet]
  );
  const hiddenInPoolCount = useMemo(
    () => results.filter((job) => hiddenSet.has(job.id)).length,
    [results, hiddenSet]
  );
  const totalPages = Math.max(1, Math.ceil(visibleResults.length / filters.size));
  const page = Math.min(filters.page, totalPages);
  const pageJobs: CatalogJob[] = visibleResults.slice((page - 1) * filters.size, page * filters.size);
  const query = writeCatalogQuery({ ...filters, page }, catalogSearch);
  const toggleSave = async (job: CatalogJob) => {
    setSavingUrl(job.url); setError("");
    try {
      const res = await fetch("/api/saved-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "toggle", job: { ...job, notes: job.note } }) });
      const data = await res.json();
      if (!res.ok || !data.ok || !Array.isArray(data.jobs)) throw new Error(data.error || "Gagal mengubah simpanan.");
      setSavedJobs(data.jobs);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Gagal mengubah simpanan."); }
    finally { setSavingUrl(null); }
  };
  const toggleSelect = (id: string) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  const runBatchAction = async (analyzeAfter: boolean) => {
    const picked = visibleResults.filter((j) => selectedIds.includes(j.id)).slice(0, analyzeAfter ? 5 : 15);
    if (!picked.length) return;
    setBatchBusy(true);
    setError("");
    try {
      for (const job of picked) {
        const res = await fetch("/api/saved-jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "add", job: { ...job, notes: job.note } }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok || !Array.isArray(data.jobs)) throw new Error(data.error || `Gagal menyimpan ${job.role}.`);
        setSavedJobs(data.jobs);
        if (analyzeAfter) {
          startJob({
            title: `Evaluasi · ${job.company}`,
            subtitle: job.role,
            kind: "evaluate",
            input: job.url,
            page: `/loker/${job.id}`,
            evaluationSections: [...ESSENTIAL_EVALUATION],
          });
        }
      }
      setSelectedIds([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal menjalankan aksi massal.");
    } finally {
      setBatchBusy(false);
    }
  };
  const fieldControl = "h-9 rounded-xl border border-border bg-background px-3 text-sm text-foreground transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";
  const actionButton = "inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-border bg-background px-3.5 text-sm font-medium text-foreground transition-colors hover:border-brand/40 hover:bg-surface-hover hover:text-brand-text disabled:pointer-events-none disabled:opacity-45";
  const pillBase = "inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border px-3.5 text-xs sm:text-sm font-medium transition-colors";
  return <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
    <header className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Katalog Lowongan Kerja</h1>
        <p className="mt-1 text-sm text-muted">Fokus Banda Aceh &amp; Aceh Besar (on-site), serta Remote Indonesia &amp; Remote Global di luar Aceh.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <Link href="/scanner" className={actionButton}><Radar className="size-4 text-brand-text" /><span>Pusat Scan</span></Link>
        <Link href="/loker/tersimpan" className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-brand/40 bg-brand-soft px-3.5 text-sm font-semibold text-brand-text transition-colors hover:bg-brand/20"><Bookmark className="size-4" /><span>Tersimpan ({savedJobs.length})</span></Link>
      </div>
    </header>
    {error && <p role="alert" className="mb-4 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-2.5 text-sm text-red-700 dark:text-red-300">{error}</p>}
    <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4" aria-label="Ringkasan fokus lowongan">
      {([
        ["aceh_focus", "Banda Aceh & Aceh Besar", focusCounts.aceh, filters.focus === "aceh_focus", () => update({ focus: filters.focus === "aceh_focus" ? "ALL" : "aceh_focus" })],
        ["remote_global", "Remote Global", focusCounts.remoteGlobal, filters.focus === "remote_global", () => update({ focus: filters.focus === "remote_global" ? "ALL" : "remote_global" })],
        ["remote_id", "Remote Indonesia", focusCounts.remoteId, filters.focus === "remote_id", () => update({ focus: filters.focus === "remote_id" ? "ALL" : "remote_id" })],
        ["only_new", "Baru (< 24 jam)", focusCounts.fresh, filters.onlyNew, () => update({ onlyNew: !filters.onlyNew })],
      ] as const).map(([key, label, count, active, onToggle]) => (
        <button
          key={key}
          type="button"
          aria-pressed={active}
          onClick={onToggle}
          className={cn(
            "flex items-center justify-between rounded-2xl border px-3.5 py-2.5 text-left transition-colors",
            active
              ? "border-brand/50 bg-brand-soft text-brand-text shadow-2xs"
              : "border-border bg-surface text-foreground hover:border-brand/35 hover:bg-surface-hover"
          )}
        >
          <span className="text-xs font-medium leading-tight">{label}</span>
          <span className="ml-2 rounded-lg border border-border/70 bg-background/80 px-2 py-0.5 text-xs font-bold tabular-nums text-foreground">{count}</span>
        </button>
      ))}
    </div>
    <section aria-label="Filter katalog" className="mb-6 space-y-3 rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          aria-label="Cari lowongan"
          value={filters.q}
          onChange={(e) => update({ q: e.target.value })}
          placeholder="Cari posisi, perusahaan, teknologi, Banda Aceh..."
          className="h-10 w-full rounded-xl border border-border bg-background pl-10 pr-9 text-sm text-foreground placeholder:text-faint transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
        {filters.q && (
          <button
            type="button"
            aria-label="Hapus pencarian"
            onClick={() => update({ q: "" })}
            className="absolute right-2.5 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Kata kunci cepat">
        <span className="mr-1 text-[11px] font-medium text-muted">Cepat:</span>
        {quickChips.map((chip) => {
          const isActive = filters.q.trim().toLowerCase() === chip.toLowerCase();
          return (
            <button
              key={chip}
              type="button"
              aria-pressed={isActive}
              onClick={() => update({ q: isActive ? "" : chip })}
              className={cn(
                "inline-flex h-7 items-center rounded-lg border px-2.5 text-xs font-medium transition-colors",
                isActive
                  ? "border-brand/50 bg-brand-soft font-semibold text-brand-text"
                  : "border-border bg-background text-muted hover:border-brand/35 hover:text-foreground"
              )}
            >
              {chip}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2" aria-label="Kelayakan lokasi">
          {[["eligible", `Memenuhi lokasi (${eligibleCount})`], ["unknown", `Perlu cek lokasi (${unknownCount})`]].map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filters.eligibility === value}
              onClick={() => update({ eligibility: value as typeof filters.eligibility })}
              className={cn(
                pillBase,
                filters.eligibility === value
                  ? "border-brand/50 bg-brand-soft font-semibold text-brand-text"
                  : "border-border bg-background text-muted hover:border-brand/35 hover:bg-surface-hover hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Status evaluasi & kualitas">
          {([
            ["ALL", "Semua Status AI"],
            ["unevaluated", "Belum Dievaluasi"],
            ["evaluated", "Sudah Dievaluasi"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={(filters.evalState || "ALL") === value}
              onClick={() => update({ evalState: value })}
              className={cn(
                "inline-flex h-8 items-center justify-center whitespace-nowrap rounded-lg border px-2.5 text-xs font-medium transition-colors",
                (filters.evalState || "ALL") === value
                  ? "border-brand/45 bg-brand-soft font-semibold text-brand-text"
                  : "border-border bg-background text-muted hover:bg-surface-hover hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={filters.salary}
            onClick={() => update({ salary: !filters.salary })}
            className={cn(
              "inline-flex h-8 items-center justify-center whitespace-nowrap rounded-lg border px-2.5 text-xs font-medium transition-colors",
              filters.salary
                ? "border-emerald-500/45 bg-emerald-500/15 font-semibold text-emerald-800 dark:text-emerald-300"
                : "border-border bg-background text-muted hover:bg-surface-hover hover:text-foreground"
            )}
          >
            Ada Gaji
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Fokus geografi">
          {([
            ["ALL", "Semua Fokus"],
            ["aceh_focus", "Banda Aceh & Aceh Besar"],
            ["remote_global", "Remote Global"],
            ["remote_id", "Remote Indonesia"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filters.focus === value}
              onClick={() => update({ focus: value })}
              className={cn(
                "inline-flex h-8 items-center justify-center whitespace-nowrap rounded-lg border px-2.5 text-xs font-medium transition-colors",
                filters.focus === value
                  ? "border-emerald-500/45 bg-emerald-500/15 font-semibold text-emerald-800 dark:text-emerald-300"
                  : "border-border bg-background text-muted hover:border-border hover:bg-surface-hover hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {filters.eligibility === "unknown" && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          Menampilkan lowongan yang lokasinya belum mengonfirmasi domisili Anda secara eksplisit — cek syarat lokasi pada iklan asli sebelum melamar.
        </p>
      )}
      <details className="rounded-xl border border-border/70 bg-background/40 px-3.5 py-2.5"><summary className="cursor-pointer select-none text-sm font-semibold text-foreground">Filter lanjutan &amp; urutan</summary><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-medium text-muted">Portal (jumlah sesuai filter lain)<select aria-label="Portal" value={filters.portal} onChange={(e) => update({ portal: e.target.value })} className={`${fieldControl} mt-1.5 w-full`}><option value="ALL">Semua Portal ({contextualCount})</option>{portals.map(([source, count]) => <option key={source} value={source}>{source} ({count})</option>)}</select></label>
        <label className="text-xs font-medium text-muted">Diposting, hari kalender WIB<select aria-label="Umur publikasi" value={filters.age} onChange={(e) => update({ age: e.target.value })} className={`${fieldControl} mt-1.5 w-full`}>{[["ALL", "Semua umur"], ["1D", "Hari ini (WIB)"], ["3D", "3 hari kalender"], ["7D", "7 hari kalender"], ["14D", "14 hari kalender"], ["30D", "30 hari kalender"], ["60D", "60 hari kalender"]].map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
        <label className="text-xs font-medium text-muted">Urutkan<select aria-label="Urutkan lowongan" value={filters.sort} onChange={(e) => update({ sort: e.target.value })} className={`${fieldControl} mt-1.5 w-full`}><option value="newest">Diposting terbaru</option><option value="priority">Prioritas Lokasi (Aceh -&gt; Global)</option><option value="oldest">Diposting terlama</option><option value="salary_high">Gaji bulanan tertinggi (IDR)</option><option value="company_asc">Perusahaan A–Z</option></select></label>
        <label className="text-xs font-medium text-muted">Per halaman<select aria-label="Lowongan per halaman" value={filters.size} onChange={(e) => update({ size: Number(e.target.value) })} className={`${fieldControl} mt-1.5 w-full`}>{[15, 30, 50].map((v) => <option key={v}>{v}</option>)}</select></label>
        <label className="flex min-h-[38px] items-center gap-2.5 rounded-xl border border-border/70 bg-background px-3 py-2 text-sm text-foreground transition-colors hover:border-brand/35"><input type="checkbox" className="size-4 shrink-0 accent-brand" checked={onlyRemote} onChange={(e) => update({ remote: e.target.checked })} />Hanya Remote</label>
        <label className="flex min-h-[38px] items-center gap-2.5 rounded-xl border border-border/70 bg-background px-3 py-2 text-sm text-foreground transition-colors hover:border-brand/35"><input type="checkbox" className="size-4 shrink-0 accent-brand" checked={filters.salary} onChange={(e) => update({ salary: e.target.checked })} />Ada Gaji</label>
        <label className="flex min-h-[38px] items-center gap-2.5 rounded-xl border border-border/70 bg-background px-3 py-2 text-sm text-foreground transition-colors hover:border-brand/35"><input type="checkbox" className="size-4 shrink-0 accent-brand" checked={filters.junior} onChange={(e) => update({ junior: e.target.checked })} />Junior / Entry</label>
        <label className="flex min-h-[38px] items-center gap-2.5 rounded-xl border border-border/70 bg-background px-3 py-2 text-sm text-foreground transition-colors hover:border-brand/35"><input type="checkbox" className="size-4 shrink-0 accent-brand" checked={filters.excludeSenior} onChange={(e) => update({ excludeSenior: e.target.checked })} />Tanpa Senior (5+ thn)</label>
        <label className="flex min-h-[38px] items-center gap-2.5 rounded-xl border border-border/70 bg-background px-3 py-2 text-sm text-foreground transition-colors hover:border-brand/35"><input type="checkbox" className="size-4 shrink-0 accent-brand" checked={filters.hideSaved} onChange={(e) => update({ hideSaved: e.target.checked })} />Sembunyikan Tersimpan</label>
      </div></details>
      <p className="text-xs text-muted">Target gaji bulanan: Rp {preferences.minSalary.toLocaleString("id-ID")}, dari Pengaturan. Gaji IDR di bawah target diberi catatan, bukan disembunyikan.</p>
    </section>
    <section aria-label={filters.eligibility === "unknown" ? "Perlu cek lokasi" : "Lowongan memenuhi lokasi"} className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background/40 px-4 py-3 text-xs text-muted">
        <span>{visibleResults.length} hasil sesuai filter • {eligibleCount} memenuhi lokasi / {unknownCount} perlu cek lokasi sebelum filter • Halaman {page}/{totalPages}</span>
        {hiddenInPoolCount > 0 && (
          <span className="flex items-center gap-2">
            <span>{hiddenInPoolCount} disembunyikan</span>
            <button type="button" onClick={() => setShowHidden((v) => !v)} className="font-medium text-brand-text hover:underline">
              {showHidden ? "Sembunyikan lagi" : "Tampilkan sementara"}
            </button>
            <button type="button" onClick={clearHiddenJobs} className="inline-flex items-center gap-1 font-medium text-foreground hover:text-brand-text">
              <RotateCcw className="size-3" /> Pulihkan
            </button>
          </span>
        )}
      </div>
      {selectedIds.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand/45 bg-brand-soft/80 px-4 py-3 text-sm">
          <span className="font-semibold text-brand-text">{selectedIds.length} lowongan dipilih</span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={batchBusy}
              onClick={() => void runBatchAction(false)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-foreground transition-colors hover:border-brand/40 hover:text-brand-text disabled:opacity-50"
            >
              {batchBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Bookmark className="size-3.5" />}
              <span>Simpan Semua</span>
            </button>
            <button
              type="button"
              disabled={batchBusy}
              onClick={() => void runBatchAction(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-semibold text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-50"
            >
              <Sparkles className="size-3.5" />
              <span>Simpan &amp; Analisis Terfokus (maks 5)</span>
            </button>
            <button
              type="button"
              disabled={batchBusy}
              onClick={() => setSelectedIds([])}
              className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-muted hover:text-foreground"
            >
              Batal
            </button>
          </div>
        </div>
      )}
      {!pageJobs.length ? <div className="p-12 text-center"><h2 className="font-semibold text-foreground">Tidak ada lowongan yang cocok</h2><p className="mt-2 text-sm text-muted">Ubah filter atau pilih Perlu cek lokasi.</p></div> : <div className="divide-y divide-border">{pageJobs.map((job) => {
        const monthlySalary = salaryMonthlyComparable(job.compensation);
        const isSaved = savedUrls.has(canonicalJobKey(job.url) || job.url);
        const isHidden = hiddenSet.has(job.id);
        const isSelected = selectedIds.includes(job.id);
        const isNew = isNewCatalogJob(job);
        const closing = closesSoonInfo(job.closesAt);
        const geo = classifyCatalogGeography(job);
        return <article key={job.url} className={cn("flex flex-col justify-between gap-4 p-4 transition-colors hover:bg-surface-hover/40 sm:flex-row sm:items-center sm:px-5", isHidden && "opacity-60", isSelected && "bg-brand-soft/30")}>
        <div className="flex min-w-0 items-start gap-3">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleSelect(job.id)}
            aria-label={`Pilih ${job.role} di ${job.company}`}
            className="mt-2.5 size-4 shrink-0 cursor-pointer accent-brand"
          />
          <CompanyLogo name={job.company} size={42} className="shrink-0 rounded-xl" /><div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/loker/${job.id}${query}`} className="font-semibold text-foreground hover:text-brand-text hover:underline">{job.role}</Link>
            {isNew && (
              <span className="inline-flex items-center rounded-full border border-brand/45 bg-brand-soft px-2 py-0.5 text-[10px] font-bold tracking-wide text-brand-text">
                BARU
              </span>
            )}
            {closing && !closing.expired && (
              <span className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                closing.urgent
                  ? "border-amber-500/45 bg-amber-500/15 text-amber-800 dark:text-amber-300"
                  : "border-border bg-background text-muted"
              )}>
                <CalendarClock className="size-3" />
                {closing.label}
              </span>
            )}
            {job.evaluatedScore && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                <Sparkles className="size-3" />
                Skor {job.evaluatedScore}
              </span>
            )}
            {(geo.tier === "aceh_focus" || geo.tier === "aceh_onsite" || geo.tier === "remote_global") && (
              <span className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                geo.tier === "aceh_focus" || geo.tier === "aceh_onsite"
                  ? "border-emerald-500/35 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"
                  : "border-sky-500/35 bg-sky-500/15 text-sky-700 dark:text-sky-300"
              )}>
                {geo.label}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted">{job.company} • {job.source}</p>
          <p className="mt-1 text-xs text-muted">{job.workplaceType === "remote" ? "Remote / WFH" : job.workplaceType === "onsite" ? "Onsite" : job.workplaceType === "hybrid" ? "Hybrid" : "Sistem kerja belum diketahui"} • {job.location || "Lokasi belum diketahui"}</p>
          <p className="mt-1 text-xs text-foreground/90" title={job.eligibilityReason}>{job.eligibility === "eligible" ? "Memenuhi kebijakan lokasi" : "Perlu cek lokasi"}{job.eligibilityReason ? ` — ${job.eligibilityReason}` : ""}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <JobTimestampChips job={job} nowMs={nowMs} />
          </div>
          {job.compensation && <p className="mt-2 text-sm font-semibold text-emerald-800 dark:text-emerald-300">{job.compensation}{monthlySalary === null ? " • Belum dapat dibandingkan" : monthlySalary < preferences.minSalary ? " • Di bawah target gaji" : ""}</p>}{job.yrs && <p className="text-xs text-muted">Pengalaman: {job.yrs}</p>}{job.note && <p className="mt-1 line-clamp-2 text-xs text-muted">{job.note}</p>}
        </div></div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={savingUrl !== null}
            aria-pressed={isSaved}
            aria-label={`${isSaved ? "Batalkan simpan" : "Simpan"} ${job.role} di ${job.company}`}
            onClick={() => toggleSave(job)}
            className={cn(
              actionButton,
              isSaved && "border-brand/45 bg-brand-soft font-semibold text-brand-text"
            )}
          >
            {isSaved ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
            <span>{savingUrl === job.url ? "Menyimpan..." : isSaved ? "Tersimpan" : "Simpan"}</span>
          </button>
          <button
            type="button"
            onClick={() => toggleHideJob(job.id)}
            title={isHidden ? "Tampilkan kembali lowongan ini" : "Sembunyikan sementara dari katalog"}
            aria-label={`${isHidden ? "Pulihkan" : "Sembunyikan"} ${job.role} di ${job.company}`}
            className="inline-flex size-9 items-center justify-center rounded-xl border border-border bg-background text-muted transition-colors hover:border-brand/40 hover:bg-surface-hover hover:text-foreground"
          >
            <EyeOff className="size-4" />
          </button>
          <a
            href={job.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Buka iklan asli ${job.role}`}
            className="inline-flex size-9 items-center justify-center rounded-xl border border-border bg-background text-muted transition-colors hover:border-brand/40 hover:bg-surface-hover hover:text-foreground"
          >
            <ExternalLink className="size-4" />
          </a>
        </div>
      </article>; })}</div>}
      {totalPages > 1 && <nav aria-label="Halaman katalog" className="flex items-center justify-between border-t border-border bg-background/30 px-4 py-3.5"><button type="button" className={actionButton} disabled={page <= 1} onClick={() => setFilters((old) => ({ ...old, page: page - 1 }))}><ChevronLeft className="size-4" /><span>Sebelumnya</span></button><span className="text-sm font-medium tabular-nums text-muted">{page} / {totalPages}</span><button type="button" className={actionButton} disabled={page >= totalPages} onClick={() => setFilters((old) => ({ ...old, page: page + 1 }))}><span>Selanjutnya</span><ChevronRight className="size-4" /></button></nav>}
    </section>
  </div>;
}

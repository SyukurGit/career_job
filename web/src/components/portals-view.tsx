"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Radar, Search, Wrench, X } from "lucide-react";
import { CompanyLogo } from "@/components/company-logo";
import { useJobs, type Job } from "@/components/jobs/job-store";
import { cn } from "@/lib/cn";
import type { ConfiguredPortal, WatchedCompany } from "@/lib/portals-config.mjs";
import { showPortalsSetup } from "@/lib/portals-setup.mjs";

type Company = { name: string; status: string; detail: string };
type Result = { available: boolean; configured: boolean; companies: Company[]; error?: string };
type StatusFilter = "all" | "active" | "paused";
type KindFilter = "all" | "board" | "company";
type HealthFilter = "all" | "live" | "broken" | "empty" | "skipped";

const TONE: Record<string, { dot: string; label: string; chip: string }> = {
  live: { dot: "bg-emerald-500", label: "aktif", chip: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-400" },
  empty: { dot: "bg-amber-500", label: "aktif · kosong", chip: "bg-amber-500/15 text-amber-800 dark:text-amber-400" },
  broken: { dot: "bg-red-500", label: "rusak", chip: "bg-red-500/15 text-red-700 dark:text-red-400" },
  skipped: { dot: "bg-zinc-400", label: "tanpa ATS", chip: "bg-surface-hover text-muted" },
};
const ORDER: Record<string, number> = { broken: 0, empty: 1, live: 2, skipped: 3 };
const PORTALS_BATCH = 40;

export function PortalsView({
  watched,
  portals,
  missing = false,
  target = "portals.yml",
}: {
  watched: WatchedCompany[];
  portals?: ConfiguredPortal[];
  missing?: boolean;
  target?: string;
}) {
  const [res, setRes] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [healthFilter, setHealthFilter] = useState<HealthFilter>("all");
  const [showAll, setShowAll] = useState(false);
  const [portalOverrides, setPortalOverrides] = useState<Record<string, boolean>>({});
  const [addedCompanies, setAddedCompanies] = useState<ConfiguredPortal[]>([]);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [adding, setAdding] = useState(false);
  const [manageError, setManageError] = useState("");
  const [manageNotice, setManageNotice] = useState("");
  const router = useRouter();
  const { jobs, startJob } = useJobs();

  const allPortals = useMemo<ConfiguredPortal[]>(() => {
    const base = portallist();
    return [...addedCompanies, ...base].map((p) => {
      const key = `${p.kind}:${p.name}`;
      return key in portalOverrides ? { ...p, enabled: portalOverrides[key] } : p;
    });
    function portallist() {
      if (portals) return portals;
      return watched.map((w) => ({
        name: w.name,
        enabled: w.enabled,
        kind: "company" as const,
        host: w.host,
        provider: "",
        notes: "",
      }));
    }
  }, [portals, watched, portalOverrides, addedCompanies]);

  useEffect(() => {
    setPortalOverrides({});
    setAddedCompanies([]);
  }, [portals, watched]);

  async function togglePortal(portal: ConfiguredPortal) {
    const key = `${portal.kind}:${portal.name}`;
    const nextEnabled = !portal.enabled;
    setTogglingKey(key);
    setManageError("");
    setManageNotice("");
    try {
      const r = await fetch("/api/portals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle_portal", name: portal.name, kind: portal.kind, enabled: nextEnabled }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || "Gagal memperbarui portals.yml");
      setPortalOverrides((prev) => ({ ...prev, [key]: nextEnabled }));
      setManageNotice(`${portal.name} ${nextEnabled ? "diaktifkan" : "dijeda"} di portals.yml.`);
      router.refresh();
    } catch (err) {
      setManageError(err instanceof Error ? err.message : "Gagal mengubah status portal.");
    } finally {
      setTogglingKey(null);
    }
  }

  async function addCompany(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setManageError("");
    setManageNotice("");
    try {
      const r = await fetch("/api/portals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_company", name: addName.trim(), careersUrl: addUrl.trim(), notes: addNotes.trim() }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || "Gagal menambahkan perusahaan ke portals.yml.");
      let host = "";
      try { host = new URL(addUrl.trim()).host; } catch { host = ""; }
      setAddedCompanies((prev) => [{ name: addName.trim(), enabled: true, kind: "company", host, provider: "", notes: addNotes.trim() }, ...prev]);
      setManageNotice(`Berhasil menambahkan ${addName.trim()} ke portals.yml.`);
      setAddName("");
      setAddUrl("");
      setAddNotes("");
      setShowAddForm(false);
      router.refresh();
    } catch (err) {
      setManageError(err instanceof Error ? err.message : "Gagal menambahkan perusahaan.");
    } finally {
      setAdding(false);
    }
  }

  // map the agentic "fix-portal" workers to the company they're repairing
  const fixByCompany = useMemo(() => {
    const m = new Map<string, Job>();
    for (const j of jobs) {
      if (j.kind !== "fix-portal" || !j.input) continue;
      const ex = m.get(j.input);
      if (!ex || j.startedAt > ex.startedAt) m.set(j.input, j);
    }
    return m;
  }, [jobs]);

  function check() {
    setLoading(true);
    fetch("/api/portals/verify", { method: "POST" })
      .then((r) => r.json())
      .then((d: Result) => setRes(d))
      .catch(() => setRes({ available: false, configured: false, companies: [], error: "Verify request failed." }))
      .finally(() => setLoading(false));
  }

  const companies = res?.companies ?? [];
  const broken = companies.filter((c) => c.status === "broken");
  const liveN = companies.filter((c) => c.status === "live" || c.status === "empty").length;
  const sorted = useMemo(
    () => [...companies].sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9)),
    [companies],
  );

  const filteredHealth = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sorted.filter((c) => {
      if (healthFilter !== "all" && c.status !== healthFilter) return false;
      if (q && !`${c.name} ${c.detail} ${c.status}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [sorted, healthFilter, query]);

  const activeCount = useMemo(() => allPortals.filter((p) => p.enabled).length, [allPortals]);
  const pausedCount = allPortals.length - activeCount;
  const boardCount = useMemo(() => allPortals.filter((p) => p.kind === "board").length, [allPortals]);
  const companyCount = allPortals.length - boardCount;

  const filteredPortals = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allPortals.filter((p) => {
      if (statusFilter === "active" && !p.enabled) return false;
      if (statusFilter === "paused" && p.enabled) return false;
      if (kindFilter !== "all" && p.kind !== kindFilter) return false;
      if (q) {
        const hay = `${p.name} ${p.host} ${p.provider} ${p.notes} ${p.kind} ${p.enabled ? "active" : "paused"}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allPortals, statusFilter, kindFilter, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={check}
          disabled={loading}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-50 max-sm:min-h-[44px]"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Radar className="size-4" />}
          Cek Kesehatan Portal
        </button>
        <button
          type="button"
          onClick={() => setShowAddForm((v) => !v)}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-medium text-foreground transition-colors hover:border-brand/40 hover:text-brand-text max-sm:min-h-[44px]"
        >
          <Plus className="size-4" />
          Tambah Portal / Perusahaan
        </button>
        {loading && <span className="text-xs text-faint">Memeriksa ATS tiap perusahaan… (~30–60 dtk)</span>}
      </div>

      {manageError && <p role="alert" className="rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-2.5 text-sm text-red-700 dark:text-red-300">{manageError}</p>}
      {manageNotice && <p role="status" className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-800 dark:text-emerald-300">{manageNotice}</p>}

      {showAddForm && (
        <form onSubmit={addCompany} className="rounded-2xl border border-brand/35 bg-surface p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Tambah Perusahaan / Situs Karir Lokal (portals.yml)</h2>
            <button type="button" onClick={() => setShowAddForm(false)} className="text-xs text-muted hover:text-foreground">Tutup</button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <input
              type="text"
              required
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="Nama perusahaan / instansi"
              aria-label="Nama perusahaan baru"
              className="h-9 rounded-xl border border-border bg-background px-3 text-sm text-foreground placeholder:text-faint focus:border-brand focus:outline-none"
            />
            <input
              type="url"
              required
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
              placeholder="https://karir.perusahaan.co.id/jobs"
              aria-label="URL karir perusahaan baru"
              className="h-9 rounded-xl border border-border bg-background px-3 text-sm text-foreground placeholder:text-faint focus:border-brand focus:outline-none"
            />
            <input
              type="text"
              value={addNotes}
              onChange={(e) => setAddNotes(e.target.value)}
              placeholder="Catatan (mis. Banda Aceh)"
              aria-label="Catatan portal baru"
              className="h-9 rounded-xl border border-border bg-background px-3 text-sm text-foreground placeholder:text-faint focus:border-brand focus:outline-none"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={adding}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand px-4 text-xs font-semibold text-brand-foreground hover:bg-brand-200 disabled:opacity-50"
            >
              {adding ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              <span>{adding ? "Menyimpan..." : "Simpan ke portals.yml"}</span>
            </button>
          </div>
        </form>
      )}

      {/* Search & active/paused filter bar — works both before and after health check */}
      {(allPortals.length > 0 || res?.configured) && (
        <div className="space-y-2.5 rounded-2xl border border-border bg-surface/50 p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
              <input
                type="search"
                aria-label="Cari portal"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setShowAll(false); }}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && query) {
                    e.preventDefault();
                    setQuery("");
                  }
                }}
                placeholder="Cari portal, perusahaan, atau provider (mis. linkedin, remotive, jeda)…"
                className="w-full rounded-lg border border-border bg-surface/80 py-2 pl-9 pr-9 text-sm outline-none transition-colors placeholder:text-faint focus:border-brand/50 focus-visible:ring-2 focus-visible:ring-brand/40 max-sm:min-h-[44px] [&::-webkit-search-cancel-button]:appearance-none"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Hapus pencarian portal"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-faint transition-colors hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            <span className="shrink-0 rounded-lg border border-border bg-surface/60 px-2.5 py-1.5 text-xs text-muted">
              <span className="font-medium tabular-nums text-foreground">
                {res?.configured ? filteredHealth.length : filteredPortals.length}
              </span>
              <span className="text-faint"> / {res?.configured ? companies.length : allPortals.length}</span>
            </span>
          </div>

          {!res?.configured ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div role="group" aria-label="Filter berdasarkan status" className="inline-flex rounded-lg border border-border bg-surface/60 p-0.5">
                {([
                  ["all", `Semua (${allPortals.length})`],
                  ["active", `Aktif (${activeCount})`],
                  ["paused", `Dijeda (${pausedCount})`],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={statusFilter === key}
                    onClick={() => { setStatusFilter(key); setShowAll(false); }}
                    className={cn(
                      "rounded-md px-2.5 py-1 font-medium transition-colors max-sm:min-h-[40px]",
                      statusFilter === key ? "bg-brand-soft text-brand-text" : "text-muted hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div role="group" aria-label="Filter berdasarkan jenis portal" className="inline-flex rounded-lg border border-border bg-surface/60 p-0.5">
                {([
                  ["all", "Semua jenis"],
                  ["board", `Board (${boardCount})`],
                  ["company", `Perusahaan (${companyCount})`],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={kindFilter === key}
                    onClick={() => { setKindFilter(key); setShowAll(false); }}
                    className={cn(
                      "rounded-md px-2.5 py-1 font-medium transition-colors max-sm:min-h-[40px]",
                      kindFilter === key ? "bg-brand-soft text-brand-text" : "text-muted hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div role="group" aria-label="Filter hasil pemeriksaan" className="inline-flex flex-wrap rounded-lg border border-border bg-surface/60 p-0.5 text-xs">
              {([
                ["all", `Semua (${companies.length})`],
                ["live", `Aktif (${companies.filter((c) => c.status === "live").length})`],
                ["empty", `Kosong (${companies.filter((c) => c.status === "empty").length})`],
                ["broken", `Rusak (${broken.length})`],
                ["skipped", `Tanpa ATS (${companies.filter((c) => c.status === "skipped").length})`],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={healthFilter === key}
                  onClick={() => { setHealthFilter(key); setShowAll(false); }}
                  className={cn(
                    "rounded-md px-2.5 py-1 font-medium transition-colors max-sm:min-h-[40px]",
                    healthFilter === key ? "bg-brand-soft text-brand-text" : "text-muted hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!res && allPortals.length > 0 && (
        <WatchedList
          portals={filteredPortals}
          activeCount={activeCount}
          pausedCount={pausedCount}
          showAll={showAll}
          onShowAll={() => setShowAll(true)}
          onToggle={(portal) => void togglePortal(portal)}
          togglingKey={togglingKey}
        />
      )}

      {res && !res.available && !res.error && (
        <p className="mt-4 rounded-xl border border-dashed border-border bg-surface/30 p-4 text-sm text-muted">
          <code className="text-foreground">verify-portals.mjs</code> tidak ditemukan — pastikan instalasi dreamkur -job lengkap.
        </p>
      )}
      {res && !res.available && res.error && (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-muted">
          <span className="font-medium text-red-700 dark:text-red-400">Pemeriksaan portal belum selesai</span> — belum ada
          portal yang terverifikasi. Coba lagi atau jalankan{" "}
          <code className="text-foreground">node verify-portals.mjs</code> untuk detailnya.{" "}
          <code className="break-all font-mono text-xs text-faint">{res.error}</code>
        </p>
      )}
      {showPortalsSetup(missing, res) && (
        <p className="mt-4 rounded-xl border border-dashed border-border bg-surface/30 p-4 text-sm text-muted">
          Belum ada <code className="break-all text-foreground">{target}</code>. Salin{" "}
          <code className="text-foreground">templates/portals.example.yml</code> ke{" "}
          <code className="break-all text-foreground">{target}</code> lalu isi daftar portal yang dipantau. Pemeriksaan kesehatan tidak membuat file tersebut secara otomatis.
        </p>
      )}

      {res && res.configured && (
        <div>
          <p className="text-sm text-muted">
            <span className="tabular-nums text-emerald-800 dark:text-emerald-400">{liveN}</span> aktif ·{" "}
            <span className="tabular-nums text-red-700 dark:text-red-400">{broken.length}</span> rusak ·{" "}
            <span className="tabular-nums">{companies.length}</span> diperiksa (
            <span className="tabular-nums">{pausedCount}</span> dijeda di <code>portals.yml</code>)
          </p>
          {broken.length > 0 && (
            <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm">
              <span className="font-medium text-red-700 dark:text-red-400">
                {broken.length} portal tidak merespons saat scan
              </span>{" "}
              <span className="text-muted">
                — tautan kariernya bermasalah. Perbaiki <code>careers_url</code> di <code>portals.yml</code> atau gunakan tombol Perbaiki.
              </span>
            </div>
          )}
          <ul className="mt-4 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface/40">
            {(showAll ? filteredHealth : filteredHealth.slice(0, PORTALS_BATCH)).map((c) => {
              const t = TONE[c.status] ?? TONE.skipped;
              return (
                <li key={c.name} className="flex items-center gap-3 px-4 py-2.5">
                  <CompanyLogo name={c.name} size={20} />
                  <span className={cn("size-1.5 shrink-0 rounded-full", t.dot)} />
                  <span className="shrink-0 text-sm font-medium">{c.name}</span>
                  <span className="truncate font-mono text-xs text-faint">{c.detail}</span>
                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    {c.status === "broken" && <FixAffordance company={c.name} job={fixByCompany.get(c.name)} onFix={() => startJob({ title: `Perbaiki · ${c.name}`, subtitle: "perbaiki slug portal", kind: "fix-portal", input: c.name, page: "/portals" })} />}
                    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", t.chip)}>{t.label}</span>
                  </div>
                </li>
              );
            })}
          </ul>
          {!showAll && filteredHealth.length > PORTALS_BATCH && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-border bg-surface/40 py-2.5 text-sm font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand-text"
            >
              Tampilkan semua {filteredHealth.length} hasil →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FixAffordance({ company, job, onFix }: { company: string; job?: Job; onFix: () => void }) {
  if (job?.status === "running")
    return (
      <Link href={`/jobs/${job.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand-text">
        <Loader2 className="size-3 animate-spin" /> Memperbaiki…
      </Link>
    );
  if (job?.status === "done")
    return (
      <Link href={`/jobs/${job.id}`} className="text-xs font-medium text-emerald-800 dark:text-emerald-400">
        diperbaiki · cek ulang
      </Link>
    );
  return (
    <button
      onClick={onFix}
      title={`Perbaiki tautan portal untuk ${company}`}
      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted transition-colors hover:border-brand/40 hover:text-brand-text"
    >
      <Wrench className="size-3" /> Perbaiki
    </button>
  );
}

function WatchedList({
  portals,
  activeCount,
  pausedCount,
  showAll,
  onShowAll,
  onToggle,
  togglingKey,
}: {
  portals: ConfiguredPortal[];
  activeCount: number;
  pausedCount: number;
  showAll: boolean;
  onShowAll: () => void;
  onToggle: (portal: ConfiguredPortal) => void;
  togglingKey: string | null;
}) {
  const visible = showAll ? portals : portals.slice(0, PORTALS_BATCH);
  return (
    <div>
      <p className="text-sm text-muted">
        <span className="tabular-nums text-emerald-800 dark:text-emerald-400 font-medium">{activeCount}</span> aktif ·{" "}
        <span className="tabular-nums text-foreground font-medium">{pausedCount}</span> dijeda · jalankan pemeriksaan kesehatan untuk melihat status tiap sumber, atau klik tombol status untuk mengaktifkan/menjeda sumber
      </p>
      {visible.length > 0 ? (
        <>
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface/40">
            {visible.map((p, i) => (
              <li key={`${i}-${p.kind}-${p.name}`} className={cn("flex items-center gap-3 px-4 py-2.5", !p.enabled && "opacity-70")}>
              <CompanyLogo name={p.name} size={20} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{p.name}</span>
                  <span className="rounded border border-border bg-surface px-1.5 py-px text-[10px] font-medium uppercase text-muted">
                    {p.kind === "board" ? "Board" : "Perusahaan"}
                  </span>
                  {p.provider && (
                    <span className="rounded bg-brand-soft/70 px-1.5 py-px font-mono text-[10px] text-brand-text">
                      {p.provider}
                    </span>
                  )}
                </div>
                {(p.host || p.notes) && (
                  <p className="mt-0.5 truncate text-xs text-faint" title={p.notes || p.host}>
                    {p.host ? <span className="font-mono text-muted">{p.host}</span> : null}
                    {p.host && p.notes ? " · " : ""}
                    {p.notes}
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={togglingKey === `${p.kind}:${p.name}`}
                onClick={() => onToggle(p)}
                title={p.enabled ? `Jeda scan untuk ${p.name}` : `Aktifkan scan untuk ${p.name}`}
                className={cn(
                  "ml-auto inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border px-2.5 text-[11px] font-semibold transition-colors disabled:opacity-50",
                  p.enabled
                    ? "border-emerald-500/35 bg-emerald-500/15 text-emerald-800 hover:bg-emerald-500/25 dark:text-emerald-400"
                    : "border-border bg-surface text-muted hover:border-brand/40 hover:text-foreground",
                )}
              >
                {togglingKey === `${p.kind}:${p.name}` ? "…" : p.enabled ? "Aktif" : "Dijeda"}
              </button>
            </li>
            ))}
          </ul>
          {!showAll && portals.length > PORTALS_BATCH && (
            <button
              type="button"
              onClick={onShowAll}
              className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-border bg-surface/40 py-2.5 text-sm font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand-text"
            >
              Tampilkan semua {portals.length} portal →
            </button>
          )}
        </>
      ) : (
        <div className="mt-3 rounded-2xl border border-dashed border-border bg-surface/30 px-6 py-10 text-center">
          <p className="font-display text-lg">Tidak ada portal yang cocok</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">Hapus kata pencarian atau ubah filter status.</p>
        </div>
      )}
    </div>
  );
}

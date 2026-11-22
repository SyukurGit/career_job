"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowRight, Play, Radar, RefreshCw, Square, Terminal } from "lucide-react";
import { confirmedScanSuccess, readScannerStream } from "@/lib/scanner-stream.mjs";
import type { ScannerEvent, ScannerRun } from "@/lib/scanner-contract";

type PortalHealth = { name: string; status: string; timestamp: string };
const labels = { running: "Berjalan", cancelling: "Sedang membatalkan", complete: "Selesai", partial: "Selesai sebagian", error: "Gagal", cancelled: "Dibatalkan" };
const number = (value?: number | null) => value == null ? "Belum terkonfirmasi" : value.toLocaleString("id-ID");

export function ScannerView() {
  const [activeRun, setActiveRun] = useState<ScannerRun | null>(null);
  const [latestReceipt, setLatestReceipt] = useState<ScannerRun | null>(null);
  const [portals, setPortals] = useState<PortalHealth[]>([]);
  const [sinceDays, setSinceDays] = useState("60");
  const [fresh, setFresh] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [streamError, setStreamError] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const consoleRef = useRef<HTMLDivElement>(null);
  const cursors = useRef(new Map<string, number>());
  const mounted = useRef(false);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/scanner", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      if (!mounted.current) return;
      setActiveRun(data.activeRun);
      setLatestReceipt(data.latestCompletedReceipt);
      setPortals(data.portals || []);
      setError("");
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : "Status scanner tidak tersedia.");
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void fetchStatus();
    const timer = setInterval(() => void fetchStatus(), 3000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, [fetchStatus]);

  const activeId = activeRun?.runId;
  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    let retryTimer: number | undefined;
    const connect = async () => {
      try {
        const after = cursors.current.get(activeId) || 0;
        const response = await fetch(`/api/scanner?runId=${encodeURIComponent(activeId)}&stream=1&after=${after}`, { signal: controller.signal, cache: "no-store" });
        await readScannerStream(response, (event: ScannerEvent) => {
          if (controller.signal.aborted) return;
          setStreamError("");
          if (event.id) cursors.current.set(activeId, event.id);
          if (event.type === "log" && event.data.text) {
            setLogs((previous) => [...previous, ...event.data.text!.split("\n").filter(Boolean)].slice(-1500));
          } else if (event.type === "end") {
            setLatestReceipt(event.data);
            setActiveRun((current) => current?.runId === activeId ? null : current);
            void fetchStatus();
          }
        });
      } catch (failure) {
        if (controller.signal.aborted) return;
        setStreamError(failure instanceof Error ? failure.message : "Koneksi log terputus.");
        void fetchStatus();
        retryTimer = window.setTimeout(() => void connect(), 1500);
      }
    };
    setLogs([]);
    void connect();
    return () => { controller.abort(); window.clearTimeout(retryTimer); };
  }, [activeId, fetchStatus]);

  useEffect(() => {
    if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [logs]);

  const start = async () => {
    if (pending || activeRun) return;
    setPending(true);
    setError("");
    setStreamError("");
    try {
      const response = await fetch("/api/scanner", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ since: sinceDays, fresh }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setActiveRun(data.activeRun);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Scanner gagal dimulai."); }
    finally { setPending(false); }
  };
  const stop = async () => {
    if (!activeRun || pending) return;
    setPending(true);
    try {
      const response = await fetch(`/api/scanner?runId=${encodeURIComponent(activeRun.runId)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Scan sudah tidak aktif. Segarkan status.");
      setActiveRun((current) => current ? { ...current, status: "cancelling" } : current);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Pembatalan gagal."); }
    finally { setPending(false); void fetchStatus(); }
  };
  const successful = confirmedScanSuccess(latestReceipt);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl"><Radar className="size-6 text-brand-text" /> Pemindaian Lowongan</h1>
          <p className="mt-1.5 text-sm text-muted">Scanner berjalan di server. Pindah halaman atau menutup tab tidak menghentikan scan.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/portals" className="inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-border bg-surface px-3.5 text-sm font-medium text-foreground transition-colors hover:border-brand/40 hover:text-brand-text">Sumber Portal</Link>
          <Link href="/loker?new=1" className="inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-border bg-surface px-3.5 text-sm font-medium text-foreground transition-colors hover:border-brand/40 hover:text-brand-text">Lowongan Baru (&lt; 24j)</Link>
          <Link href="/loker" className="inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-brand/40 bg-brand-soft px-3.5 text-sm font-medium text-brand-text transition-colors hover:bg-brand/20">Katalog semua lowongan <ArrowRight className="size-4" /></Link>
        </div>
      </div>
      {error && <p role="alert" className="mb-4 flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-400"><AlertCircle className="size-4 shrink-0" /><span>{error}</span></p>}
      <section className="mb-6 rounded-2xl border border-border bg-surface p-6">
        <h2 className="font-semibold text-foreground">Kontrol scan</h2>
        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:gap-5">
          <label className="text-sm font-medium text-foreground shrink-0">Usia publikasi lowongan
            <select disabled={!!activeRun || pending} value={sinceDays} onChange={(event) => setSinceDays(event.target.value)} className="mt-1.5 block h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20">
              <option value="7">7 hari</option><option value="14">14 hari</option><option value="30">30 hari</option><option value="60">60 hari (default)</option><option value="all">Semua usia</option>
            </select>
          </label>
          <label className="flex flex-1 max-w-lg items-start gap-2.5 rounded-xl border border-border/70 bg-background/60 px-3.5 py-2.5 text-sm text-foreground transition-colors hover:border-brand/35">
            <input type="checkbox" disabled={!!activeRun || pending} checked={fresh} onChange={(event) => setFresh(event.target.checked)} className="mt-0.5 size-4 shrink-0 accent-brand" />
            <span>
              <span className="font-medium">Ambil ulang sumber &amp; temukan ulang lowongan</span>
              <span className="mt-0.5 block text-xs text-muted">Lewati cache HTTP/parser dan dedup penemuan lama; keputusan aplikasi tetap dipertahankan. Bukan reset data.</span>
            </span>
          </label>
          <button
            type="button"
            disabled={pending || activeRun?.status === "cancelling"}
            onClick={() => void (activeRun ? stop() : start())}
            className={
              activeRun
                ? "inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-red-500/45 bg-red-500/15 px-5 text-sm font-semibold text-red-700 transition-colors hover:bg-red-500/25 disabled:opacity-50 dark:text-red-300"
                : "inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-brand px-5 text-sm font-semibold text-brand-foreground shadow-xs transition-colors hover:bg-brand-200 disabled:opacity-50"
            }
          >
            {activeRun ? <Square className="size-4" /> : <Play className="size-4" />}
            <span>{pending ? "Memproses…" : activeRun ? "Hentikan scan ini" : "Mulai pindai"}</span>
          </button>
        </div>
        {activeRun && <div role="status" className="mt-4 rounded-xl border border-brand/35 bg-brand-soft/40 p-3.5 text-sm text-foreground"><strong>{labels[activeRun.status]}</strong> · ID {activeRun.runId}<p className="mt-1 text-xs text-muted">Mulai {new Date(activeRun.startedAt).toLocaleString("id-ID")} · usia {activeRun.since === "all" ? "semua" : `${activeRun.since} hari`} · {activeRun.fresh ? "ambil ulang" : "cache diizinkan"}. Semua tab mengikuti scan yang sama. Stop menunggu receipt pembatalan, bukan sekadar menutup koneksi.</p></div>}
      </section>

      <section className="mb-6 rounded-2xl border border-border bg-surface p-6">
        <h2 className="font-semibold">Receipt scan terakhir {activeRun && <span className="text-xs font-normal text-muted">(bukan scan yang sedang berjalan)</span>}</h2>
        {!latestReceipt ? <p className="mt-3 text-sm text-muted">Belum ada receipt web yang terkonfirmasi. Riwayat CLI lama tetap tersimpan tanpa diubah.</p> : <>
          <p role="status" className={`mt-3 text-sm ${successful ? "text-emerald-800 dark:text-emerald-300" : "text-amber-800 dark:text-amber-300"}`}><strong>{labels[latestReceipt.status]}</strong> · {latestReceipt.completedAt ? new Date(latestReceipt.completedAt).toLocaleString("id-ID") : "Waktu tidak tersedia"} · kode keluar {latestReceipt.exitCode ?? "tidak diketahui"}</p>
          <p className="mt-1 break-all font-mono text-xs text-muted">ID {latestReceipt.runId}</p>
          {latestReceipt.message && <p className="mt-2 text-sm">{latestReceipt.message}</p>}
          <dl className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            {[["Ditemukan mentah", latestReceipt.rawFound], ["Lolos validasi & dedup", latestReceipt.admitted], ["Ditolak filter", latestReceipt.rejected], ["Baru tersimpan (commit)", latestReceipt.newAdded]].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-border bg-background/40 p-3"><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{number(value as number | null | undefined)}</dd></div>)}
          </dl>
          <p className="mt-4 text-sm">Cakupan sumber: <strong>{latestReceipt.coverage?.status || "tidak diketahui"}</strong> · dicoba {latestReceipt.coverage?.attempted ?? "?"} · berhasil {latestReceipt.coverage?.succeeded ?? "?"} · gagal {latestReceipt.coverage?.failed ?? "?"}. Sumber parsial tidak berarti semua lowongan berhasil diambil.</p>
          <ul className="mt-2 space-y-1 text-xs text-muted">{latestReceipt.coverage?.sources.filter((source) => source.status !== "complete").map((source, index) => <li key={`${source.id}-${index}`}>{source.company || source.id}: {source.status}{source.reason ? ` — ${source.reason}` : ""}</li>)}</ul>
          <Link href={`/loker?scanRun=${encodeURIComponent(latestReceipt.runId)}`} className="mt-4 inline-flex h-9 items-center gap-2 rounded-xl border border-brand/40 bg-brand-soft px-3.5 text-sm font-semibold text-brand-text transition-colors hover:bg-brand/20">Lihat hasil scan ini <ArrowRight className="size-4" /></Link>
        </>}
      </section>

      <section className="rounded-2xl border border-border bg-[#0d1117] p-5 text-slate-200">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Terminal className="size-4" /> Log scan {activeId ? `· ${activeId}` : ""}</h2>
        {streamError && <p role="alert" className="mt-2 text-sm text-amber-300">{streamError} Status server diperiksa berkala; koneksi terputus tidak berarti berhasil atau dibatalkan.</p>}
        <div ref={consoleRef} className="mt-3 h-64 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs" aria-label="Log scanner">{logs.length ? logs.join("\n") : "Log akan muncul saat scan aktif. Receipt akhir adalah konfirmasi hasil, bukan teks log."}</div>
      </section>

      <section className="mt-6 rounded-2xl border border-border bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold text-foreground">Riwayat pemeriksaan akses portal</h2><button type="button" onClick={() => void fetchStatus()} className="inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-background px-3 text-xs font-medium text-brand-text transition-colors hover:border-brand/40 hover:bg-brand-soft"><RefreshCw className="size-3" /> <span>Segarkan status</span></button></div>
        <p className="mt-2 text-xs text-muted">Keterjangkauan endpoint bukan bukti cakupan scan penuh atau jaminan seluruh lowongan terkini. Cakupan aktual ada pada receipt.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{portals.map((portal) => <div key={portal.name} className="rounded-xl border border-border bg-background/40 p-3 text-xs"><strong>{portal.name}</strong><p>{portal.status === "reachable" ? "Endpoint terjangkau" : portal.status}</p><p className="mt-1 text-muted">{portal.timestamp ? new Date(portal.timestamp).toLocaleString("id-ID") : "Waktu tidak tersedia"}</p></div>)}</div>
      </section>

      <section className="mt-6 rounded-2xl border border-border bg-surface p-6">
        <h2 className="font-semibold text-foreground">Jadwal Scan Otomatis Harian (Windows Task Scheduler)</h2>
        <p className="mt-1.5 text-xs text-muted">Jalankan perintah berikut sekali di PowerShell bila ingin komputer otomatis menjalankan scan harian (mis. jam 08:00 WIB) agar badge <strong className="text-foreground">BARU</strong> terisi tiap pagi:</p>
        <pre className="mt-3 overflow-x-auto rounded-xl border border-border bg-background p-3 font-mono text-xs text-foreground">pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/register-scan-task.ps1 -Action Register -Time &quot;08:00&quot;</pre>
        <p className="mt-2 text-xs text-muted">Ganti <code className="text-foreground">-Action Status</code> untuk memeriksa atau <code className="text-foreground">-Action Unregister</code> untuk menonaktifkan jadwal.</p>
      </section>
    </div>
  );
}

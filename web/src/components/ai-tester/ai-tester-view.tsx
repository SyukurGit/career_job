"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { RunProvenance } from "@/lib/job-stream.mjs";

type Diagnostic = { id: string; status: "done" | "error"; text: string; error?: string; provenance?: RunProvenance; endedAt: number };
type RuntimeInfo = { cli: { installed: boolean; version: string | null }; provider: string | null; model: string | null; error?: string; context: { hasCv: boolean } };

export function AiTesterView() {
  const [info, setInfo] = useState<RuntimeInfo | null>(null);
  const [infoError, setInfoError] = useState("");
  const [mode, setMode] = useState<"quick" | "custom">("quick");
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [history, setHistory] = useState<Diagnostic[]>([]);
  const [saveError, setSaveError] = useState("");
  const request = useRef<AbortController | null>(null);

  const refresh = async () => {
    setInfoError("");
    try {
      const response = await fetch("/api/ai-tester");
      if (!response.ok) throw new Error("Status runtime tidak dapat dimuat.");
      const data = await response.json();
      setInfo(data);
      if (data.error) setInfoError(data.error);
    } catch (error) { setInfoError(error instanceof Error ? error.message : "Status tidak tersedia."); }
  };
  useEffect(() => {
    void refresh();
    let live = true;
    fetch("/api/runs/save").then(async response => {
      if (!response.ok) throw new Error("Riwayat diagnostik tidak dapat dimuat.");
      const data = await response.json();
      if (live && Array.isArray(data.jobs)) setHistory(data.jobs.filter((job: { kind?: string }) => job.kind === "ai-diagnostic"));
    }).catch(error => { if (live) setSaveError(error.message); });
    return () => { live = false; request.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - started), 100);
    return () => clearInterval(timer);
  }, [running]);

  const run = async () => {
    if (request.current || (mode === "custom" && !prompt.trim())) return;
    const controller = new AbortController();
    request.current = controller;
    setRunning(true);
    setElapsed(0);
    setSaveError("");
    const startedAt = Date.now();
    let result: Diagnostic;
    try {
      const response = await fetch("/api/ai-tester", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, prompt: mode === "custom" ? prompt : undefined }), signal: controller.signal });
      const data = await response.json();
      result = { id: `diagnostic-${startedAt}`, status: response.ok && data.ok ? "done" : "error", text: data.ok ? data.result : "", error: data.ok ? undefined : data.error || "OMP gagal tanpa respons model.", provenance: data.provenance, endedAt: Date.now() };
    } catch (error) {
      result = { id: `diagnostic-${startedAt}`, status: "error", text: "", error: controller.signal.aborted ? "Dibatalkan. Proses sedang dihentikan oleh server." : error instanceof Error ? error.message : "Koneksi gagal.", endedAt: Date.now() };
    } finally {
      request.current = null;
      setRunning(false);
    }
    setHistory(current => [result, ...current]);
    try {
      const saved = await fetch("/api/runs/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...result, kind: "ai-diagnostic", title: mode === "quick" ? "Uji respons OMP" : "Prompt diagnostik OMP", startedAt, output: result.text }) });
      if (!saved.ok) throw new Error("Respons belum tersimpan ke disk. Salin hasil sebelum menutup halaman.");
    } catch (error) { setSaveError(error instanceof Error ? error.message : "Riwayat gagal disimpan."); }
  };

  const latestSuccess = history.find(item => item.status === "done");
  const latestFailure = history.find(item => item.status === "error");
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Diagnostik OMP</h1>
        <p className="mt-1.5 text-sm text-muted">Uji respons dan prompt teks saja; bukan evaluator CV. Model aktif OMP dipakai secara eksplisit tanpa fallback.</p>
        <p className="mt-2 text-sm"><Link className="text-brand-text font-medium underline-offset-2 hover:underline" href="/loker">Evaluasi lowongan dan buat cover draft melalui alur lowongan</Link> agar JD, CV lengkap, laporan dan riwayat yang sama digunakan.</p>
      </header>
      <section aria-label="Runtime OMP" className="rounded-2xl border border-border bg-surface p-5 text-sm space-y-2.5">
        <p>Binary: {info ? info.cli.installed ? "Terpasang — akses inferensi belum diverifikasi" : "Tidak tersedia" : "Memuat…"} · {info?.cli.version || "versi belum diketahui"}</p>
        <p>Provider / model aktif: <strong>{info?.provider && info.model ? `${info.provider}/${info.model}` : "Belum dapat dibaca; tidak akan diganti diam-diam"}</strong></p>
        <p>CV lengkap: {info?.context.hasCv ? "tersedia untuk evaluasi kanonik" : "belum tersedia; evaluasi tidak boleh berjalan"}. Diagnostik tidak membaca CV.</p>
        {infoError && <p role="alert" className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-400">{infoError}</p>}
        <div className="pt-1">
          <button type="button" onClick={() => void refresh()} className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:border-brand/40 hover:bg-surface-hover hover:text-brand-text">Muat ulang status</button>
        </div>
      </section>
      <section className="rounded-2xl border border-border bg-surface p-5 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5" htmlFor="diagnostic-mode">Mode diagnostik</label>
            <select id="diagnostic-mode" value={mode} onChange={event => setMode(event.target.value as "quick" | "custom")} disabled={running} className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20">
              <option value="quick">Uji respons singkat</option><option value="custom">Prompt teks kustom</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => void run()}
            disabled={running || !info?.cli.installed || (mode === "custom" && !prompt.trim())}
            className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-brand px-4 text-sm font-semibold text-brand-foreground shadow-xs transition-colors hover:bg-brand-200 disabled:pointer-events-none disabled:opacity-50"
          >
            {running ? `Menjalankan ${(elapsed / 1000).toFixed(1)}s` : "Jalankan diagnostik"}
          </button>
          {running && (
            <button
              type="button"
              onClick={() => request.current?.abort()}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-red-500/40 bg-red-500/10 px-4 text-sm font-medium text-red-700 transition-colors hover:bg-red-500/20 dark:text-red-300"
            >
              Batalkan
            </button>
          )}
        </div>
        {mode === "custom" && <div><label htmlFor="diagnostic-prompt" className="block text-xs font-medium text-muted mb-1.5">Prompt (tanpa akses file, browser, atau tools)</label><textarea id="diagnostic-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} rows={6} className="w-full rounded-xl border border-border bg-background p-3 text-sm text-foreground placeholder:text-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20" /></div>}
      </section>
      {saveError && <p role="alert" className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-700 dark:text-rose-400">{saveError}</p>}
      {[{ heading: "Kegagalan terakhir", item: latestFailure }, { heading: "Respons berhasil terakhir", item: latestSuccess }].map(({ heading, item }) => (
        <section key={heading} className="rounded-2xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-foreground">{heading}</h2>
            {item && (
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(item.error || item.text)}
                className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-3 text-xs font-medium text-muted transition-colors hover:border-brand/40 hover:bg-surface-hover hover:text-foreground"
              >
                Salin
              </button>
            )}
          </div>
          {item ? <>
            <p className="mt-2 text-xs text-muted">{new Date(item.endedAt).toLocaleString()} · {item.provenance?.provider && item.provenance.model ? `${item.provenance.provider}/${item.provenance.model}` : "Provider/model tidak dilaporkan"}</p>
            <p className="mt-1 text-xs text-muted">{item.provenance?.source}</p>
            <pre className="mt-3 whitespace-pre-wrap break-words rounded-xl border border-border bg-background p-3.5 text-sm text-foreground" role={item.status === "error" ? "alert" : undefined}>{item.error || item.text}</pre>
          </> : <p className="mt-2 text-sm text-muted">Belum ada catatan.</p>}
        </section>
      ))}
    </div>
  );
}

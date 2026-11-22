"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Cpu, MapPin, Settings, Radar, Sliders } from "lucide-react";
import { TemplatesSection } from "@/components/templates/templates-section";
import { CONFIG_KEY, writeConfig } from "@/lib/config-events.mjs";

type RuntimePolicy = {
  candidate: { name: string | null; location: string | null; headline: string | null; yearsOfExperience: number | null };
  sources: { enabled: number; total: number };
  policy: { allow: string[]; alwaysAllow: string[]; block: string[]; blockHard: string[]; titleAllow?: string[]; titleBlock?: string[]; workplace: unknown };
  experienceFilter: unknown;
  postingAge: { maxDays: number | null; allAges: boolean };
};
type EngineStatus = { version?: string; status?: string; provider?: string | null; model?: string | null };

export function ConfigForm() {
  const [logos, setLogos] = useState(true);
  const [minSalary, setMinSalary] = useState("5000000");
  const [onlyRemoteDefault, setOnlyRemoteDefault] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [runtime, setRuntime] = useState<RuntimePolicy | null>(null);
  const [runtimeError, setRuntimeError] = useState("");
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [engineError, setEngineError] = useState("");
  const [pName, setPName] = useState("");
  const [pEmail, setPEmail] = useState("");
  const [pLocation, setPLocation] = useState("");
  const [pYears, setPYears] = useState("");
  const [pRoles, setPRoles] = useState("");
  const [pRemote, setPRemote] = useState("");
  const [pSaving, setPSaving] = useState(false);
  const [pNotice, setPNotice] = useState("");
  const [pError, setPError] = useState("");
  useEffect(() => {
    let active = true;
    try {
      const value = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
      if (typeof value.logos === "boolean") setLogos(value.logos);
      if (value.minSalary != null) setMinSalary(String(value.minSalary));
      if (typeof value.onlyRemoteDefault === "boolean") setOnlyRemoteDefault(value.onlyRemoteDefault);
    } catch { setError("Preferensi browser tidak dapat dibaca. Simpan untuk menggantinya dengan pilihan Anda."); }
    fetch("/api/runtime-policy").then(async (res) => {
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Profil dan kebijakan belum dapat dimuat.");
      if (active) setRuntime(data);
    }).catch((cause) => { if (active) setRuntimeError(cause instanceof Error ? cause.message : "Profil belum tersedia."); });
    fetch("/api/profile").then(async (res) => {
      const data = await res.json();
      if (active && res.ok && data.ok && data.profile) {
        if (data.profile.name) setPName(data.profile.name);
        if (data.profile.email) setPEmail(data.profile.email);
        if (data.profile.location) setPLocation(data.profile.location);
        if (data.profile.yearsOfExperience != null) setPYears(String(data.profile.yearsOfExperience));
        if (Array.isArray(data.profile.roles)) setPRoles(data.profile.roles.join(", "));
        if (data.profile.remote) setPRemote(data.profile.remote);
      }
    }).catch(() => {});
    fetch("/api/ai-tester").then(async (res) => {
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Status engine belum tersedia.");
      if (active) setEngine({ ...data.cli, provider: data.provider ?? data.cli?.provider, model: data.model ?? data.cli?.model });
      if (active && data.error) setEngineError(data.error);
    }).catch((cause) => { if (active) setEngineError(cause instanceof Error ? cause.message : "Status engine belum tersedia."); });
    return () => { active = false; };
  }, []);
  async function saveProfileYaml() {
    setPError(""); setPNotice("");
    const parsedRoles = pRoles.split(",").map((r) => r.trim()).filter(Boolean).slice(0, 6);
    const payload: Record<string, unknown> = {};
    if (pName.trim()) payload.name = pName.trim();
    if (pEmail.trim()) payload.email = pEmail.trim();
    if (pLocation.trim()) payload.location = pLocation.trim();
    if (parsedRoles.length) payload.roles = parsedRoles;
    if (pRemote.trim()) payload.remote = pRemote.trim();
    if (pYears.trim()) {
      const yrs = Number(pYears);
      if (!Number.isFinite(yrs) || yrs < 0 || yrs > 60) { setPError("Pengalaman tahun harus angka antara 0 dan 60."); return; }
      payload.yearsOfExperience = yrs;
    }
    if (!Object.keys(payload).length) { setPError("Isi minimal satu field profil sebelum menyimpan."); return; }
    setPSaving(true);
    try {
      const res = await fetch("/api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Gagal menyimpan config/profile.yml.");
      setPNotice("Profil berhasil disimpan ke config/profile.yml (dengan backup otomatis).");
      const rt = await fetch("/api/runtime-policy").then((r) => r.json());
      if (rt?.candidate) setRuntime(rt);
    } catch (cause) {
      setPError(cause instanceof Error ? cause.message : "Gagal menyimpan profil YAML.");
    } finally {
      setPSaving(false);
    }
  }
  function save() {
    setError(""); setSaved(false);
    if (!minSalary.trim() || !Number.isFinite(Number(minSalary)) || Number(minSalary) < 0) { setError("Batas gaji harus berupa angka rupiah nol atau lebih."); return; }
    try {
      let prior = {};
      try {
        const stored = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
        if (stored && typeof stored === "object" && !Array.isArray(stored)) prior = stored;
      } catch { /* An explicit save replaces unreadable browser preferences. */ }
      writeConfig(localStorage, window, { ...prior, logos, minSalary, onlyRemoteDefault });
      setSaved(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Preferensi gagal disimpan. Pilihan Anda tetap tersedia."); }
  }
  const card = "rounded-2xl border border-border bg-surface p-5 sm:p-6";
  return <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
    <header className="mb-6"><h1 className="flex items-center gap-2.5 font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl"><Settings className="size-6 text-brand-text" /><span>Pengaturan Sistem &amp; Kebijakan Scanner</span></h1><p className="mt-1.5 text-sm text-muted">Data profil, kebijakan aktif (prioritas Banda Aceh/Aceh Besar on-site + Remote Global), dan preferensi browser.</p></header>
    <div className="space-y-6">
      <section className={card}><h2 className="mb-3 flex items-center gap-2 font-semibold text-foreground"><MapPin className="size-4 text-brand-text" /><span>Profil Kandidat</span></h2>{runtimeError ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">{runtimeError}</p> : !runtime ? <p role="status" className="text-sm text-muted">Memuat profil...</p> : <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted">Nama</dt><dd className="font-medium text-foreground">{runtime.candidate.name || "Belum diatur"}</dd></div><div><dt className="text-muted">Domisili</dt><dd className="font-medium text-foreground">{runtime.candidate.location || "Belum diatur"}</dd></div><div><dt className="text-muted">Fokus</dt><dd className="font-medium text-foreground">{runtime.candidate.headline || "Belum diatur"}</dd></div><div><dt className="text-muted">Pengalaman</dt><dd className="font-medium text-foreground">{runtime.candidate.yearsOfExperience == null ? "Belum diatur" : `${runtime.candidate.yearsOfExperience} tahun`}</dd></div></dl>}
        <details className="mt-4 rounded-xl border border-border/70 bg-background/50 p-3.5">
          <summary className="cursor-pointer select-none text-xs font-semibold text-foreground">Ubah data profil &amp; role target di config/profile.yml</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 text-xs">
            <label className="text-muted font-medium">Nama Lengkap<input type="text" value={pName} onChange={(e) => setPName(e.target.value)} className="mt-1 h-9 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground focus:border-brand focus:outline-none" /></label>
            <label className="text-muted font-medium">Email<input type="email" value={pEmail} onChange={(e) => setPEmail(e.target.value)} className="mt-1 h-9 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground focus:border-brand focus:outline-none" /></label>
            <label className="text-muted font-medium">Domisili<input type="text" value={pLocation} onChange={(e) => setPLocation(e.target.value)} className="mt-1 h-9 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground focus:border-brand focus:outline-none" /></label>
            <label className="text-muted font-medium">Tahun Pengalaman<input type="number" min="0" max="60" step="0.5" value={pYears} onChange={(e) => setPYears(e.target.value)} className="mt-1 h-9 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground focus:border-brand focus:outline-none" /></label>
            <label className="sm:col-span-2 text-muted font-medium">Role Target Utama (pisahkan koma)<input type="text" value={pRoles} onChange={(e) => setPRoles(e.target.value)} placeholder="Backend Developer, Software Engineer, ..." className="mt-1 h-9 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground focus:border-brand focus:outline-none" /></label>
            <label className="sm:col-span-2 text-muted font-medium">Preferensi Lokasi / Remote<input type="text" value={pRemote} onChange={(e) => setPRemote(e.target.value)} className="mt-1 h-9 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground focus:border-brand focus:outline-none" /></label>
          </div>
          {pError && <p role="alert" className="mt-2.5 text-xs text-red-700 dark:text-red-300">{pError}</p>}
          {pNotice && <p role="status" className="mt-2.5 text-xs text-emerald-800 dark:text-emerald-300">{pNotice}</p>}
          <div className="mt-3 flex justify-end">
            <button type="button" disabled={pSaving} onClick={() => void saveProfileYaml()} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand px-4 text-xs font-semibold text-brand-foreground hover:bg-brand-200 disabled:opacity-50">
              {pSaving ? "Menyimpan..." : "Simpan Profil YAML"}
            </button>
          </div>
        </details>
      </section>
      <section className={card}><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-2 font-semibold text-foreground"><Radar className="size-4 text-brand-text" /><span>Kebijakan Scanner Aktif</span></h2><Link href="/portals" className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:border-brand/40 hover:text-brand-text">Lihat daftar sumber portal →</Link></div>{runtime ? <div className="space-y-3 text-xs"><p>{runtime.sources.enabled} sumber aktif dari {runtime.sources.total} terdaftar. Umur publikasi bawaan: {runtime.postingAge.allAges ? "semua umur" : `${runtime.postingAge.maxDays ?? "belum diketahui"} hari`}.</p><div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-900 dark:text-emerald-200"><strong className="font-semibold">Fokus kriteria aktif:</strong> Aceh prioritas on-site (fokus utama Banda Aceh &amp; Aceh Besar); luar Aceh &amp; internasional wajib Remote (termasuk Remote Indonesia &amp; Remote Global / Worldwide).</div><p className="text-muted">Remote tidak otomatis membuktikan izin bekerja dari Indonesia. Lokasi tanpa bukti ditampilkan terpisah sebagai Perlu cek lokasi.</p>{([ ["Lokasi diizinkan", runtime.policy.allow], ["Lokasi selalu diizinkan", runtime.policy.alwaysAllow], ["Lokasi dibatasi", runtime.policy.block], ["Lokasi ditolak tegas", runtime.policy.blockHard], ["Kata kunci posisi", runtime.policy.titleAllow || []], ["Posisi dikecualikan", runtime.policy.titleBlock || []] ] as [string, string[]][]).map(([label, values]) => <div key={label}><h3 className="font-semibold text-foreground">{label}</h3><p className="mt-1 break-words text-muted">{values.length ? values.join(", ") : "Tidak ditentukan"}</p></div>)}<details className="rounded-xl border border-border/70 bg-background/50 p-3"><summary className="cursor-pointer font-semibold text-foreground">Rincian workplace &amp; pengalaman</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap text-muted">{JSON.stringify({ workplace: runtime.policy.workplace, experienceFilter: runtime.experienceFilter }, null, 2)}</pre></details></div> : <p role="status" className="text-sm text-muted">{runtimeError || "Memuat kebijakan aktual..."}</p>}</section>
      <section className={`${card} space-y-5`}><h2 className="flex items-center gap-2 font-semibold text-foreground"><Sliders className="size-4 text-brand-text" /><span>Preferensi Katalog</span></h2>
        <div><label htmlFor="min-salary" className="block text-sm font-semibold text-foreground">Target gaji bulanan (IDR)</label><input id="min-salary" type="number" min="0" step="100000" value={minSalary} onChange={(e) => { setMinSalary(e.target.value); setSaved(false); }} className="mt-2 h-10 w-full rounded-xl border border-border bg-background px-3.5 text-sm text-foreground transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20" /><p className="mt-1.5 text-xs text-muted">Katalog memberi catatan pada gaji bulanan IDR yang diketahui berada di bawah target ini, tanpa menyembunyikan lowongan. Gaji tidak diketahui dan mata uang tanpa kurs tidak dibandingkan; ini bukan instruksi penilaian AI. Isi 0 untuk tanpa target.</p></div>
        <label className="flex items-start gap-3 rounded-xl border border-border/70 bg-background/50 p-3 text-sm text-foreground transition-colors hover:border-brand/35"><input type="checkbox" checked={onlyRemoteDefault} onChange={(e) => { setOnlyRemoteDefault(e.target.checked); setSaved(false); }} className="mt-0.5 size-4 shrink-0 accent-brand" /><span><span className="font-medium">Aktifkan Hanya Remote secara bawaan</span><p className="mt-1 text-xs text-muted">Jika nonaktif (bawaan), katalog menampilkan on-site prioritas Banda Aceh &amp; Aceh Besar sekaligus Remote Indonesia &amp; Global. Aktifkan untuk menyembunyikan lowongan on-site saat URL belum menetapkan filter remote.</p></span></label>
        <label className="flex items-center gap-3 rounded-xl border border-border/70 bg-background/50 p-3 text-sm text-foreground transition-colors hover:border-brand/35"><input type="checkbox" checked={logos} onChange={(e) => { setLogos(e.target.checked); setSaved(false); }} className="size-4 shrink-0 accent-brand" /><span className="font-medium">Tampilkan logo asli perusahaan</span></label>
      </section>
      <section className={card}><h2 className="mb-3 flex items-center gap-2 font-semibold text-foreground"><Cpu className="size-4 text-brand-text" /><span>Engine AI Aktual</span></h2><div className="space-y-2 text-sm"><p role={engineError ? "alert" : "status"}>{engineError || (!engine ? "Memeriksa status..." : engine.status === "installed" ? "OMP terpasang; autentikasi dan kesiapan model diperiksa saat eksekusi." : `Status: ${engine.status || "belum diketahui"}`)}</p><p className="text-muted">Versi: {engine?.version || "Belum diketahui"}</p><p className="text-muted">Provider: {engine?.provider || "Belum diketahui"}</p><p className="text-muted">Model: {engine?.model || "Belum diketahui"}</p><p className="text-xs text-muted">Provider/model aktual setiap eksekusi tampil pada hasil worker. Tidak ada pergantian model diam-diam.</p></div></section>
      <TemplatesSection kind="cv" /><TemplatesSection kind="cover" />
      {error && <p role="alert" className="rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-2.5 text-sm text-red-700 dark:text-red-300">{error}</p>}
      <div className="flex flex-wrap items-center gap-3"><button type="button" onClick={save} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-brand px-5 text-sm font-semibold text-brand-foreground shadow-xs transition-colors hover:bg-brand-200">{saved && <Check className="size-4" />}<span>{saved ? "Tersimpan" : "Simpan Pengaturan"}</span></button><span role="status" className="text-xs text-muted">{saved ? "Preferensi browser disimpan dan diterapkan." : "Pilihan disimpan lokal di browser ini."}</span></div>
    </div>
  </div>;
}

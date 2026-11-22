"use client";

import { use } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Loader2, Wrench, CircleDot, Check, X, CirclePause } from "lucide-react";
import { evaluationGateForJob, isLegacyMissingReportMessage, jobOutputForDisplay } from "@/lib/job-gate.mjs";
import { useJobs } from "@/components/jobs/job-store";
import { BackLink } from "@/components/back-link";
import { HeroGlow } from "@/components/hero-glow";
import { Badge } from "@/components/ui/badge";

export default function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { jobs } = useJobs();
  const job = jobs.find((j) => j.id === id);

  if (!job) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <BackLink href="/loker" className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-sm text-muted transition-colors hover:border-brand/40 hover:text-brand-text">
          <ArrowLeft className="size-4" /> Kembali ke Katalog Loker
        </BackLink>
        <p className="mt-8 text-sm text-muted">
          Worker ini sudah tidak berada di memori sesi aktif (sudah selesai sebelumnya atau halaman dimuat ulang).
        </p>
      </div>
    );
  }

  const gate = evaluationGateForJob(job);
  const displayOutput = jobOutputForDisplay(job);
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BackLink href="/loker" className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-sm text-muted transition-colors hover:border-brand/40 hover:text-brand-text">
          <ArrowLeft className="size-4" /> Kembali ke Katalog Loker
        </BackLink>
        <Link href="/jobs" className="inline-flex h-9 items-center rounded-xl border border-border bg-surface px-3 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground">
          Semua Riwayat Worker
        </Link>
      </div>

      <section className="dot-bg relative mt-5 overflow-hidden rounded-2xl border border-border bg-surface/40 px-6 py-7">
        {job.status === "running" && <HeroGlow />}
        <div className="relative z-10">
          <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-faint">
            {job.status === "running" ? (
              <><Loader2 className="size-3 animate-spin text-brand-text" /> berjalan</>
            ) : gate || job.status === "gated" ? (
              <><CirclePause className="size-3 text-amber-500" /> perlu tinjauan</>
            ) : job.status === "done" ? (
              <><Check className="size-3 text-emerald-500" /> selesai</>
            ) : (
              <><X className="size-3 text-red-400" /> gagal</>
            )}
          </p>
          <h1 className="mt-2 font-display text-2xl tracking-tight text-landing">{job.title}</h1>
          {job.subtitle && <p className="mt-1 text-sm text-muted">{job.subtitle}</p>}
          {job.status === "done" && job.result?.score != null && (
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              <Badge tone={job.result.tone}>{job.result.score}/5</Badge>
              {job.result.summary && <span className="text-sm text-muted">{job.result.summary}</span>}
            </div>
          )}
        </div>
      </section>

      {gate && (
        <section aria-label="Evaluasi perlu tinjauan" className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
          <h2 className="font-medium text-foreground">{gate.confirmationRequired ? "Tinjau syarat Anda sebelum melanjutkan" : "Evaluasi dihentikan oleh kondisi lowongan"}</h2>
          <p className="mt-2 text-sm text-muted">{gate.message}</p>
          <p className="mt-2 text-sm text-muted">
            {gate.legacy ? "Output tersimpan mencatat penghentian evaluasi. Status keluar proses lama tidak dapat diverifikasi; detail teknis tetap disimpan di bawah." : "Tidak ada skor atau laporan evaluasi yang dibuat. Ketentuan profil tetap dijaga."}
          </p>
          <Link href="/config" className="mt-3 inline-flex h-9 items-center rounded-xl border border-border bg-surface px-3.5 text-xs font-medium text-foreground transition-colors hover:border-brand/40 hover:text-brand-text">
            Tinjau Kebijakan &amp; Pengaturan
          </Link>
          {gate.legacy && (
            <details className="mt-3 text-sm text-muted">
              <summary className="cursor-pointer font-medium">Detail proses sebelumnya</summary>
              <p className="mt-2 break-words">{job.steps.at(-1)?.label}</p>
            </details>
          )}
        </section>
      )}

      <ol className="mt-6 space-y-2">
        {job.steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm">
            {s.kind === "tool" ? (
              <Wrench className="mt-0.5 size-3.5 shrink-0 text-brand-text" />
            ) : (
              <CircleDot className="mt-0.5 size-3.5 shrink-0 text-faint" />
            )}
            <span className={s.kind === "tool" ? "font-medium" : "text-muted"}>
              {gate?.legacy && isLegacyMissingReportMessage(s.label)
                ? "Eksekusi sebelumnya tidak menghasilkan laporan. Tinjau alasan penghentian dan detail teknis di atas."
                : s.kind === "tool" ? `Menggunakan ${s.label}` : s.label}
            </span>
          </li>
        ))}
        {job.status === "running" && (
          <li className="flex items-center gap-2.5 text-sm text-muted">
            <Loader2 className="size-3.5 animate-spin text-brand-text" /> memproses…
          </li>
        )}
      </ol>

      {job.text && (
        <div className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">Hasil</h2>
          <div className="report-prose mt-3 rounded-2xl border border-border bg-surface/40 p-5">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayOutput}</ReactMarkdown>
          </div>
          {displayOutput !== job.text && (
            <details className="mt-3 text-sm text-muted">
              <summary className="cursor-pointer font-medium">Output mentah worker</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg border border-border p-3 text-xs">{job.text}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

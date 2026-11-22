"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

// The CV templates the core resolves, each shown filled with a fictional resume
// so the design is visible before it is chosen. Choosing one writes cv.template
// in config/profile.yml, the key the CLI reads, so web and CLI agree.

type Template = { name: string; displayName: string; isDefault: boolean };

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;
const THUMB_WIDTH = 200;

const COPY = {
  cv: { id: "cv-templates-heading", title: "Template CV", note: "Pratinjau memakai contoh data CV fiktif. Template bawaan dipakai saat membuat CV baru." },
  cover: { id: "cover-templates-heading", title: "Template Surat Lamaran", note: "Pratinjau memakai contoh surat fiktif. Template bawaan dipakai untuk draf surat baru." },
} as const;

export function TemplatesSection({ kind = "cv" }: { kind?: "cv" | "cover" }) {
  const copy = COPY[kind];
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(false);
    fetch(`/api/templates?kind=${kind}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => setTemplates(Array.isArray(d?.templates) ? d.templates : []))
      .catch(() => setLoadError(true));
  }, [kind]);
  useEffect(load, [load]);

  const choose = async (name: string) => {
    setBusy(name);
    setError(null);
    try {
      const res = await fetch("/api/templates/default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kind }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setError(typeof j.error === "string" ? j.error : "Gagal menyimpan.");
      else setTemplates((prev) => prev && prev.map((t) => ({ ...t, isDefault: t.name === name })));
    } catch {
      setError("Gagal menyimpan.");
    }
    setBusy(null);
  };

  return (
    <section aria-labelledby={copy.id} className="mt-8">
      <h2 id={copy.id} className="text-base font-semibold">
        {copy.title}
      </h2>
      <p className="mt-1 text-sm text-muted">{copy.note}</p>

      {loadError ? (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
          Gagal memuat template.{" "}
          <button type="button" className="inline-flex h-7 items-center rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground hover:bg-surface-hover" onClick={load}>
            Coba lagi
          </button>
        </p>
      ) : templates === null ? (
        <Loader2 className="mt-3 size-4 animate-spin text-muted" aria-label="Memuat template" />
      ) : (
        <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
          {templates.map((t) => (
            <li key={t.name} className="rounded-xl border border-border bg-surface p-3">
              <Thumb kind={kind} name={t.name} title={`Pratinjau ${t.displayName}`} />
              <div className="mt-2.5 flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-foreground">{t.displayName}</span>
                {t.isDefault ? (
                  <span className="inline-flex h-7 items-center gap-1 rounded-md bg-brand-soft px-2 text-xs font-medium text-brand-text">
                    <Check className="size-3" aria-hidden /> Bawaan
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => choose(t.name)}
                    className={cn("inline-flex h-7 items-center justify-center rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:border-brand/40 hover:bg-surface-hover", busy !== null && "opacity-60")}
                  >
                    {busy === t.name ? "Menyimpan…" : "Jadikan bawaan"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}

// One template filled with the sample resume. The page is fetched and handed to
// the frame as srcDoc (as the CV Studio preview does) rather than loaded by URL,
// and only once the card scrolls into view, since each preview is a render.
function Thumb({ kind, name, title }: { kind: "cv" | "cover"; name: string; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setVisible(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    fetch(`/api/templates/preview?kind=${kind}&name=${encodeURIComponent(name)}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      })
      .then((h) => live && setHtml(h))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [visible, kind, name]);

  return (
    <div
      ref={box}
      className="relative overflow-hidden rounded-md bg-white shadow-sm"
      style={{ width: THUMB_WIDTH, height: (PAGE_HEIGHT * THUMB_WIDTH) / PAGE_WIDTH }}
    >
      {failed && <p className="p-3 text-xs text-neutral-500">Preview unavailable.</p>}
      {html !== null && (
        <iframe
          title={title}
          srcDoc={html}
          sandbox=""
          tabIndex={-1}
          style={{
            width: PAGE_WIDTH,
            height: PAGE_HEIGHT,
            border: 0,
            transform: `scale(${THUMB_WIDTH / PAGE_WIDTH})`,
            transformOrigin: "top left",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}

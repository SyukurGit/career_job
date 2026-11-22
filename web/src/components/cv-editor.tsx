"use client";

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Loader2, Upload } from "lucide-react";
import { cn } from "@/lib/cn";
import { CvIngest } from "@/components/cv/cv-ingest";
import {
  cvSaveUsesKeepalive,
  draftChange,
  draftFromStore,
  editorReducer,
  editorStatus,
  initialEditor,
  followUpJob,
  saveFollowUp,
  shouldSave,
} from "@/lib/cv-editor-state.mjs";

const DRAFT_KEY = "career-ops.cv-draft";
const AUTOSAVE_MS = 600;

function readDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return draftFromStore(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function CvEditor() {
  const [state, dispatch] = useReducer(editorReducer, initialEditor());
  const [importing, setImporting] = useState(false);
  const [importSaving, setImportSaving] = useState(false);
  const [profile, setProfile] = useState<{ name?: string | null; location?: string | null; headline?: string | null } | null>(null);
  const [profileError, setProfileError] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/runtime-policy").then(async (res) => {
      const data = await res.json();
      if (!res.ok || !data.candidate) throw new Error(data.error || "Profil belum tersedia.");
      if (active) setProfile(data.candidate);
    }).catch((error) => { if (active) setProfileError(error instanceof Error ? error.message : "Profil belum tersedia."); });
    return () => { active = false; };
  }, []);
  const stateRef = useRef(state);
  const snapshotPriorRef = useRef(true);
  const runningRef = useRef(false);
  const pendingRef = useRef<{ text: string; keepalive: boolean } | null>(null);
  useLayoutEffect(() => {
    stateRef.current = state;
    if (state.snapshotPrior) snapshotPriorRef.current = true;
  }, [state]);

  const pump = useCallback((confirmed?: { content: string; exists: boolean }) => {
    if (runningRef.current) return;
    const job = pendingRef.current;
    const current = stateRef.current;
    const base = confirmed ?? { content: current.saved, exists: current.exists };
    if (!job || current.phase !== "ready" || job.text !== current.content || job.text === base.content) {
      pendingRef.current = null;
      return;
    }
    pendingRef.current = null;
    runningRef.current = true;
    const snapshot = job.text;
    const backup = snapshotPriorRef.current;
    const expected = { content: base.content, exists: base.exists };
    dispatch({ type: "save-start", content: snapshot });
    const payload = { content: snapshot, backup, expected };
    fetch("/api/cv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: cvSaveUsesKeepalive(job.keepalive, payload),
    })
      .then(async (res) => {
        runningRef.current = false;
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          dispatch({
            type: "save-failed",
            content: snapshot,
            error: body.error || "Could not save. Your text is still in this tab.",
            conflict: res.status === 409,
          });
          return;
        }
        if (backup) snapshotPriorRef.current = false;
        dispatch({ type: "save-ok", content: snapshot });
        window.dispatchEvent(new CustomEvent("co-cv-saved"));
        const follow = saveFollowUp(stateRef.current, snapshot);
        if (follow) {
          pendingRef.current = followUpJob(job, pendingRef.current, follow.text);
          pump(follow.expected);
        }
      })
      .catch(() => {
        runningRef.current = false;
        dispatch({
          type: "save-failed",
          content: snapshot,
          error: "Could not save. Your text is still in this tab.",
        });
      });
  }, []);

  const startSave = useCallback((keepalive = false) => {
    const current = stateRef.current;
    if (current.phase !== "ready" || current.content === current.saved) return;
    pendingRef.current = { text: current.content, keepalive };
    pump();
  }, [pump]);

  useEffect(() => {
    let live = true;
    fetch("/api/cv")
      .then(async (res) => {
        if (!res.ok) throw new Error("load failed");
        return res.json() as Promise<{ content?: unknown; exists?: unknown }>;
      })
      .then((data) => {
        if (!live) return;
        dispatch({
          type: "loaded",
          content: typeof data.content === "string" ? data.content : "",
          exists: data.exists === true,
          draft: readDraft(),
        });
      })
      .catch(() => {
        if (!live) return;
        dispatch({
          type: "load-failed",
          error: "The CV could not be loaded. Reload the page before editing, so an empty page cannot replace it.",
        });
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const draft = draftChange(state);
    if (draft === undefined) return;
    try {
      if (!draft) sessionStorage.removeItem(DRAFT_KEY);
      else sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (error) {
      if (!(error instanceof DOMException)) throw error;
    }
  }, [state]);

  useEffect(() => {
    const flush = () => startSave(true);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [startSave]);

  useEffect(() => {
    if (importing || !shouldSave(state)) return;
    const timer = setTimeout(() => startSave(false), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [state, startSave, importing]);

  const status = editorStatus(state);

  function translateStatus(label: string): string {
    switch (label) {
      case "Loading":
        return "Memuat...";
      case "Could not load":
        return "Gagal memuat berkas";
      case "Saving":
        return "Menyimpan...";
      case "Unsaved":
        return "Ada perubahan belum disimpan";
      case "No file yet":
        return "Belum ada berkas";
      case "Saved":
        return "Tersimpan";
      default:
        return label;
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Profil &amp; Editor CV (<code className="text-brand-text">cv.md</code>)
          </h1>
          <p className="mt-1 text-sm text-muted">
            Sunting berkas CV acuan dengan pratinjau live. Berkas ini dibaca langsung oleh OMP untuk menilai kecocokan kualifikasi lowongan.
            {state.phase === "ready" && !state.exists && state.content === "" && (
              <span className="ml-1 text-amber-800 dark:text-amber-300">Berkas cv.md belum ada — mulai ketik untuk membuatnya.</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={state.phase !== "ready" || importSaving || state.inflight !== null || state.conflict}
            aria-expanded={importing}
            aria-controls="cv-import"
            onClick={() => setImporting(!importing)}
            className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-border bg-surface px-4 text-xs font-semibold text-foreground transition-colors hover:border-brand/40 hover:bg-surface-hover hover:text-brand-text disabled:opacity-50"
          >
            <Upload className="size-3.5" /> <span>{importing ? "Tutup Unggahan" : "Unggah PDF / TeX"}</span>
          </button>
          <span role="status" aria-label="CV save status" data-state={status.label.toLowerCase().replaceAll(" ", "-")} className="inline-flex h-9 items-center rounded-lg border border-border/60 bg-surface/60 px-2.5 text-xs text-muted font-medium">
            {translateStatus(status.label)}
          </span>
          <button
            type="button"
            onClick={() => startSave(false)}
            disabled={!status.canSave || importing}
            className={cn(
              "inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-5 text-xs font-bold transition-colors shadow-xs",
              status.canSave && !importing
                ? "bg-brand text-brand-foreground hover:bg-brand-200"
                : "border border-border bg-surface text-muted opacity-65"
            )}
          >
            {status.label === "Saving" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : status.label === "Saved" ? (
              <Check className="size-3.5" />
            ) : null}
            <span>{status.label === "Saving" ? "Menyimpan..." : status.label === "Saved" ? "Tersimpan" : "Simpan CV"}</span>
          </button>
        </div>
      </div>

      <section aria-label="Profil kandidat aktual" className="mb-6 rounded-2xl border border-border bg-surface p-4 sm:p-5">
        <h2 className="text-sm font-bold">{profile?.name || (profileError ? "Profil belum tersedia" : profile ? "Nama belum diatur" : "Memuat profil...")}</h2>
        <p className="mt-1 text-xs text-muted">{profileError || [profile?.location, profile?.headline].filter(Boolean).join(" • ") || "Data profil belum ditentukan."}</p>
        <p className="mt-2 text-xs text-muted">Acuan analisis: cv.md yang berhasil disimpan. Isi editor yang belum tersimpan belum menjadi acuan AI.</p>
      </section>

      {state.error && (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
          {state.error}
          {state.conflict && " Reloading drops this text, because the file changed."}
        </p>
      )}

      {importing && state.phase === "ready" && !state.conflict && (
        <section id="cv-import" aria-label="Impor CV" className="mt-6">
          <p className="mb-3 text-sm text-muted">
            Unggah atau tempel CV Anda, tinjau hasil konversinya, lalu perbarui cv.md.
            {state.content !== state.saved && " Suntingan Anda yang belum disimpan tetap berada di editor sampai Anda menyimpannya."}
          </p>
          <CvIngest
            variant="editor"
            onSavingChange={setImportSaving}
            onSaved={(markdown) => {
              if (stateRef.current.conflict) return;
              dispatch({ type: "imported", content: markdown });
              setImporting(false);
              setImportSaving(false);
            }}
          />
        </section>
      )}

      {state.phase === "loading" ? (
        <div className="mt-6 text-sm text-muted">Memuat CV...</div>
      ) : state.phase === "load-error" ? null : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <textarea
            aria-label="CV Markdown"
            disabled={importing}
            value={state.content}
            onChange={(e) => dispatch({ type: "edit", content: e.target.value })}
            spellCheck={false}
            placeholder="# Your Name&#10;&#10;## Summary&#10;..."
            className="min-h-[60vh] w-full resize-none rounded-2xl border border-border bg-surface/50 p-4 font-mono text-sm leading-relaxed outline-none transition-colors placeholder:text-faint focus:border-brand/40"
          />
          <article className="report-prose min-h-[60vh] [&_p]:whitespace-pre-line overflow-auto rounded-2xl border border-border bg-surface/30 p-5">
            {state.content.trim() ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{state.content}</ReactMarkdown>
            ) : (
              <p className="text-muted">Pratinjau tampilan CV akan muncul di sini.</p>
            )}
          </article>
        </div>
      )}
    </div>
  );
}

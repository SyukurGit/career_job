"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { scoreTone } from "@/lib/format";
import { resolveCliId } from "@/lib/saved-cli";
import { createWorkerFeedback } from "@/lib/worker-feedback.mjs";
import { readJobStream } from "@/lib/job-stream.mjs";
import { createJobsPersister } from "@/lib/jobs-persist.mjs";
import type { EVALUATION_GATE_REASONS } from "@/lib/evaluation-gate.mjs";
import type { RunProvenance } from "@/lib/job-stream.mjs";

export type JobStep = { kind: "tool" | "status"; label: string; ts: number };
export type JobGate = { reason: (typeof EVALUATION_GATE_REASONS)[number]; message: string; confirmationRequired: boolean };
export type JobResult = { score: number | null; summary: string; tone: "good" | "warn" | "bad" | "muted" };

export type Job = {
  id: string;
  title: string;
  subtitle?: string;
  page?: string; // route the job was launched from / refers to
  input?: string; // the URL/posting it processed (links inbox rows to their worker)
  kind?: string;
  evaluationSections?: string[];
  batchId?: string; // groups jobs fired together (e.g. "evaluate all Anthropic")
  status: "running" | "done" | "error" | "gated";
  gate?: JobGate;
  provenance?: RunProvenance;
  error?: string;
  persistenceError?: string;
  steps: JobStep[];
  text: string;
  result?: JobResult;
  cost?: { tokens: number; usd?: number }; // per-run token cost (Claude result event) — local only
  reportN?: number | null;
  startedAt: number;
  endedAt?: number;
};

type StartOpts = { title: string; subtitle?: string; kind: string; input: string; page?: string; batchId?: string; brief?: Record<string, string>; evaluationSections?: string[] };

type Ctx = {
  jobs: Job[];
  startJob: (opts: StartOpts) => string | null;
  removeJob: (id: string) => void;
  clearFinished: () => void;
};

const JobsContext = createContext<Ctx | null>(null);
export function useJobs() {
  const c = useContext(JobsContext);
  if (!c) throw new Error("useJobs must be used within <JobsProvider>");
  return c;
}

const JOBS_KEY = "career-ops:jobs";

function parseVerdict(text: string): JobResult {
  const m = text.match(/VERDICT:\s*([\d.]+)\s*\/\s*5\s*[—:|-]+\s*(.+)/i);
  if (m) {
    const score = parseFloat(m[1]);
    return { score, summary: m[2].trim().replace(/\s+/g, " ").slice(0, 90), tone: scoreTone(`${score}`) };
  }
  const s = text.match(/\b([0-5](?:\.\d)?)\s*\/\s*5\b/);
  if (s) {
    const score = parseFloat(s[1]);
    return { score, summary: "", tone: scoreTone(`${score}`) };
  }
  return { score: null, summary: "", tone: "muted" };
}

export function JobsProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const feedback = useRef<ReturnType<typeof createWorkerFeedback> | null>(null);
  useEffect(() => {
    const owner = createWorkerFeedback(setAnnouncement);
    feedback.current = owner;
    return () => { owner.dispose(); feedback.current = null; };
  }, []);
  const seq = useRef(0);
  const loaded = useRef(false);

  // restore history
  useEffect(() => {
    try {
      const raw = localStorage.getItem(JOBS_KEY);
      const arr = raw ? JSON.parse(raw) : null;
      if (Array.isArray(arr)) {
        // anything left "running" from a previous session is stale → mark interrupted
        setJobs(arr.map((j: Job) => (j.status === "running" ? { ...j, status: "error", error: "Interrupted (page reloaded)", steps: [...(j.steps || []), { kind: "status", label: "Interrupted (page reloaded)", ts: Date.now() }] } : j)));
      }
    } catch {
      /* ignore */
    }
    loaded.current = true;
    let live = true;
    fetch("/api/runs/save").then(async response => {
      if (!response.ok) return;
      const history = await response.json();
      if (!live || !Array.isArray(history.jobs)) return;
      setJobs(current => {
        const merged = new Map<string, Job>(current.map(job => [job.id, job]));
        for (const saved of history.jobs as Job[]) {
          const local = merged.get(saved.id);
          if (!local || (local.status !== "running" && (saved.endedAt ?? 0) >= (local.endedAt ?? 0))) merged.set(saved.id, saved);
        }
        return [...merged.values()].sort((a, b) => b.startedAt - a.startedAt);
      });
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  // persist. Every streamed chunk replaces `jobs`, so writes go through the
  // persister: at once when nothing runs, at most once a second while a job
  // streams, and flushed when the page is hidden or the provider unmounts.
  const persister = useRef<ReturnType<typeof createJobsPersister<Job>> | null>(null);
  if (persister.current === null) {
    persister.current = createJobsPersister<Job>({
      write: (list) => {
        try {
          localStorage.setItem(JOBS_KEY, JSON.stringify(list.slice(0, 40)));
        } catch {
          /* quota */
        }
      },
      isActive: (list) => list.some((j) => j.status === "running"),
    });
  }
  useEffect(() => {
    const owner = persister.current;
    const flush = () => owner?.flush();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    persister.current?.save(jobs);
  }, [jobs]);

  const patch = useCallback((id: string, fn: (j: Job) => Job) => {
    setJobs((js) => js.map((j) => (j.id === id ? fn(j) : j)));
  }, []);

  const startJob = useCallback(
    (opts: StartOpts): string | null => {
      const id = `job-${Date.now()}-${seq.current++}`;
      const job: Job = {
        id,
        title: opts.title,
        subtitle: opts.subtitle,
        page: opts.page,
        input: opts.input,
        kind: opts.kind,
        evaluationSections: opts.evaluationSections ? [...opts.evaluationSections] : undefined,
        batchId: opts.batchId,
        status: "running",
        steps: [{ kind: "status", label: "Starting…", ts: Date.now() }],
        text: "",
        startedAt: Date.now(),
      };
      setJobs((js) => [job, ...js]);

      // Full output is saved server-side; localStorage is only a convenience cache.
      const steps: JobStep[] = [];
      (async () => {
        let text = "";
        let verdictLine = ""; // retain the explicit verdict independently of the draft/report body
        let doneTokens = 0; // per-run token cost, forwarded on the done event (#6)
        let doneCostUsd: number | null = null;
        let doneReportN: number | null = null;
        let finished = false;
        let provenance: RunProvenance | undefined;
        const finish = (status: "done" | "error" | "gated", lastLabel?: string, gate?: JobGate) => {
          if (finished) return;
          finished = true;
          feedback.current?.push({ ...job, status });
          const result = status === "done" && opts.kind !== "cover" ? parseVerdict(verdictLine || text) : undefined;
          const cost = status !== "error" && doneTokens > 0 ? { tokens: doneTokens, usd: doneCostUsd ?? undefined } : undefined;
          patch(id, (j) => ({
            ...j,
            status,
            gate,
            provenance,
            error: status === "error" ? lastLabel || "Run failed" : undefined,
            result,
            cost,
            reportN: doneReportN,
            endedAt: Date.now(),
            steps: lastLabel ? [...j.steps, { kind: "status", label: lastLabel, ts: Date.now() }] : j.steps,
          }));
          const endedAt = Date.now();
          const finalSteps = lastLabel ? [...steps, { kind: "status", label: lastLabel, ts: endedAt }] : steps;
          fetch("/api/runs/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, title: opts.title, subtitle: opts.subtitle, page: opts.page, input: opts.input, kind: opts.kind, status, gate, result, cost, steps: finalSteps, output: text, error: status === "error" ? lastLabel : undefined, provenance, reportN: doneReportN, startedAt: job.startedAt, endedAt, evaluationSections: opts.evaluationSections }),
          }).then(response => {
            if (!response.ok) throw new Error("save failed");
          }).catch(() => patch(id, current => ({ ...current, persistenceError: "Run history could not be saved to disk. Keep this tab open and copy the output.", steps: [...current.steps, { kind: "status", label: "Run history could not be saved to disk. Keep this tab open and copy the output.", ts: Date.now() }] })));
          if (status === "done" && typeof window !== "undefined" && (opts.kind === "evaluate" || opts.kind === "pdf")) {
            window.dispatchEvent(new CustomEvent("co-job-done", { detail: { kind: opts.kind, input: opts.input } }));
          }
        };

        try {
          const cliId = opts.kind === "evaluate" || opts.kind === "cover" ? "omp" : await resolveCliId(stale => {
            const step: JobStep = { kind: "status", label: `Selected CLI '${stale}' is unavailable. No replacement was started. Choose it explicitly in Config.`, ts: Date.now() };
            steps.push(step);
            patch(id, current => ({ ...current, steps: [...current.steps, step] }));
          });
          if (!cliId) return finish("error", "No available CLI selected — open Config. No replacement was started.");
          const res = await fetch("/api/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: opts.kind, input: opts.input, cliId, brief: opts.brief, evaluationSections: opts.evaluationSections }),
          });
          if (!res.ok || !res.body) {
            const e = await res.json().catch(() => ({}));
            if (e.provenance) provenance = e.provenance;
            finish("error", e.error || "Failed to start");
            return;
          }
          const completion = await readJobStream(res.body, (ev) => {
            if (ev.type === "tool") {
              steps.push({ kind: "tool", label: ev.name, ts: Date.now() });
              patch(id, (j) => ({ ...j, steps: [...j.steps, { kind: "tool", label: ev.name, ts: Date.now() }] }));
            } else if (ev.type === "status") {
              steps.push({ kind: "status", label: ev.label, ts: Date.now() });
              patch(id, (j) => ({ ...j, steps: [...j.steps, { kind: "status", label: ev.label, ts: Date.now() }] }));
            } else if (ev.type === "provenance") {
              provenance = ev.provenance;
              patch(id, current => ({ ...current, provenance }));
            } else if (ev.type === "text") {
              const full = text + ev.text;
              const vm = full.match(/VERDICT:[^\n]*/i);
              if (vm) verdictLine = vm[0];
              text = full;
              patch(id, (j) => ({ ...j, text }));
            }
          });
          if (completion.status === "error") {
            finish("error", completion.message);
            return;
          }
          doneTokens = completion.tokens ?? 0;
          doneCostUsd = completion.costUsd ?? null;
          if (completion.status === "gated") {
            finish("gated", "Evaluation stopped — review the reason", {
              reason: completion.reason,
              message: completion.message,
              confirmationRequired: completion.confirmationRequired,
            });
            return;
          }
          doneReportN = typeof completion.reportN === "number" ? completion.reportN : null;
          finish("done", "Done");
        } catch {
          finish("error", "Connection error");
        }
      })();

      return id;
    },
    [patch],
  );

  const removeJob = useCallback((id: string) => setJobs((js) => js.filter((j) => j.id !== id)), []);
  const clearFinished = useCallback(() => setJobs((js) => js.filter((j) => j.status === "running")), []);

  // A new object only when the list or an action changes, not on every render
  // of this provider (the screen-reader announcement re-renders it too).
  const value = useMemo(() => ({ jobs, startJob, removeJob, clearFinished }), [jobs, startJob, removeJob, clearFinished]);

  return (
    <JobsContext.Provider value={value}>
      {children}
      <div role="status" aria-label="Worker task status" aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</div>
    </JobsContext.Provider>
  );
}

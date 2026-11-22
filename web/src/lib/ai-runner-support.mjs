import { spawn } from "node:child_process";
import { classifyEvaluationGate } from "./evaluation-gate.mjs";

export const MAX_JD_BYTES = 120_000;
const MAX_TESTER_PROMPT_BYTES = 16_384;
export const MAX_WORKER_OUTPUT_BYTES = 2 * 1024 * 1024;
const terminations = new WeakMap();

export function parseTesterPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Expected a JSON object." };
  for (const field of ["mode", "prompt", "role", "company", "jobDescription"]) {
    if (body[field] !== undefined && typeof body[field] !== "string") return { ok: false, error: `${field} must be a string.` };
  }
  const mode = body.mode ?? "quick";
  if (!["quick", "custom"].includes(mode)) return { ok: false, error: "Evaluations and cover drafts use /api/run and its saved run history." };
  if (mode === "custom" && !body.prompt?.trim()) return { ok: false, error: "prompt is required." };
  if (mode === "custom" && Buffer.byteLength(body.prompt) > MAX_TESTER_PROMPT_BYTES) return { ok: false, error: "Custom prompt is too large." };
  return { ok: true, mode, prompt: mode === "quick" ? "Jawab singkat dalam bahasa Indonesia: uji respons model ini. Jangan mengklaim evaluasi, autentikasi provider lain, atau akses data telah diverifikasi." : body.prompt };
}

export function safeRunnerError(value) {
  const text = String(value ?? "");
  const cleaned = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/(?:Bearer\s+|(?:api[_-]?key|token|secret)\s*[:=]\s*)[^\s,;]+/gi, "[redacted]").replace(/\b(?:sk|ghp|github_pat)-?[A-Za-z0-9_-]{12,}\b/g, "[redacted]").replace(/https?:\/\/[^\s)]+/g, "[endpoint]").slice(0, 600);
  if (!cleaned) return "The selected CLI failed. Check its local login and configuration.";
  if (/\b403\b/i.test(cleaned) && !/(?:no fallback|did not substitute)/i.test(cleaned)) {
    return `${cleaned.slice(0, 560)} — No fallback model was used.`;
  }
  return cleaned;
}

/** Request termination once and settle only after the worker and its stdio close. */
export function terminateCli(child, { platform = process.platform, spawnFn = spawn, graceMs = 1500, processGroup = false } = {}) {
  const existing = terminations.get(child);
  if (existing) return existing;
  if (!child.pid || ((child.exitCode != null || child.signalCode != null) && child.stdout?.destroyed && child.stderr?.destroyed)) return Promise.resolve();
  const terminated = new Promise(resolve => {
    const kill = signal => {
      try {
        if (processGroup && platform !== "win32") process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch { /* Child or group already exited. */ }
    };
    const timer = setTimeout(() => kill("SIGKILL"), graceMs);
    timer.unref?.();
    child.once("close", () => { clearTimeout(timer); resolve(); });
    if (platform === "win32") {
      try {
        const killer = spawnFn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.once("close", code => { if (code !== 0) kill("SIGKILL"); });
        killer.once("error", () => kill("SIGKILL"));
      } catch { kill("SIGKILL"); }
    } else {
      kill("SIGTERM");
    }
  });
  terminations.set(child, terminated);
  return terminated;
}

/** Only a clean, bounded process result is usable. Keep diagnostics off the success path. */
export function collectCliOutput(child, { signal, terminate = terminateCli, timeoutMs = 30_000, maxBytes = MAX_WORKER_OUTPUT_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "", stderr = "", bytes = 0, failure;
    const stop = error => {
      if (failure) return;
      failure = error;
      void terminate(child);
    };
    const abort = () => stop(new DOMException("Run cancelled.", "AbortError"));
    const timer = setTimeout(() => stop(new Error("The worker exceeded its capture deadline.")), timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      if (failure) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxBytes) return stop(new Error("The worker exceeded its capture size limit."));
      stdout += chunk;
    });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-8000); });
    child.once("error", error => { failure ??= error; });
    signal?.addEventListener("abort", abort, { once: true });
    child.once("close", code => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (failure) return reject(failure);
      if (code !== 0) return reject(new Error(safeRunnerError(stderr || stdout || `CLI exited with code ${code}.`)));
      const output = stdout.trim();
      if (!output) return reject(new Error("The worker exited without a model response or capture result."));
      resolve(output);
    });
    if (signal?.aborted) abort();
  });
}

export function parseModelSelection(value) {
  const roles = typeof value === "string" ? JSON.parse(value) : value;
  const selector = roles?.value?.default ?? roles?.default;
  const match = typeof selector === "string" && /^([a-z0-9][a-z0-9._-]*)\/([a-z0-9._][a-z0-9._/+@:-]*?)(?::(off|minimal|low|medium|high|xhigh|max|auto))?$/i.exec(selector);
  if (!match || match[0] !== selector || selector.length > 512 || /[*?]/.test(selector)) throw new Error("OMP has no explicit provider/model in modelRoles.default. Choose one in OMP; Career-Ops will not substitute one.");
  const [, provider, model, thinking] = match;
  return { cliId: "omp", provider, model, thinking: thinking ?? null, selector, source: "OMP configured modelRoles.default" };
}

export function parsePostingBrief(input, brief) {
  if (brief !== undefined && (!brief || typeof brief !== "object" || Array.isArray(brief))) return { ok: false, error: "brief must be an object." };
  for (const field of ["jobDescription", "role", "company"]) {
    if (brief?.[field] !== undefined && typeof brief[field] !== "string") return { ok: false, error: `brief.${field} must be a string.` };
  }
  const manual = /^local:manual\/[A-Za-z0-9_-]+$/.test(input);
  const url = !manual && URL.canParse(input) ? new URL(input) : null;
  if (input !== input.trim() || input.length > 4096 || /[\x00-\x20\x7f<>]/.test(input) ||
      (!manual && (!/^https?:\/\//i.test(input) || !url || !["https:", "http:"].includes(url.protocol) || url.username || url.password))) {
    return { ok: false, error: "Supply a valid public HTTP(S) posting URL or a local:manual posting identifier." };
  }
  const jobDescription = brief?.jobDescription;
  if (jobDescription?.trim()) {
    if (Buffer.byteLength(jobDescription) > MAX_JD_BYTES) return { ok: false, error: "The complete job description is too large to evaluate safely." };
    if ([brief.role, brief.company].some(value => value && value.length > 500)) return { ok: false, error: "The posting title or company is too long." };
    return { ok: true, brief: { jobDescription, role: brief.role ?? "", company: brief.company ?? "" } };
  }
  if (manual) return { ok: false, error: "Paste the full job description in brief.jobDescription; local:manual is an identifier, not a fetch URL." };
  return { ok: true, brief: undefined };
}

export function coverRunOutcome(raw) {
  const text = raw.replace(/\r\n?/g, "\n").trim();
  const markers = [...text.matchAll(/^<<\/?cover-draft>>[ \t]*$/gm)];
  if (!markers.length) {
    const gate = classifyEvaluationGate(text);
    if (gate) return { kind: /** @type {const} */ ("gated"), ...gate };
  } else if (markers.length === 2 && markers[0].index === 0 && markers[0][0].trimEnd() === "<<cover-draft>>" &&
      markers[1][0] === "<</cover-draft>>" && markers[1].index + markers[1][0].length === text.length) {
    const draft = text.slice(markers[0][0].length, markers[1].index).trim();
    if (draft && !/^<<\/?(?:evaluation-gate|report-md)>>[ \t]*$/m.test(draft)) return { kind: /** @type {const} */ ("draft"), draft };
  }
  return { kind: /** @type {const} */ ("error"), message: "The worker did not return a complete cover draft or valid confirmation stop." };
}

/** The report body (especially the archived JD) cannot contribute a final verdict. */
export function confirmedEvaluationVerdict(raw, score) {
  const text = raw.replace(/\r\n/g, "\n");
  const opener = /^<<report-md>>[ \t]*$/m.exec(text);
  const closer = /^<<\/report-md>>[ \t]*$/m.exec(text);
  if (!opener || !closer || closer.index <= opener.index || /^VERDICT:/m.test(text.slice(0, opener.index))) return null;
  const tail = text.slice(closer.index + closer[0].length).trim();
  const verdict = /^VERDICT:[ \t]*(\d(?:\.\d+)?)\/5[ \t]+[—–-][ \t]+\S[^\r\n]*$/.exec(tail);
  return verdict && Number(verdict[1]) === Number(score.split("/")[0]) ? verdict[0] : null;
}

// General fenced CLI workers use spawnHeadlessCli. OMP uses its own attested RPC
// child. Only the backend launches the deterministic report/PDF writers.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { cliUnavailableError, resolveCli } from "@/lib/clis";
import { localISODate } from "@/lib/followups";
import { accumulateTokens, createAgentTextJoiner, isFatalGenericStderr, killMsForKind, noOutputError, timeoutMessage } from "@/lib/run-cli-support.mjs";
import { spawnHeadlessCli } from "@/lib/spawn-cli.mjs";
import { careerOpsRoot, readMemory, findReportFile, readInbox, readScanMetadata, readLanguageConfig } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { resolvePdfPaths, type PdfPaths } from "@/lib/pdf-paths.mjs";
import { renderAndMarkPdf, writeCvHtml, pdfRunOutcome } from "@/lib/pdf-render.mjs";
import { createCvEnvelopeFilter } from "@/lib/cv-envelope.mjs";
import { parseReportEnvelope } from "@/lib/report-envelope.mjs";
import { persistEvaluation, evaluateRunOutcome, evaluationOutcomeEvent, parseReportMeta } from "@/lib/report-persist.mjs";
import { buildPrompt, isShellSafeCompanyName } from "@/lib/run-prompts.mjs";
import { parseCoverRequest } from "@/lib/cover-brief.mjs";
import { capabilitiesFor } from "@/lib/worker-capabilities.mjs";
import { fencingReport, isCliAllowedForCapabilities } from "@/lib/cli-fencing.mjs";
import { claudeCliArgs } from "@/lib/claude-invocation.mjs";
import { resolveCvTemplate, resolveUserTemplatesDir } from "@/lib/core/cv-template.mjs";
import { profileRef } from "@/lib/core/profile-path.mjs";
import { acquireTrackerWrite, releaseTrackerWrite } from "@/lib/core/run-registry";
import { createRunFinalizer } from "@/lib/run-finalizer.mjs";
import { readJsonObject } from "@/lib/json-body";
import { parseEvaluationOptions, selectedEvaluationInstructions } from "@/lib/evaluation-options.mjs";
import { confirmedEvaluationVerdict, coverRunOutcome, MAX_WORKER_OUTPUT_BYTES, parsePostingBrief, safeRunnerError, terminateCli } from "@/lib/ai-runner-support.mjs";
import { openOmpWorker, type OmpWorker } from "@/lib/omp-runtime.mjs";
import { buildPreloadedPrompt, capturePosting, capturedPostingContext, validateCapturedReport, preloadRunContext, type CapturedPosting } from "@/lib/run-preloaded-context.mjs";
import { canonicalJobKey } from "@/lib/core/url-key.mjs";
import { KNOWN_KINDS } from "@/lib/worker-capabilities.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800; // a real oferta evaluation / pdf-mode CV tailoring + render is heavy and multi-step

const EVENTS_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
};

export async function POST(req: Request) {
  const startedAt = Date.now();
  const body = await readJsonObject<{ kind?: string; input?: string; cliId?: string; brief?: unknown; evaluationSections?: unknown }>(req, 768 * 1024);
  if (!body) return Response.json({ error: "Invalid or oversized JSON request." }, { status: 400 });
  const { kind = "evaluate", input, cliId: requestedCliId, brief } = body;
  const evaluation = kind === "evaluate" ? parseEvaluationOptions(body.evaluationSections) : undefined;
  if (evaluation && !evaluation.ok) return Response.json({ error: evaluation.error }, { status: 400 });
  if (typeof kind !== "string" || !KNOWN_KINDS.includes(kind) || typeof input !== "string" || !input.trim() || typeof requestedCliId !== "string" || !requestedCliId.trim()) {
    return Response.json({ error: "Valid kind, input and cliId are required." }, { status: 400 });
  }
  const directCover = kind === "cover" && !/^\d+$/.test(input);
  const posting = kind === "evaluate" || directCover ? parsePostingBrief(input, brief) : undefined;
  if (posting && !posting.ok) return Response.json({ error: posting.error }, { status: 400 });
  const resolved = resolveCli(requestedCliId);
  if (!resolved) {
    return new Response(JSON.stringify(cliUnavailableError(requestedCliId)), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { spec, binPath } = resolved;
  // The CLI actually running: fencing, capabilities and argv below are keyed on it.
  const cliId = spec.id;
  const usesOmp = cliId === "omp";
  const capabilities = capabilitiesFor(kind);
  const permission = fencingReport({ cliId, cliName: spec.name, capabilities });
  if (usesOmp && kind !== "evaluate" && kind !== "cover" && kind !== "pdf") {
    return Response.json({ error: `OMP cannot run '${kind}' from this dashboard without a verified permission adapter. No replacement CLI was started.` }, { status: 422 });
  }
  if (!usesOmp && (kind === "evaluate" || kind === "cover" || kind === "pdf") && permission.level !== "full") {
    return Response.json({ error: `CLI '${cliId}' cannot enforce the required read-only boundary for '${kind}'. Choose a supported runtime; no replacement was started.` }, { status: 422 });
  }
  if (!isCliAllowedForCapabilities(cliId, capabilities)) {
    return new Response(
      JSON.stringify({ error: `CLI '${cliId}' cannot run write-capable worker '${kind}' without a verified permission adapter.` }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // These run the REAL core (modes/scripts), not just data — fail clearly if the
  // root is incomplete instead of faking it.
  // The precondition must check the file the prompt will actually read. Pinning
  // it to modes/oferta.md meant a configured market passed a check on a file the
  // run never opens, and would have missed a market dir with no evaluation mode.
  const lang = readLanguageConfig();
  const needsScript: Record<string, string> = { evaluate: lang.evalModeFile, "fix-portal": "verify-portals.mjs", pdf: "generate-pdf.mjs", cover: "modes/cover.md" };
  const required = needsScript[kind];
  // Scripts and system modes live in the code checkout, which on a split-layout
  // install is not the data root (cv.md, reports/ and output stay under that).
  const codeRoot = resolveCodeRoot(process.cwd(), process.env);
  // CAREER_OPS_ROOT is runtime user data, not a build input. Tracing this
  // dynamic path would copy the whole web project into every server bundle.
  const requiredPath = required
    ? path.join(/* turbopackIgnore: true */ codeRoot, required)
    : "";
  if (required && !fs.existsSync(/* turbopackIgnore: true */ requiredPath)) {
    return new Response(
      JSON.stringify({
        error: `This needs a complete career-ops checkout (${required}). The career-ops code checkout is incomplete — point CAREER_OPS_CODE_ROOT at a full checkout.`,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Assemble selected canonical instructions before any extraction or model call.
  // Omitted work never becomes part of the worker's evaluation instructions.
  let evaluationInstructions: string | null = null;
  if (evaluation?.ok && !evaluation.full) {
    try {
      // modes/ and batch/ are system files: they live in the code checkout.
      const root = codeRoot;
      evaluationInstructions = selectedEvaluationInstructions({
        mode: fs.readFileSync(/* turbopackIgnore: true */ requiredPath, "utf8"),
        canonicalMode: fs.readFileSync(/* turbopackIgnore: true */ path.join(root, "modes/oferta.md"), "utf8"),
        shared: fs.readFileSync(/* turbopackIgnore: true */ path.join(root, "modes/_shared.md"), "utf8"),
        batch: fs.readFileSync(/* turbopackIgnore: true */ path.join(root, "batch/batch-prompt.md"), "utf8"),
        sections: evaluation.sections,
      });
    } catch (error) {
      console.error("[career-ops] Failed to load focused evaluation instructions:", error);
      return Response.json({ error: "Could not load the selected evaluation instructions. No AI run was started." }, { status: 422 });
    }
  }

  // fix-portal's prompt puts this straight into a shell command the agent runs, and
  // a company name can arrive from a public ATS listing rather than the user's own
  // typing. Refuse rather than sanitize: a silently rewritten name would repair the
  // wrong portal.
  if (kind === "fix-portal" && !isShellSafeCompanyName(input)) {
    return new Response(
      JSON.stringify({ error: "That company name has characters I can't safely pass to the portal checker — rename it in portals.yml first." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // An A–F score is meaningless without a CV to score against — the CLI would
  // hallucinate a fit narrative and still emit a VERDICT. Require cv.md first.
  const root = careerOpsRoot();
  if (!usesOmp && (kind === "evaluate" || kind === "pdf" || kind === "cover") && (!fs.existsSync(path.join(root, "cv.md")) || !fs.readFileSync(path.join(root, "cv.md"), "utf8").trim())) {
    return new Response(
      JSON.stringify({ error: "missingCV: Add your full CV before evaluating or drafting.", code: "missingCV" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const today = localISODate();

  // Precompute deterministic scratch + final paths so the agent never chooses
  // its own filenames — the backend owns naming, writing (#2185) and rendering
  // (#2172). Nothing is cleared first: writeCvHtml rewrites the HTML
  // from this run's freshly parsed envelope before any render, and the agent is
  // no longer told these paths, so a stale file cannot survive into a render.
  let pdfPaths: PdfPaths | undefined;
  if (kind === "pdf") {
    const pathsResult = resolvePdfPaths(input, today, root, findReportFile);
    if (!pathsResult.ok) {
      return new Response(JSON.stringify({ error: pathsResult.error }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    pdfPaths = pathsResult.paths;
  }

  const coverRequest = kind === "cover" && !directCover ? parseCoverRequest({ input, brief, root, findReportFile }) : undefined;
  if (coverRequest && !coverRequest.ok) {
    return new Response(JSON.stringify({ error: coverRequest.error }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let captured: CapturedPosting | undefined;
  if (posting?.ok) {
    try {
      const result = await capturePosting({ input, brief: posting.brief, codeRoot, root, signal: req.signal });
      if (!result.ok) {
        return new Response(JSON.stringify({ type: "gated", reason: "needs_confirmation", message: result.message, confirmationRequired: true }) + "\n", { headers: EVENTS_HEADERS });
      }
      captured = result.posting;
    } catch {
      if (req.signal.aborted) return Response.json({ error: "Run cancelled." }, { status: 499 });
      return Response.json({ error: "The posting could not be captured. No model request was sent." }, { status: 422 });
    }
  }

  // Resolve the posting date HERE rather than asking the agent for it. The
  // scanner already wrote it from the provider's own `offer.postedAt`, so this
  // copies a recorded value instead of inviting a guess — and modes/oferta.md is
  // explicit that a guessed date is worse than an absent one (the POSTED column
  // renders absent as `—`, a wrong date as a fresh req). Unknown URL → undefined
  // → report-persist writes no segment at all.
  const postedAt =
    kind === "evaluate"
      ? readInbox().find((j) => canonicalJobKey(j.url) === canonicalJobKey(input))?.postedAt ?? readScanMetadata().get(canonicalJobKey(input))?.postedAt
      : undefined;
  // Which CV template the worker fills. Resolved HERE, for the same reason `lang`
  // is: the worker has no Bash (#2172), so it cannot run cv-templates.mjs and the
  // prompt used to name the base template outright, silently ignoring cv.template
  // (#4034). Only pdf fills a template, so nothing else pays for the lookup.
  // The root is passed, not re-derived: a relative CAREER_OPS_PROFILE resolves
  // against it, and `process.cwd()` here is `<core>/web` (see cv-template.mjs).
  // The data root goes in too: a template from the core's user layer (#5777) lives
  // there, so it is named relative to the worker's cwd, not the checkout.
  const dataRoot = kind === "pdf" ? root : undefined;

  const cvTemplate = dataRoot
    ? await resolveCvTemplate(codeRoot, dataRoot)
    : undefined;

  const userTemplatesDir = dataRoot
    ? await resolveUserTemplatesDir(codeRoot, dataRoot)
    : undefined;
  let prompt = buildPrompt({
    kind,
    input,
    memory: usesOmp ? "" : readMemory(),
    today,
    postedAt,
    lang,
    cvTemplate,
    userTemplatesDir,
    // The worker's cwd is the data root; modes, templates and scripts live in the checkout.
    codeRoot,
    reportFile: pdfPaths?.reportFile ?? (coverRequest?.ok ? coverRequest.reportFile : undefined),
    coverBrief: coverRequest?.ok ? coverRequest.brief : undefined,
    postingBrief: posting?.ok ? posting.brief : undefined,
    capturedPosting: captured !== undefined,
    profile: profileRef(root),
    evaluationInstructions,
  });

  let ompWorker: OmpWorker | undefined;
  let provenance: { cliId: string; provider: string | null; model: string | null; source: string } = { cliId, provider: null, model: null, source: "CLI runtime; model not reported" };
  if (usesOmp) {
    try {
      const materials = preloadRunContext({
        root, codeRoot, lang, evaluationInstructions, kind, cvTemplate, userTemplatesDir,
        reportFile: pdfPaths?.reportFile ?? (coverRequest?.ok ? coverRequest.reportFile : undefined),
      });
      prompt = buildPreloadedPrompt({ prompt, materials, posting: captured });
      ompWorker = await openOmpWorker(binPath, root, { signal: req.signal });
      provenance = ompWorker.provenance;
    } catch (error) {
      return Response.json({ error: safeRunnerError(error instanceof Error ? error.message : error), provenance }, { status: req.signal.aborted ? 499 : 422 });
    }
  } else if (captured) {
    prompt += `\n\n${capturedPostingContext(captured)}`;
  }

  // Tracker-mutating runs hold a write token so a row delete can't race their
  // merge (tracker.mjs delete doesn't yet share a lock with merge-tracker,
  // see run-registry). evaluate's agent no longer writes; the backend persist
  // path below still merges the tracker, so the token stays.
  const writeToken = kind === "evaluate" || kind === "pdf" ? acquireTrackerWrite() : null;

  // stdin must reach EOF or the CLI waits on piped input that never comes: Codex's
  // `exec` blocks reading stdin for additional context, hangs until the kill timer,
  // and then reports a generic "installed and authenticated?" error that reads as an
  // auth failure even though the CLI is fully signed in. #1973 fixed that here with
  // an inline `stdio: ["ignore", …]`; spawnHeadlessCli generalizes the same fix to
  // every CLI-invoking route (assistant, explore/ai, cv/ingest, the apply planners),
  // which had the identical bug, and puts it behind one tested helper so it cannot
  // drift back in on any single call site.
  let child;
  try {
    child = ompWorker?.child ?? spawnHeadlessCli(
      binPath,
      cliId === "claude" ? claudeCliArgs({ kind, prompt }) : (spec.streamArgs ?? spec.args)(prompt),
      { cwd: root, env: process.env },
      { cliId, capabilities },
    );
  } catch (e) {
    // Fencing refuses an argv that contradicts the capability record, so nothing
    // spawned and the stream below — which owns finishRun — is never
    // constructed. Release the tracker guard HERE or it is held for the lifetime
    // of the process and acquireTrackerWrite blocks every later evaluate/pdf run:
    // a refused argv would take the tracker down with it.
    if (writeToken !== null) releaseTrackerWrite(writeToken);
    return new Response(
      JSON.stringify({ error: safeRunnerError(e instanceof Error ? e.message : "failed to start the CLI"), provenance }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  const stopWorker = async () => {
    if (ompWorker) await ompWorker.cancel();
    else await terminateCli(child);
  };
  const encoder = new TextEncoder();
  let disconnected = false;
  let transportClosed = false;
  let writingArtifact = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let killer: ReturnType<typeof setTimeout> | undefined;
  const abortWorker = () => { if (!writingArtifact) void stopWorker(); };
  const finishRun = createRunFinalizer(child, () => {
    req.signal.removeEventListener("abort", abortWorker);
    if (writeToken !== null) releaseTrackerWrite(writeToken);
  });
  req.signal.addEventListener("abort", abortWorker, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (obj: unknown) => {
        if (disconnected || transportClosed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          disconnected = true;
          clearInterval(heartbeat);
          abortWorker();
        }
      };
      const close = () => {
        finishRun();
        clearInterval(heartbeat);
        clearTimeout(killer);
        if (disconnected || transportClosed) return;
        transportClosed = true;
        try { controller.close(); } catch { /* Already disconnected. */ }
      };
      const error = (msg: string) => send({ type: "error", msg });
      const warnings = (items: string[]) => {
        for (const item of items) send({ type: "text", text: `⚠️ ${item}\n` });
      };
      if (!ompWorker && permission.notice) send({ type: "status", label: permission.notice });
      send({ type: "provenance", provenance });
      send({ type: "status", label: provenance.provider && provenance.model ? `Runner: ${cliId} · ${provenance.provider}/${provenance.model} (no tools)` : `Runner: ${cliId} · provider/model unreported` });
      heartbeat = setInterval(() => send({ type: "keepalive" }), 10_000);
      // Reserve time for backend persistence and count capture/attestation
      // against the route budget too.
      const killMs = Math.max(1000, Math.min(killMsForKind(kind), (maxDuration - 45) * 1000 - (Date.now() - startedAt)));
      const cvFilter = kind === "pdf" ? createCvEnvelopeFilter() : null;
      const isFatalStderr = spec.stderrIsFatal ?? isFatalGenericStderr;
      const joinAgentText = createAgentTextJoiner();
      let raw = "", stdoutBuf = "", stderrBuf = "", stdoutBytes = 0;
      let emittedText = false;
      let stderrSnippet: string | null = null;
      let failure: string | null = null;
      let tokens = 0, costUsd: number | null = null;
      const flagStderr = (line: string) => {
        if (!stderrSnippet && line.trim() && isFatalStderr(line)) stderrSnippet = safeRunnerError(line);
      };
      const agentText = (text: string) => {
        if (text.trim()) emittedText = true;
        if (kind === "evaluate" || kind === "cover") {
          // These outputs must not appear as scores/drafts before the terminal
          // protocol and, for evaluations, the persistence receipt are valid.
          raw += text;
        } else {
          const visible = cvFilter ? cvFilter.push(text) : text;
          if (visible) send({ type: "text", text: visible });
        }
      };
      const processLine = (line: string) => {
        const event = spec.parseEvent?.(line);
        const text = joinAgentText(event);
        if (text) agentText(text);
        if (event?.tool) send({ type: "tool", name: event.tool });
        if (event?.status) send({ type: "status", label: event.status });
        tokens = accumulateTokens(tokens, event);
        if (typeof event?.costUsd === "number") costUsd = event.costUsd;
        if (event?.error) failure ??= safeRunnerError(event.error);
      };
      const usage = () => ({ tokens, costUsd });
      const settle = async (cleanExit: boolean) => {
        clearTimeout(killer);
        try {
          if (disconnected) return;
          if (req.signal.aborted) return error("Run cancelled.");
          if (failure) return error(failure);
          const noOutputMessage = noOutputError({ emittedText, sawError: false, cleanExit, stderrSnippet });
          if (noOutputMessage) return error(noOutputMessage);

          if (kind === "evaluate") {
            const envelope = parseReportEnvelope(raw);
            const outcome = evaluateRunOutcome({ envelope, noOutputMessage, sawError: false, cleanExit, text: raw });
            if (!outcome.ok) {
              const event = evaluationOutcomeEvent(outcome, usage());
              if (event) send(event);
              return;
            }
            if (envelope.ok !== true || !captured) return error("No validated report was available. Nothing was saved.");
            const invalid = validateCapturedReport(envelope.markdown, captured);
            if (invalid) return error(invalid);
            const meta = parseReportMeta(envelope.markdown);
            if (!meta.ok) return error(meta.error ?? "The report metadata is invalid. Nothing was saved.");
            const verdict = confirmedEvaluationVerdict(raw, meta.score);
            if (!verdict) {
              return error("The final verdict did not agree with the report score. Nothing was saved.");
            }
            writingArtifact = true;
            send({ type: "status", label: "Saving report…" });
            const persisted = await persistEvaluation({
              spawnFn: spawn, execPath: process.execPath, root, coreRoot: codeRoot,
              markdown: envelope.markdown, url: captured.url, today, postedAt,
              evaluationSections: evaluation?.ok ? evaluation.sections : undefined,
            });
            if (!persisted.ok) return error(persisted.error.slice(0, 1500));
            const reportN = Number(persisted.num);
            if (!Number.isSafeInteger(reportN) || reportN < 1) {
              return error("The report and tracker write was acknowledged but the report number is invalid.");
            }
            warnings(persisted.warnings);
            send({ type: "text", text: `${verdict}\n` });
            send({ type: "done", ...usage(), reportN });
            return;
          }

          if (kind === "pdf") {
            const tail = cvFilter?.flush();
            const envelope = cvFilter?.result();
            const outcome = pdfRunOutcome({ envelope, noOutputMessage, sawError: false, cleanExit, hasPaths: pdfPaths !== undefined });
            if (!outcome.ok) return error(outcome.message);
            if (!pdfPaths || envelope?.ok !== true) return error("No validated CV was available. No PDF was rendered.");
            writingArtifact = true;
            warnings(envelope.warnings);
            const written = writeCvHtml({ pdfPaths, html: envelope.html });
            if (!written.ok) return error(written.error.slice(0, 1500));
            send({ type: "status", label: "Rendering PDF…" });
            const rendered = await renderAndMarkPdf({
              spawnFn: spawn, execPath: process.execPath, coreRoot: codeRoot, pdfPaths,
              format: envelope.format, reportNum: pdfPaths.reportNum,
            });
            if (rendered.kind === "render-failed") return error(rendered.error.slice(0, 1500));
            warnings(rendered.warnings);
            // Expose the trailing verdict only after the render succeeded.
            if (tail) send({ type: "text", text: tail });
          } else {
            if (!cleanExit) return error(`The selected CLI exited before finishing.${stderrSnippet ? ` (${stderrSnippet})` : ""}`);
            if (kind === "cover") {
              const outcome = coverRunOutcome(raw);
              if (outcome.kind === "error") return error(outcome.message);
              if (outcome.kind === "gated") {
                send({ type: "gated", reason: outcome.reason, message: outcome.message, confirmationRequired: true, ...usage() });
                return;
              }
              send({ type: "text", text: outcome.draft });
            }
          }
          send({ type: "done", ...usage() });
        } catch (cause) {
          error(safeRunnerError(cause instanceof Error ? cause.message : cause));
        } finally {
          close();
        }
      };

      if (ompWorker) {
        void ompWorker.run(prompt, killMs).then(
          response => {
            tokens = response.tokens;
            costUsd = response.costUsd;
            agentText(response.text);
            return settle(true);
          },
          cause => {
            failure = safeRunnerError(cause instanceof Error ? cause.message : cause);
            return settle(false);
          },
        );
        return;
      }
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      killer = setTimeout(() => {
        failure ??= timeoutMessage(killMs, kind);
        void stopWorker();
      }, killMs);
      child.stdout.on("data", (chunk: string) => {
        if (disconnected || failure) return;
        stdoutBytes += Buffer.byteLength(chunk);
        if (stdoutBytes > MAX_WORKER_OUTPUT_BYTES) {
          failure = "The CLI exceeded the bounded output size; no result was saved.";
          void stopWorker();
          return;
        }
        if (!spec.parseEvent) return agentText(chunk);
        stdoutBuf += chunk;
        let offset = 0, lf: number;
        while ((lf = stdoutBuf.indexOf("\n", offset)) !== -1) {
          const line = stdoutBuf.slice(offset, lf).trim();
          offset = lf + 1;
          if (line) processLine(line);
        }
        stdoutBuf = stdoutBuf.slice(offset);
      });
      child.stderr.on("data", (chunk: string) => {
        if (stderrSnippet) return;
        stderrBuf += chunk;
        let offset = 0, lf: number;
        while ((lf = stderrBuf.indexOf("\n", offset)) !== -1) {
          flagStderr(stderrBuf.slice(offset, lf));
          offset = lf + 1;
          if (stderrSnippet) break;
        }
        stderrBuf = stderrBuf.slice(offset).slice(-8000);
      });
      child.once("error", (cause) => { failure ??= safeRunnerError(cause.message); });
      child.once("close", (code) => {
        if (stderrBuf) flagStderr(stderrBuf);
        if (stdoutBuf.trim() && !failure) processLine(stdoutBuf.trim());
        void settle(code === 0);
      });
      if (req.signal.aborted) abortWorker();
    },
    cancel() {
      disconnected = true;
      clearInterval(heartbeat);
      clearTimeout(killer);
      if (writingArtifact) return; // A committed write cannot be rolled back by disconnecting.
      finishRun();
      return stopWorker();
    },
  });

  return new Response(stream, { headers: EVENTS_HEADERS });
}

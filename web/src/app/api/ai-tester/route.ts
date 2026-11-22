import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { findBin } from "@/lib/clis";
import { parseTesterPayload, safeRunnerError } from "@/lib/ai-runner-support.mjs";
import { inspectOmp, openOmpWorker } from "@/lib/omp-runtime.mjs";
import { readJsonObject } from "@/lib/json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const root = careerOpsRoot();
  const bin = findBin("omp");
  let info = null;
  let error;
  if (bin) {
    try { info = await inspectOmp(bin, root, req.signal); }
    catch (failure) { error = safeRunnerError(failure instanceof Error ? failure.message : failure); }
  }
  return Response.json({
    ok: true,
    cli: { id: "omp", name: "Oh My Pi (OMP)", installed: !!bin, version: info?.version ?? null, status: bin ? "installed" : "unavailable" },
    provider: info?.provenance.provider ?? null,
    model: info?.provenance.model ?? null,
    provenance: info?.provenance ?? null,
    boundary: info ? "verified_no_tools" : "unverified",
    inference: { status: "unverified" },
    context: { hasCv: (fs.statSync(path.join(root, "cv.md"), { throwIfNoEntry: false })?.size ?? 0) > 0 },
    error,
  });
}

export async function POST(req: Request) {
  const parsed = parseTesterPayload(await readJsonObject(req, 128 * 1024));
  if (!parsed.ok) return Response.json({ ok: false, error: parsed.error }, { status: 400 });
  const bin = findBin("omp");
  if (!bin) return Response.json({ ok: false, error: "OMP is not installed. No replacement CLI was started." }, { status: 404 });
  const startTime = Date.now();
  let provenance;
  try {
    const worker = await openOmpWorker(bin, careerOpsRoot(), { signal: req.signal });
    provenance = worker.provenance;
    const output = await worker.run(parsed.prompt);
    return Response.json({
      ok: true, mode: parsed.mode, latencyMs: Date.now() - startTime,
      result: output.text, provenance, inference: { status: "verified_response" },
      timestamp: new Date().toISOString(),
    });
  } catch (failure) {
    const cancelled = failure instanceof Error && failure.name === "AbortError";
    const error = cancelled ? "Run cancelled." : safeRunnerError(failure instanceof Error ? failure.message : failure);
    return Response.json({ ok: false, error, provenance, latencyMs: Date.now() - startTime }, { status: cancelled ? 499 : /403/.test(error) ? 403 : provenance ? 502 : 422 });
  }
}

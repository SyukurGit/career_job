import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { readJsonObject } from "@/lib/json-body";
import { EVALUATION_GATE_REASONS } from "@/lib/evaluation-gate.mjs";
import { safeRunnerError } from "@/lib/ai-runner-support.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const validId = (id: unknown): id is string => typeof id === "string" && /^[a-z0-9_-]+$/i.test(id);

// JSON snapshots restore full output/provenance after reload. Markdown remains
// available to the CLI and existing log readers; old Markdown logs are untouched.
export async function GET() {
  const dir = path.join(careerOpsRoot(), ".career-ops-web", "runs");
  try {
    const jobs = fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => /^[a-z0-9_-]+\.json$/i.test(name)).flatMap(name => {
      try {
        const value = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
        return validId(value?.id) && ["done", "error", "gated"].includes(value.status) && typeof value.text === "string" ? [value] : [];
      } catch { return []; }
    }).sort((a, b) => (b.endedAt ?? b.startedAt ?? 0) - (a.endedAt ?? a.startedAt ?? 0)).slice(0, 100) : [];
    return Response.json({ jobs });
  } catch { return Response.json({ error: "Could not load saved run history." }, { status: 500 }); }
}

export async function POST(req: Request) {
  const b = await readJsonObject<Record<string, unknown>>(req);
  if (!b || !validId(b.id)) return Response.json({ error: "valid id required" }, { status: 400 });
  const status = b.status ?? "done";
  if (!["done", "error", "gated"].includes(String(status))) return Response.json({ error: "invalid status" }, { status: 400 });
  for (const key of ["title", "subtitle", "page", "input", "kind", "output", "error"]) {
    if (b[key] !== undefined && typeof b[key] !== "string") return Response.json({ error: `${key} must be a string` }, { status: 400 });
  }
  const gate = b.gate as { reason?: string; message?: string; confirmationRequired?: boolean } | undefined;
  const result = b.result as { score?: number | null; summary?: string; tone?: string } | undefined;
  if (result && (typeof result !== "object" || Array.isArray(result) || (result.score != null && (typeof result.score !== "number" || !Number.isFinite(result.score) || result.score < 0 || result.score > 5)) || (result.summary !== undefined && typeof result.summary !== "string"))) {
    return Response.json({ error: "invalid result" }, { status: 400 });
  }
  if (status === "gated" && (!gate || !EVALUATION_GATE_REASONS.some(reason => reason === gate.reason)
    || typeof gate.message !== "string" || !gate.message.trim() || gate.message.trim().length > 1200
    || typeof gate.confirmationRequired !== "boolean" || result?.score != null)) {
    return Response.json({ error: "invalid evaluation stop" }, { status: 400 });
  }
  const provenance = b.provenance as { cliId?: string; provider?: string | null; model?: string | null; source?: string } | undefined;
  if (provenance && (typeof provenance !== "object" || typeof provenance.cliId !== "string" || typeof provenance.source !== "string"
    || (provenance.provider !== null && typeof provenance.provider !== "string") || (provenance.model !== null && typeof provenance.model !== "string"))) {
    return Response.json({ error: "invalid provenance" }, { status: 400 });
  }
  const steps = (Array.isArray(b.steps) ? b.steps : []).filter(s => s && typeof s === "object" && ["status", "tool"].includes(s.kind) && typeof s.label === "string");
  const now = Date.now();
  const snapshot = {
    id: b.id, title: b.title || b.id, subtitle: b.subtitle, page: b.page, input: b.input, kind: b.kind,
    status, gate: status === "gated" ? gate : undefined, result: status === "done" ? result : undefined,
    provenance, error: status === "error" && b.error ? safeRunnerError(b.error) : undefined,
    steps, text: b.output || "", cost: b.cost, reportN: typeof b.reportN === "number" ? b.reportN : undefined,
    evaluationSections: Array.isArray(b.evaluationSections) ? b.evaluationSections.filter(s => typeof s === "string") : undefined,
    startedAt: typeof b.startedAt === "number" && Number.isFinite(b.startedAt) ? b.startedAt : now,
    endedAt: typeof b.endedAt === "number" && Number.isFinite(b.endedAt) ? b.endedAt : now,
  };
  const verdict = snapshot.result?.score != null ? `${snapshot.result.score}/5 — ${snapshot.result.summary || ""}` : "—";
  const md = `# Web run · ${snapshot.title}\n\n- id: ${b.id}\n- page: ${b.page || "-"}\n- input: ${b.input || "-"}\n- status: ${status}\n- verdict: ${verdict}\n${provenance ? `- runner: ${provenance.cliId} · ${provenance.provider ?? "unreported"}/${provenance.model ?? "unreported"}\n` : ""}${snapshot.error ? `- error: ${snapshot.error}\n` : ""}${status === "gated" && gate ? `\n## Evaluation stop\n- reason: ${gate.reason}\n- confirmation required: ${gate.confirmationRequired ? "yes" : "no"}\n\n${gate.message?.trim()}\n` : ""}\n## Steps\n${steps.map(s => `- ${s.kind === "tool" ? "🔧 " : ""}${s.label}`).join("\n")}\n\n## Output\n${snapshot.text}\n`;
  const dir = path.join(careerOpsRoot(), ".career-ops-web", "runs");
  const temporary = path.join(dir, `${b.id}.${crypto.randomUUID()}.tmp`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${b.id}.md`), md, { mode: 0o600 });
    fs.writeFileSync(temporary, JSON.stringify(snapshot), { mode: 0o600 });
    fs.renameSync(temporary, path.join(dir, `${b.id}.json`));
    return Response.json({ ok: true });
  } catch {
    try { fs.rmSync(temporary, { force: true }); } catch {}
    return Response.json({ error: "Could not save run history." }, { status: 500 });
  }
}

import { NextRequest } from "next/server";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import * as yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { resolveTailoredCover } from "@/lib/apply/cover";
import { companySlug } from "@/lib/company-slug.mjs";
import { inlineDisposition } from "@/lib/content-disposition.mjs";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { getProfilePath } from "@/lib/core/profile-path.mjs";
import { readJsonObject } from "@/lib/json-body";
import { splitCoverDraftForPayload } from "@/lib/outreach-templates.mjs";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serve the tailored cover letter the `cover` mode wrote to output/ for a given
// offer. Inline so it opens in the browser. Local-first: reads the user's own
// output/ dir.
//
// "application" is a TRACKER ROW number and is the preferred key: it resolves
// the cover for THAT application rather than the company's newest (#2599's rule,
// applied to covers). "company" is the fallback for a caller with no tracker row.
//
// Every part of "which file is the cover" lives in resolveTailoredCover — the
// normalization, the matching, the scan and the newest-first pick — per web/'s
// rule 1 (orchestrate the core, never reimplement it). An earlier revision of
// this route carried its own copy of all four, which is precisely how the
// "View cover" link and the check that decides whether to render it start
// disagreeing about which file exists (CodeRabbit, 2026-09-03).
export async function GET(req: NextRequest) {
  const company = (req.nextUrl.searchParams.get("company") ?? "").trim();
  const application = (req.nextUrl.searchParams.get("application") ?? "").trim();

  // With no application to resolve through, a company is required — and a
  // company that is all punctuation ("!!!") slugs to nothing, which is a bad
  // request rather than a miss. resolveTailoredCover returns null for both, so
  // the distinction has to be drawn here to keep the 400.
  if (!application && !companySlug(company)) return new Response("company required", { status: 400 });

  const file = await resolveTailoredCover(company, application);
  if (!file) return new Response("no tailored cover letter found for this offer", { status: 404 });

  try {
    const buf = fs.readFileSync(file);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": inlineDisposition(path.basename(file)),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("could not read the PDF", { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await readJsonObject<{ company?: string; role?: string; draft?: string; trackerN?: string; location?: string }>(req);
  if (!body) return Response.json({ ok: false, error: "Format request tidak valid." }, { status: 400 });
  const company = String(body.company || "").trim();
  const role = String(body.role || "").trim();
  const draft = String(body.draft || "").trim();
  if (!company || !role || !draft) {
    return Response.json({ ok: false, error: "Perusahaan, posisi, dan teks draf surat lamaran wajib diisi." }, { status: 400 });
  }

  const root = careerOpsRoot();
  const codeRoot = resolveCodeRoot(process.cwd(), process.env);
  let candidate: Record<string, string> = { name: "Kandidat" };
  try {
    const parsed = yaml.load(fs.readFileSync(getProfilePath(root), "utf8")) as { candidate?: Record<string, unknown> } | null;
    const c = parsed?.candidate || {};
    candidate = {
      name: typeof c.full_name === "string" && c.full_name.trim() ? c.full_name.trim() : "Kandidat",
      ...(typeof c.location === "string" && c.location.trim() ? { location: c.location.trim() } : {}),
      ...(typeof c.email === "string" && c.email.trim() ? { email: c.email.trim() } : {}),
      ...(typeof c.phone === "string" && c.phone.trim() ? { phone: c.phone.trim() } : {}),
      ...(typeof c.linkedin === "string" && c.linkedin.trim() ? { linkedin: c.linkedin.trim() } : {}),
      ...(typeof c.github === "string" && c.github.trim() ? { github: c.github.trim() } : {}),
    };
  } catch { /* fallback candidate name */ }

  const parts = splitCoverDraftForPayload(draft, role, company);
  const payload = {
    candidate,
    letter: {
      company,
      city: String(body.location || "").trim() || candidate.location || "",
      date: new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }),
      role_title: role,
      greeting: parts.greeting,
      opening: parts.opening,
      profile_intro: parts.profile_intro,
      ...(parts.problems_section ? { problems_section: parts.problems_section } : {}),
      closing: parts.closing,
      signature: parts.signature,
    },
  };

  const tmpFile = path.join(os.tmpdir(), `dreamkur-cover-${process.pid}-${Date.now()}.json`);
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2), "utf8");
    const args = [path.join(codeRoot, "generate-cover-letter.mjs"), "--payload", tmpFile];
    if (body.trackerN && /^\d+$/.test(String(body.trackerN).trim())) {
      args.push("--report", String(body.trackerN).trim());
    }
    await execFileAsync(process.execPath, args, {
      cwd: root,
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_CODE_ROOT: codeRoot },
      timeout: 60_000,
    });
    return Response.json({ ok: true });
  } catch (err) {
    const e = err as Error & { stderr?: string };
    return Response.json({ ok: false, error: e.stderr?.trim() || e.message || "Gagal membuat PDF surat lamaran." }, { status: 500 });
  } finally {
    try { fs.rmSync(tmpFile, { force: true }); } catch { /* ignore cleanup error */ }
  }
}

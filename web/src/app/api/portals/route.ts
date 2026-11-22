import path from "node:path";
import * as yaml from "js-yaml";
import { careerOpsRoot, portalsConfigPath } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { appendTrackedCompanyInText, loadPortalsDocument, mergePortalFilters, patchPortalFiltersText, PortalsConfigError, togglePortalEnabledInText } from "@/lib/portals-config.mjs";
import { readJsonObject } from "@/lib/json-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJsonObject<{
    action?: string;
    name?: string;
    kind?: "board" | "company";
    enabled?: boolean;
    careersUrl?: string;
    provider?: string;
    notes?: string;
    roles?: string[];
    location?: string[];
  }>(req);
  if (!body) return Response.json({ error: "bad json" }, { status: 400 });

  const root = careerOpsRoot();
  const file = portalsConfigPath(root);
  let doc: Record<string, unknown>;
  let source: string;
  try {
    ({ doc, source } = loadPortalsDocument(file, path.join(resolveCodeRoot(process.cwd(), process.env), "templates", "portals.example.yml")));
  } catch (error) {
    const invalidUserConfig = error instanceof PortalsConfigError && error.kind === "invalid-user-config";
    return Response.json(
      { error: error instanceof Error ? error.message : "could not load portals.yml" },
      { status: invalidUserConfig ? 409 : 500 },
    );
  }

  if (body.action === "toggle_portal" || body.action === "add_company") {
    try {
      const nextText = body.action === "toggle_portal"
        ? togglePortalEnabledInText(source, { name: body.name, kind: body.kind === "board" ? "board" : "company", enabled: body.enabled })
        : appendTrackedCompanyInText(source, { name: body.name, careersUrl: body.careersUrl, provider: body.provider || "", notes: body.notes || "" });
      atomicWriteWithBackup(file, nextText);
      return Response.json({ ok: true, action: body.action });
    } catch (error) {
      const e = error as Error & { status?: number };
      return Response.json({ error: e.message || "Gagal memperbarui portals.yml" }, { status: e.status || 500 });
    }
  }

  const roles = (Array.isArray(body.roles) ? body.roles : []).map((r) => String(r).trim()).filter(Boolean).slice(0, 24);
  if (roles.length === 0) return Response.json({ error: "no roles" }, { status: 400 });

  const locations = Array.isArray(body.location)
    ? body.location.map((l) => String(l).trim()).filter(Boolean)
    : undefined;
  const text = patchPortalFiltersText(source, roles, locations)
    ?? yaml.dump(mergePortalFilters(doc, roles, locations), { lineWidth: 100, noRefs: true });

  try {
    atomicWriteWithBackup(file, text);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true, roles: roles.length });
}

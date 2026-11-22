import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { readJsonObject } from "@/lib/json-body";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { scannerStatus, scannerPaths, readScannerJson, readScannerEvents, scanSummary, startScanner, cancelScanner, SCANNER_PROCESS_UNCONFIRMED } from "@/lib/scanner-lifecycle.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function portalsStatus(root: string) {
  const portals = new Map<string, { name: string; status: string; timestamp: string }>();
  let text;
  try { text = fs.readFileSync(path.join(root, "data", "portal-health.tsv"), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  for (const line of text.trim().split("\n").slice(1)) {
    const [timestamp, name, status] = line.split("\t");
    if (name && status) portals.set(name, { name, status, timestamp });
  }
  return [...portals.values()];
}

export async function GET(req: Request) {
  try {
    const root = careerOpsRoot();
    const params = new URL(req.url).searchParams;
    const runId = params.get("runId");
    if (!runId) return Response.json({ ok: true, ...await scannerStatus(root), portals: portalsStatus(root) });
    const streaming = params.get("stream") === "1";
    // Native EventSource reconnects using the original URL and a newer cursor header.
    const after = Number(req.headers.get("last-event-id") || params.get("after") || 0);
    if (streaming && (!Number.isSafeInteger(after) || after < 0)) return Response.json({ error: "Posisi stream tidak valid." }, { status: 400 });
    const files = scannerPaths(root, runId);
    const status = await scannerStatus(root);
    const receipt = readScannerJson(files.run);
    const run = receipt ?? (status.activeRun?.runId === runId ? status.activeRun : null);
    if (!run) return Response.json({ ok: false, error: "Scan tidak ditemukan." }, { status: 404 });
    if (!streaming) return Response.json({ ok: true, run: scanSummary(run) });
    const encoder = new TextEncoder();
    // Disconnecting a subscriber releases its timer only; it never cancels work.
    let cursor = after;
    let timer: NodeJS.Timeout | undefined;
    let stopped = false;
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const close = () => {
          if (stopped) return;
          stopped = true;
          clearTimeout(timer);
          req.signal.removeEventListener("abort", close);
          try { controller.close(); } catch { /* Subscriber already disconnected. */ }
        };
        cleanup = close;
        const send = (type: string, data: unknown, id?: number) => {
          controller.enqueue(encoder.encode(`${id ? `id: ${id}\n` : ""}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        const poll = async () => {
          if (stopped) return;
          try {
            // Reconcile orphaned workers before reading the durable events and receipt.
            await scannerStatus(root);
            if (stopped) return;
            const final = readScannerJson(files.run);
            for (const event of readScannerEvents(root, runId, cursor)) {
              send(event.type, event.data, event.id);
              cursor = event.id;
              if (event.type === "end") { close(); return; }
            }
            if (final) { send("end", scanSummary(final)); close(); return; }
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch (error) {
            if (stopped) return;
            try { send("error", { message: error instanceof Error ? error.message : "Status scan tidak terbaca." }); }
            finally { close(); }
            return;
          }
          if (!stopped) timer = setTimeout(() => void poll(), 500);
        };
        req.signal.addEventListener("abort", close, { once: true });
        if (req.signal.aborted) { close(); return; }
        void poll();
      },
      cancel() { cleanup(); },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Status scanner tidak tersedia." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await readJsonObject<{ fresh?: unknown; since?: unknown }>(req);
  if (!body) {
    return Response.json({ ok: false, error: "Payload scan harus JSON." }, { status: 400 });
  }
  if ((body.fresh !== undefined && typeof body.fresh !== "boolean")
      || (body.since !== undefined && typeof body.since !== "string" && typeof body.since !== "number")) {
    return Response.json({ ok: false, error: "Parameter scan tidak valid." }, { status: 400 });
  }
  try {
    const result = await startScanner(careerOpsRoot(), resolveCodeRoot(process.cwd(), process.env), { since: body.since, fresh: body.fresh });
    return Response.json({ ok: true, activeRun: scanSummary(result.run), joined: result.joined }, { status: result.joined ? 200 : 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scanner tidak dapat dimulai.";
    const status = (error as NodeJS.ErrnoException)?.code === SCANNER_PROCESS_UNCONFIRMED ? 409
      : message.startsWith("Jangkauan") ? 400 : 500;
    return Response.json({ ok: false, error: message }, { status });
  }
}

export async function DELETE(req: Request) {
  try {
    const runId = new URL(req.url).searchParams.get("runId");
    if (!runId) return Response.json({ ok: false, error: "runId wajib diisi." }, { status: 400 });
    scannerPaths(careerOpsRoot(), runId);
    const cancelled = await cancelScanner(careerOpsRoot(), runId);
    return Response.json({ ok: cancelled, status: cancelled ? "cancelling" : "not-active" }, { status: cancelled ? 202 : 409 });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Pembatalan gagal." }, { status: 500 });
  }
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { readScannerStream } from "../../src/lib/scanner-stream.mjs";

function response(chunks) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  }));
}

const receipt = { runId: "fixture", status: "complete", exitCode: 0, coverage: { status: "complete" }, newAdded: 2 };

test("reconnected stream accepts split frames, preserves event cursor and only finishes on terminal receipt", async () => {
  const events = [];
  const final = await readScannerStream(response([
    "id: 2\r\nevent: log\r\ndata: {\"text\":\"fixture\"}\r\n\r\n",
    "id: 3\nevent: en",
    `d\ndata: ${JSON.stringify(receipt)}\n\n`,
  ]), (event) => events.push(event));
  assert.equal(final.newAdded, 2);
  assert.deepEqual(events.map((event) => [event.id, event.type]), [[2, "log"], [3, "end"]]);
});

test("HTTP non-ok, premature EOF and failed reads never announce success", async () => {
  await assert.rejects(readScannerStream(new Response('{"error":"busy"}', { status: 503 }), () => {}), /busy/);
  await assert.rejects(readScannerStream(response(["event: log\ndata: {\"text\":\"done\"}\n\n"]), () => {}), /tanpa receipt/);
  const broken = new Response(new ReadableStream({ start(controller) { controller.error(new Error("read failed")); } }));
  await assert.rejects(readScannerStream(broken, () => {}), /read failed/);
});

test("nonzero complete is rejected while error, partial and cancelled are distinct terminal receipts", async () => {
  const frame = (value) => response([`event: end\ndata: ${JSON.stringify(value)}\n\n`]);
  await assert.rejects(readScannerStream(frame({ ...receipt, exitCode: 7 }), () => {}), /belum mengonfirmasi/);
  for (const status of ["partial", "error", "cancelled"]) {
    const result = await readScannerStream(frame({ ...receipt, status, exitCode: 2 }), () => {});
    assert.equal(result.status, status);
  }
});

export function confirmedScanSuccess(receipt) {
  return receipt?.status === "complete" && receipt?.exitCode === 0 && receipt?.coverage?.status === "complete";
}

/** Read SSE until an explicit terminal receipt; EOF/read failures never mean success. */
export async function readScannerStream(response, onEvent) {
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || `Scanner HTTP ${response.status}`);
  }
  if (!response.body) throw new Error("Koneksi streaming tidak tersedia.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const type = block.match(/^event: *(.+)$/m)?.[1];
        const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (!type || !data) continue;
        const payload = JSON.parse(data);
        const id = Number(block.match(/^id: *(\d+)$/m)?.[1] || 0);
        if (type === "error") throw new Error(payload.message || "Stream scanner gagal.");
        if (type === "end") {
          if (!["complete", "partial", "error", "cancelled"].includes(payload.status)) throw new Error("Receipt scanner tidak valid.");
          if (payload.status === "complete" && !confirmedScanSuccess(payload)) throw new Error("Scanner belum mengonfirmasi keberhasilan proses.");
          onEvent({ type, data: payload, id });
          return payload;
        }
        onEvent({ type, data: payload, id });
      }
      if (done) throw new Error("Koneksi berakhir tanpa receipt akhir. Scanner mungkin masih berjalan; menghubungkan ulang.");
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

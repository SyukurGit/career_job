// A route that reads fields off its body needs a JSON object. `null`, arrays
// and scalars parse fine but throw on the first property read, which surfaced
// as a 500 instead of the route's own 400.
export async function readJsonObject<T extends object = Record<string, unknown>>(req: Request, maxBytes?: number): Promise<T | null> {
  let value: unknown;
  try {
    if (maxBytes === undefined) {
      value = await req.json();
    } else {
      if (!req.body || Number(req.headers.get("content-length")) > maxBytes) return null;
      const reader = req.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let bytes = 0, text = "";
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > maxBytes) {
            void reader.cancel().catch(() => {});
            return null;
          }
          text += decoder.decode(chunk.value, { stream: true });
        }
        value = JSON.parse(text + decoder.decode());
      } finally {
        reader.releaseLock();
      }
    }
  } catch {
    return null;
  }
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as T) : null;
}

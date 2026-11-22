import { test } from "node:test";
import assert from "node:assert/strict";
import "../helpers/web-ts-alias-loader.mjs";
const { POST } = await import("../../src/app/api/ai-tester/route.ts");

// Invalid inputs must exit before discovering or invoking a model runtime.
for (const body of ["{", "null", "[]", JSON.stringify({ mode: 3 }), JSON.stringify({ mode: "custom", prompt: null }), JSON.stringify({ mode: "custom", prompt: 5 }), JSON.stringify({ mode: "custom", prompt: " " }), JSON.stringify({ mode: "evaluate", jobDescription: "title only" })]) {
  test(`diagnostic request rejects malformed input ${body}`, async () => {
    const response = await POST(new Request("http://fixture.invalid/api/ai-tester", { method: "POST", headers: { "Content-Type": "application/json" }, body }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).ok, false);
  });
}

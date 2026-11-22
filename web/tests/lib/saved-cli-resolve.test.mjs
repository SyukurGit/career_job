import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCliId } from "../../src/lib/saved-cli.ts";

const key = "career-ops:config";
function setup(saved, response, ok = true) {
  const store = new Map(saved ? [[key, JSON.stringify({ cliId: saved })]] : []);
  globalThis.localStorage = { getItem: name => store.get(name) ?? null, setItem: (name, value) => store.set(name, value) };
  globalThis.fetch = async () => ({ ok, json: async () => response });
  return store;
}

test("explicit missing choice fails without persisting sole or remembered replacement", async () => {
  const store = setup("gemini", { clis: [{ id: "omp", installed: true }], remembered: "omp" });
  const notices = [];
  assert.equal(await resolveCliId((...args) => notices.push(args)), null);
  assert.equal(JSON.parse(store.get(key)).cliId, "gemini");
  assert.deepEqual(notices, [["gemini", null]]);
});

test("installed saved choice remains exact even with a different remembered runtime", async () => {
  setup("omp", { clis: [{ id: "omp", installed: true }, { id: "claude", installed: true }], remembered: "claude" });
  assert.equal(await resolveCliId(), "omp");
});

test("fresh setup can discover the sole installed runtime without replacing an explicit choice", async () => {
  const store = setup(null, { clis: [{ id: "omp", installed: true }] });
  assert.equal(await resolveCliId(), "omp");
  assert.equal(JSON.parse(store.get(key)).cliId, "omp");
});

test("unreachable and malformed discovery preserve the saved id for server validation", async () => {
  setup("omp", { clis: [null] });
  assert.equal(await resolveCliId(), "omp");
  globalThis.fetch = async () => { throw new Error("offline"); };
  assert.equal(await resolveCliId(), "omp");
});

test("a newer user choice wins an in-flight availability lookup", async () => {
  const store = setup("gemini", {});
  globalThis.fetch = async () => {
    store.set(key, JSON.stringify({ cliId: "omp" }));
    return { ok: true, json: async () => ({ clis: [{ id: "claude", installed: true }] }) };
  };
  assert.equal(await resolveCliId(), "omp");
  assert.equal(JSON.parse(store.get(key)).cliId, "omp");
});

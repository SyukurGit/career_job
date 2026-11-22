import assert from "node:assert/strict";
import { test } from "node:test";
import { configuredPortals, watchedCompanies } from "../../src/lib/portals-config.mjs";

test("configuredPortals lists both active and paused job_boards and tracked_companies", () => {
  const doc = {
    job_boards: [
      { name: "LinkedIn Indonesia", provider: "linkedin", enabled: true, notes: "Guest API" },
      { name: "Glints Indonesia", provider: "glints", api: "https://glints.com/api/v2-alc/graphql", enabled: false },
    ],
    tracked_companies: [
      { name: "Anthropic", careers_url: "https://boards.greenhouse.io/anthropic", enabled: true },
      { name: "Paused Co", careers_url: "https://jobs.lever.co/paused", enabled: false },
    ],
  };

  const portals = configuredPortals(doc);
  assert.equal(portals.length, 4);
  assert.equal(portals.filter((p) => p.enabled).length, 2);
  assert.equal(portals.filter((p) => !p.enabled).length, 2);

  const li = portals.find((p) => p.name === "LinkedIn Indonesia");
  assert.equal(li?.kind, "board");
  assert.equal(li?.host, "linkedin.com");
  assert.equal(li?.provider, "linkedin");

  const pausedCo = portals.find((p) => p.name === "Paused Co");
  assert.equal(pausedCo?.enabled, false);
  assert.equal(pausedCo?.kind, "company");

  // watchedCompanies stays strictly scoped to tracked_companies for back-compat.
  assert.equal(watchedCompanies(doc).length, 2);
});

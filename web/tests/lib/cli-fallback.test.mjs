import { test } from "node:test";
import assert from "node:assert/strict";
import "../helpers/web-ts-alias-loader.mjs";
import { installedCliIds } from "../../src/lib/cli-pick.mjs";
import { resolveCli, cliUnavailableError } from "../../src/lib/clis.ts";

test("an explicitly requested unknown CLI never substitutes an installed runtime", () => {
  assert.equal(resolveCli("fixture-missing-runtime"), null);
  const failure = cliUnavailableError("fixture-missing-runtime");
  assert.match(failure.error, /fixture-missing-runtime/);
  assert.match(failure.error, /choose|Install/i);
});

test("unavailable response discovery lists only actual installed entries", () => {
  assert.deepEqual(installedCliIds([null, { installed: true }, { id: "codex", installed: false }, { id: "omp", installed: true }]), ["omp"]);
});

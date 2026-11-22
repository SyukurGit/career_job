import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatLiveOfferLine } from '../../../scan-ats-full.mjs';
import { buildWorkplacePolicy, captureWorkplaceEvidence, workplacePolicyFromConfig } from '../../../providers/_country.mjs';
import { workplacePolicyConfig, loadWorkplacePolicy } from '../../src/lib/core/workplace-policy.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const policy = { onsite_locations: ['Barcelona'], remote_countries: ['Spain'], remote_regions: ['Europe', 'EU', 'EMEA', 'Worldwide'] };
test('web config shape mirror agrees with the core and only a missing file is absent', async () => {
  const cases = [undefined, null, [], false, '', 42, new Date(0), {}, { location_filter: [] }, { location_filter: null }, { location_filter: {} }, { location_filter: { workplace_policy: null } }, { location_filter: { workplace_policy: policy } }];
  for (const config of cases) {
    const outcome = fn => {
      try { return { value: fn(config) }; } catch (error) { return { error: error.message }; }
    };
    assert.deepEqual(outcome(workplacePolicyConfig), outcome(workplacePolicyFromConfig));
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workplace-config-'));
  try {
    assert.equal((await loadWorkplacePolicy(root, ROOT))('Remote Australia').eligible, true);
    for (const text of ['- location_filter: {}\n', 'location_filter: { workplace_policy: null }\n', '# only comments\n']) {
      fs.writeFileSync(path.join(root, 'portals.yml'), text);
      await assert.rejects(loadWorkplacePolicy(root, ROOT), /mapping|must be an object|expected a document/);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('live scanner evidence survives JSON evaluation packet', () => {
  const job = { company: 'Fixture', title: 'Sales Engineer', url: 'https://jobs.example/eligible', location: 'Remote', eligibleCountries: ['Spain'], workplaceType: 'Remote' };
  const packet = JSON.parse(formatLiveOfferLine({ ...job, geographyEvidence: captureWorkplaceEvidence(job) }, 'fixture'));
  assert.equal(buildWorkplacePolicy(policy)(packet.location, packet.title, packet).eligible, true);
  const blocked = { ...packet, location: 'Remote Europe', geographyEvidence: captureWorkplaceEvidence({ description: 'This role is restricted to UK residents.' }) };
  assert.equal(buildWorkplacePolicy(policy)(blocked.location, blocked.title, blocked).eligible, false);
});

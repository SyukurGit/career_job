import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimePolicySnapshot } from '../../src/lib/runtime-policy.mjs';
import '../helpers/web-ts-alias-loader.mjs';

const { readRuntimePolicy } = await import('../../src/lib/read-runtime-policy.ts');
const codeRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('snapshot reports actual source, policy and profile facts rather than personal constants', () => {
  const config = {
    job_boards: [{ name: 'Board A' }, { name: 'Board B', enabled: false }],
    tracked_companies: [{ name: 'Company C', enabled: true }],
    location_filter: { allow: ['Remote'], always_allow: ['Langsa'], block: ['Foreign'], block_hard: ['Country'], workplace_policy: { onsite_locations: ['Langsa'], remote_countries: ['Indonesia'] } },
    title_filter: { positive: ['Developer'], negative: ['Senior'] }, max_posting_age_days: 14,
  };
  const profile = { candidate: { full_name: 'Fixture Candidate', location: 'Langsa', years_of_experience: 2.5, title: 'Developer' } };
  const experience = { enabled: true, years: 2.5, stretchYears: 1, action: 'label', concurrency: 4 };
  const snapshot = runtimePolicySnapshot(config, profile, '# CV -- Someone Else\n**Location:** Elsewhere', experience);
  assert.deepEqual(snapshot.candidate, { name: 'Fixture Candidate', location: 'Langsa', yearsOfExperience: 2.5, headline: 'Developer' });
  assert.deepEqual(snapshot.sources, { enabled: 2, total: 3 });
  assert.deepEqual(snapshot.policy, { allow: ['Remote'], alwaysAllow: ['Langsa'], block: ['Foreign'], blockHard: ['Country'], titleAllow: ['Developer'], titleBlock: ['Senior'], workplace: config.location_filter.workplace_policy });
  assert.deepEqual(snapshot.experienceFilter, experience);
  assert.deepEqual(snapshot.postingAge, { maxDays: 14, allAges: false });
  assert.deepEqual(snapshot.salary, { currency: 'IDR', period: 'month', foreignRates: null });
});

test('missing facts stay unknown, CV is the fallback, and all-age config is explicit', () => {
  assert.deepEqual(runtimePolicySnapshot().candidate, { name: null, location: null, yearsOfExperience: null, headline: null });
  assert.deepEqual(runtimePolicySnapshot().postingAge, { maxDays: 60, allAges: false });
  for (const age of [0, -1, 'all', '60']) assert.deepEqual(runtimePolicySnapshot({ max_posting_age_days: age }).postingAge, { maxDays: null, allAges: true });
  const fallback = runtimePolicySnapshot({}, { candidate: { years_of_experience: -1 }, narrative: { headline: 'Profile headline' } }, '# CV -- Fallback Name\n\n**Location:** Meulaboh, Indonesia');
  assert.deepEqual(fallback.candidate, { name: 'Fallback Name', location: 'Meulaboh, Indonesia', yearsOfExperience: null, headline: 'Profile headline' });
  const roleFallback = runtimePolicySnapshot({}, { narrative: { headline: '' }, target_roles: { primary: ['Backend Developer', 'Software Engineer'] } }, '');
  assert.equal(roleFallback.candidate.headline, 'Backend Developer • Software Engineer');
});

test('runtime reader follows configured data/profile paths and changed files without stale policy', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-policy-'));
  const envKeys = ['CAREER_OPS_ROOT', 'CAREER_OPS_CODE_ROOT', 'CAREER_OPS_PORTALS', 'CAREER_OPS_PROFILE'];
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  try {
    process.env.CAREER_OPS_ROOT = root;
    process.env.CAREER_OPS_CODE_ROOT = codeRoot;
    process.env.CAREER_OPS_PORTALS = 'custom-portals.yml';
    delete process.env.CAREER_OPS_PROFILE;
    fs.mkdirSync(path.join(root, 'config'));
    const portals = path.join(root, 'custom-portals.yml');
    const profile = path.join(root, 'config', 'profile.yml');
    fs.writeFileSync(portals, 'job_boards:\n  - name: Fixture\nexperience_filter:\n  enabled: true\nmax_posting_age_days: 21\n');
    fs.writeFileSync(profile, 'candidate:\n  full_name: Disk Candidate\n  years_of_experience: 3\n');
    fs.writeFileSync(path.join(root, 'cv.md'), '# CV -- CV Name\n**Location:** Sabang, Indonesia\n');
    const first = await readRuntimePolicy();
    assert.equal(first.candidate.name, 'Disk Candidate');
    assert.equal(first.candidate.location, 'Sabang, Indonesia');
    assert.equal(first.experienceFilter.enabled, true);
    assert.equal(first.experienceFilter.years, 3);
    assert.equal(first.postingAge.maxDays, 21);
    fs.writeFileSync(profile, 'candidate:\n  full_name: Next Candidate\n  years_of_experience: 4\n');
    fs.writeFileSync(portals, 'job_boards:\n  - name: Fixture\n    enabled: false\nmax_posting_age_days: 0\n');
    const second = await readRuntimePolicy();
    assert.equal(second.candidate.name, 'Next Candidate');
    assert.equal(second.candidate.yearsOfExperience, 4);
    assert.equal(second.sources.enabled, 0);
    assert.equal(second.experienceFilter.enabled, false);
    assert.equal(second.postingAge.allAges, true);
    fs.writeFileSync(portals, '- not-a-mapping\n');
    await assert.rejects(readRuntimePolicy(), /must contain a YAML mapping/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

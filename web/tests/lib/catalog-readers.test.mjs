import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../helpers/web-ts-alias-loader.mjs';
import { HISTORY_COLUMNS } from '../../src/lib/catalog-metadata.mjs';
import { canonicalJobKey } from '../../src/lib/core/url-key.mjs';
const { readApplications, readInbox, readScanMetadata, readScanHistoryLines } = await import('../../src/lib/career-ops.ts');

const row = (facts) => HISTORY_COLUMNS.map((column) => facts[column] ?? '').join('\t');
function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-readers-'));
  const keys = ['CAREER_OPS_ROOT', 'CAREER_OPS_CODE_ROOT', 'CAREER_OPS_SCAN_HISTORY', 'CAREER_OPS_PIPELINE', 'CAREER_OPS_TRACKER'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.CAREER_OPS_ROOT = root;
  process.env.CAREER_OPS_CODE_ROOT = path.resolve(import.meta.dirname, '../../..');
  for (const key of keys.slice(2)) delete process.env[key];
  fs.mkdirSync(path.join(root, 'data'));
  fs.mkdirSync(path.join(root, 'reports'));
  try { fn(root); } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('application identity uses only tracker URL, linked report header or explicit manual identity', () => {
  withFixture((root) => {
    fs.writeFileSync(path.join(root, 'data', 'applications.md'), [
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |',
      '|---|---|---|---|---|---|---|---|---|---|',
      '| 1 | 2026-11-01 | One | Engineer | 4/5 | Applied | | [1](../reports/001-one.md) | Keep decision | — |',
      '| 2 | 2026-11-02 | Two | Engineer | 4/5 | Interview | | [2](../reports/002-two.md) | | https://example.test/authoritative |',
      '| 3 | 2026-11-03 | Three | Engineer | | Bookmarked | | | Manual job ID: manual-3; Original notes | |',
      '| 4 | 2026-11-04 | Four | Engineer | | Evaluated | | [4](../reports/004-four.md) | | |',
    ].join('\n'));
    fs.writeFileSync(path.join(root, 'reports', '001-one.md'), '# Evaluation\n**URL:** [Original posting](https://example.test/linked)\n\n## Body\nUnrelated https://example.test/body');
    fs.writeFileSync(path.join(root, 'reports', '002-two.md'), '# Evaluation\n**URL:** https://example.test/different\n');
    fs.writeFileSync(path.join(root, 'reports', '004-four.md'), '# Evaluation\n**Date:** 2026-11-04\n\n## Body\n**URL:** https://example.test/not-a-header\n');
    const apps = readApplications();
    assert.equal(apps[0].url, 'https://example.test/linked');
    assert.equal(apps[0].status, 'Applied');
    assert.equal(apps[0].notes, 'Keep decision');
    assert.equal(apps[1].url, 'https://example.test/authoritative');
    assert.equal(apps[2].url, 'local:manual/manual-3');
    assert.equal(apps[3].url, '');
    fs.writeFileSync(path.join(root, 'reports', '001-one.md'), '# Evaluation\n**URL:** https://example.test/updated-header\n');
    assert.equal(readApplications()[0].url, 'https://example.test/updated-header');
  });
});

test('catalog readers share the history override and refresh observations without fabricating publication', () => {
  withFixture((root) => {
    const url = 'https://example.test/observed';
    const file = path.join(root, 'custom-history.tsv');
    process.env.CAREER_OPS_SCAN_HISTORY = 'custom-history.tsv';
    fs.writeFileSync(path.join(root, 'data', 'pipeline.md'), `- [ ] ${url} | Fixture | Engineer | facts: {"eligibility":"eligible","lastSeenAt":"2026-11-13T12:00:00Z"}\n`);
    fs.writeFileSync(file, `url\tfirst_seen\r\n${row({ url, first_seen: '2026-11-10', last_seen_at: '2026-11-14T12:00:00Z', eligibility: 'restricted', eligibility_reason: 'exclusive_foreign_country' })}\r\n`);
    const firstIndex = readScanMetadata();
    assert.equal(readScanMetadata(), firstIndex);
    assert.equal(readScanHistoryLines().length, 3);
    const first = readInbox([])[0];
    assert.equal(first.postedAt, undefined);
    assert.equal(first.firstSeenAt, '2026-11-10');
    assert.equal(first.eligibility, 'restricted');
    assert.equal(first.lastSeenAt, '2026-11-14T12:00:00Z');
    fs.appendFileSync(file, `${row({ url, last_seen_at: '2026-11-15T12:00:00Z', posting_status: 'closed', status: 'skipped_expired' })}\n`);
    assert.notEqual(readScanMetadata(), firstIndex);
    assert.equal(readScanMetadata().get(canonicalJobKey(url)).postingStatus, 'closed');
    assert.equal(readInbox([])[0].postingStatus, 'closed');
    assert.equal(readScanHistoryLines().length, 4);
  });
});

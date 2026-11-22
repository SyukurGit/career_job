import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HISTORY_COLUMNS, parseScanMetadata, withPostingMetadata, factualTimestamp, formatJakartaTimestamp } from '../../src/lib/catalog-metadata.mjs';
import { SCAN_HISTORY_COLUMNS } from '../../../lib/scan-history-columns.mjs';
import { canonicalJobKey } from '../../src/lib/core/url-key.mjs';
import { cachedFileValue } from '../../src/lib/stat-file-cache.mjs';
import { parseInbox } from '../../src/lib/pipeline-table.mjs';
import { deriveSource } from '../../src/lib/catalog-source.mjs';
import { classifyJobWorkplace } from '../../../providers/_country.mjs';

const row = (facts) => HISTORY_COLUMNS.map((column) => facts[column] ?? '').join('\t');

test('web history index follows the append-only core columns', () => {
  assert.deepEqual(HISTORY_COLUMNS, SCAN_HISTORY_COLUMNS);
});

test('legacy discovery is not publication/update/last-checked evidence', () => {
  const url = 'https://example.test/job/1';
  const facts = parseScanMetadata(`url\tfirst_seen\n${row({ url, first_seen: '2026-11-13' })}`).get(canonicalJobKey(url));
  assert.equal(facts.firstSeenAt, '2026-11-13');
  assert.equal(facts.postedAt, undefined);
  assert.equal(facts.lastSeenAt, undefined);
  assert.equal(facts.sourceUpdatedAt, undefined);
  const job = withPostingMetadata({ url, postedAt: undefined }, new Map([[canonicalJobKey(url), facts]]));
  assert.equal(job.postedAt, undefined);
  assert.equal(job.firstSeenAt, '2026-11-13');
});

test('metadata joins by canonical posting only and preserves original source dates', () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  const oldUrl = `https://glints.com/id/opportunities/jobs/old/${id}?utm_source=a`;
  const newUrl = `https://glints.com/id/opportunities/jobs/new/${id}`;
  const other = 'https://example.test/job/2';
  const index = parseScanMetadata([
    row({ url: oldUrl, first_seen: '2026-11-10', posted_at: '2026-10-12' }),
    row({ url: newUrl, first_seen: '2026-11-13', first_seen_at: '2026-11-13T23:00:00Z', last_seen_at: '2026-11-14T02:00:00Z', source_updated_at: '2026-11-12' }),
    row({ url: other, first_seen: '2026-11-14', posted_at: '2026-11-14' }),
  ].join('\n'));
  const job = withPostingMetadata({ url: newUrl, postedAt: '2026-10-13' }, index);
  assert.equal(job.postedAt, '2026-10-13');
  assert.equal(job.firstSeenAt, '2026-11-10');
  assert.equal(job.lastSeenAt, '2026-11-14T02:00:00Z');
  assert.equal(job.sourceUpdatedAt, '2026-11-12');
  assert.equal(withPostingMetadata({ url: 'https://example.test/unseen' }, index).postedAt, undefined);
});

test('newer observed restrictions override stale pipeline admission without changing publication provenance', () => {
  const url = 'https://example.test/job/observation';
  const index = parseScanMetadata(row({
    url, first_seen: '2026-11-10', last_seen_at: '2026-11-14T12:00:00Z',
    location: 'Jakarta, Indonesia', workplace_type: 'onsite', eligibility: 'restricted',
    eligibility_reason: 'onsite_outside_allowed_locations',
    geography_evidence: JSON.stringify({ workplaceType: 'onsite', eligibleCountries: ['Indonesia'] }),
    posted_at: '2026-11-11',
  }));
  const job = withPostingMetadata({
    url, postedAt: '2026-10-30', firstSeenAt: '2026-11-09', lastSeenAt: '2026-11-13T12:00:00Z',
    location: 'Langsa, Indonesia', workplaceType: 'remote', eligibility: 'eligible', eligibilityReason: 'remote_region_allowed',
    geographyEvidence: { workplaceType: 'remote', eligibleCountries: ['Indonesia'] },
  }, index);
  assert.equal(job.postedAt, '2026-10-30');
  assert.equal(job.firstSeenAt, '2026-11-09');
  assert.equal(job.lastSeenAt, '2026-11-14T12:00:00Z');
  assert.equal(job.location, 'Jakarta, Indonesia');
  assert.equal(job.workplaceType, 'onsite');
  assert.equal(job.eligibility, 'restricted');
  assert.equal(job.eligibilityReason, 'onsite_outside_allowed_locations');
  const classification = classifyJobWorkplace(job, { onsite_locations: ['Langsa'], remote_countries: ['Indonesia'], remote_regions: ['Worldwide'] });
  assert.equal(classification.eligibility, 'restricted');
});

test('older and unknown observations never erase concrete geography/admission facts', () => {
  const url = 'https://example.test/job/order';
  const newer = row({ url, last_seen_at: '2026-11-14T12:00:00Z', workplace_type: 'onsite', eligibility: 'restricted', eligibility_reason: 'onsite_outside_allowed_locations', location: 'Jakarta, Indonesia' });
  const older = row({ url, last_seen_at: '2026-11-13T12:00:00Z', workplace_type: 'remote', eligibility: 'eligible', eligibility_reason: 'remote_region_allowed', location: 'Remote Indonesia' });
  const unknown = row({ url, last_seen_at: '2026-11-15T12:00:00Z', workplace_type: 'unknown', eligibility: 'unknown', eligibility_reason: 'location_unknown' });
  const facts = parseScanMetadata([newer, older, unknown].join('\n')).get(canonicalJobKey(url));
  assert.equal(facts.lastSeenAt, '2026-11-15T12:00:00Z');
  assert.equal(facts.workplaceType, 'onsite');
  assert.equal(facts.eligibility, 'restricted');
  assert.equal(facts.eligibilityReason, 'onsite_outside_allowed_locations');
  assert.equal(facts.geographyEvidence.location, 'Jakarta, Indonesia');
});

test('legacy short headers, BOM, escaped cells and invalid observation dates remain safe', () => {
  const url = 'https://example.test/job/legacy';
  const facts = parseScanMetadata(`\uFEFFURL\tfirst_seen\r\n${row({ url, first_seen: '2026-11-10', first_seen_at: 'not a timestamp', posted_at: '2026-02-30T12:00:00Z', eligibility_reason: "'@source reason" })}\r\n`).get(canonicalJobKey(url));
  assert.equal(facts.firstSeenAt, '2026-11-10');
  assert.equal(facts.postedAt, undefined);
  assert.equal(facts.eligibilityReason, '@source reason');
  assert.equal(parseScanMetadata('url\tfirst_seen\nnot-a-url\t2026-11-13').size, 0);
  assert.equal(factualTimestamp('2026-02-30T12:00:00Z'), undefined);
  assert.equal(factualTimestamp('2026-11-13T24:00:00Z'), undefined);
  assert.equal(factualTimestamp('2026-11-13T12:00:00+99:00'), undefined);
});

test('canonical joins never merge different Glints UUIDs and returned evidence cannot poison the index', () => {
  const url = 'https://glints.com/id/opportunities/jobs/one/123e4567-e89b-42d3-a456-426614174000';
  const other = 'https://glints.com/id/opportunities/jobs/one/123e4567-e89b-42d3-a456-426614174001';
  const index = parseScanMetadata(row({ url, posted_at: '2026-11-10', geography_evidence: JSON.stringify({ eligibleCountries: ['Indonesia'] }) }));
  assert.equal(withPostingMetadata({ url: other }, index).postedAt, undefined);
  const job = withPostingMetadata({ url }, index);
  job.geographyEvidence.eligibleCountries.push('United States');
  assert.deepEqual(withPostingMetadata({ url }, index).geographyEvidence.eligibleCountries, ['Indonesia']);
});

test('facts JSON is labeled, optional, and cannot become a positional city/pay', () => {
  const [job] = parseInbox('- [ ] https://example.test/j | Acme | Engineer | facts: {"firstSeenAt":"2026-11-13","workplaceType":"remote","eligibility":"unknown","eligibilityReason":"remote_eligibility_unconfirmed"}');
  assert.equal(job.location, undefined);
  assert.equal(job.compensation, undefined);
  assert.equal(job.postedAt, undefined);
  assert.equal(job.firstSeenAt, '2026-11-13');
  assert.equal(job.eligibility, 'unknown');
  const [bad] = parseInbox('- [ ] https://example.test/j | Acme | Engineer | facts: not-json');
  assert.equal(bad.location, undefined);
});

test('Jakarta formatting handles month/year rollovers without inventing date-only times', () => {
  assert.equal(formatJakartaTimestamp('2026-12-31T18:05:00Z'), '1 Jan 2027 01:05 WIB');
  assert.equal(formatJakartaTimestamp('2026-11-13'), '13 Nov 2026');
  assert.equal(factualTimestamp('2026-02-30'), undefined);
  assert.equal(factualTimestamp('2026-11-13T12:00:00'), undefined);
  assert.equal(formatJakartaTimestamp('n/a'), undefined);
});

test('source names require normalized DNS domain boundaries', () => {
  assert.equal(deriveSource('https://WWW.GLINTS.COM./id/job'), 'Glints');
  assert.equal(deriveSource('https://glints.com.evil.test/job'), 'glints.com.evil.test');
  assert.equal(deriveSource('https://evil-glints.com/job'), 'evil-glints.com');
  assert.equal(deriveSource('https://example.test/jobstreet/foo'), 'example.test');
});

test('metadata cache invalidates same-size revisions, missing files and reappearance', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-history-'));
  const file = path.join(directory, 'history.tsv');
  let parses = 0;
  const load = () => cachedFileValue(file, 'metadata-regression', (text) => { parses++; return parseScanMetadata(text); });
  try {
    assert.equal(load(), null);
    fs.writeFileSync(file, row({ url: 'https://example.test/j', first_seen: '2026-11-10' }));
    const first = load();
    assert.equal(load(), first);
    assert.equal(parses, 1);
    const before = fs.statSync(file);
    fs.writeFileSync(file, row({ url: 'https://example.test/j', first_seen: '2026-11-11' }));
    fs.utimesSync(file, before.atime, before.mtime);
    assert.equal(load().get(canonicalJobKey('https://example.test/j')).firstSeenAt, '2026-11-11');
    assert.equal(parses, 2);
    fs.unlinkSync(file);
    assert.equal(load(), null);
    fs.writeFileSync(file, row({ url: 'https://example.test/j', first_seen: '2026-11-12' }));
    assert.equal(load().get(canonicalJobKey('https://example.test/j')).firstSeenAt, '2026-11-12');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('confirmed closure survives unknown observations and only a newer verified open reopens it', () => {
  const url = 'https://example.test/job/closed';
  const closed = row({ url, status: 'skipped_expired', last_seen_at: '2026-11-14T12:00:00Z', closes_at: '2026-11-12' });
  const unknown = row({ url, status: 'observed', last_seen_at: '2026-11-15T12:00:00Z' });
  const index = parseScanMetadata([closed, unknown].join('\n'));
  const job = withPostingMetadata({ url, lastSeenAt: '2026-11-13T12:00:00Z', postingStatus: 'open' }, index);
  assert.equal(job.postingStatus, 'closed');
  assert.equal(job.closesAt, '2026-11-12');
  const open = row({ url, posting_status: 'open', last_seen_at: '2026-11-16T12:00:00Z' });
  assert.equal(parseScanMetadata([closed, unknown, open].join('\n')).get(canonicalJobKey(url)).postingStatus, 'open');
  const [pipelineJob] = parseInbox(`- [ ] ${url} | Fixture | Engineer | facts: {"postingStatus":"closed","closesAt":"2026-11-12"}`);
  assert.equal(pipelineJob.postingStatus, 'closed');
  assert.equal(pipelineJob.closesAt, '2026-11-12');
});

/**
 * scan-local-lib.mjs — shared plumbing for local keyword scanners (scan-seek.mjs).
 *
 * Assembles the filtering, deduplication, polite HTTP and run-logging logic
 * from the pieces every other scanner already uses:
 *
 *   - title / location / blacklist / seen-URL decisions: createAdmissionGate
 *     (lib/admission-gate.mjs), whose title filter is title-keywords.mjs's
 *     buildTitleFilter over portals.yml `title_filter`;
 *   - "same role": scan.mjs's companyRoleDedupKey with invite-match.mjs's
 *     normalizeCompanyName as the canonicalizer, checked against the company+role
 *     keys of scan-history, pipeline and tracker (loadDedupSnapshot) and against
 *     the other postings of this run, so a role listed more than once across
 *     sources or queries is admitted once;
 *   - run log: scan.mjs's appendScanRunSummary into data/scan-runs.tsv, the
 *     file stats.mjs reads, written under the same lock.
 *
 * Network access is not done here: scanners fetch through providers/_http.mjs's
 * fetchTextWithRetry (shared timeout, Retry-After-aware back-off on 429/5xx and
 * transient network errors) and pace requests with `sleep` below.
 */

import path from 'node:path';
import { createAdmissionGate } from './lib/admission-gate.mjs';
import { normalizeCompanyName } from './invite-match.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { withPipelineLock } from './pipeline-lock.mjs';
import {
  companyRoleDedupKey,
  loadDedupSnapshot,
  appendScanRunSummary,
  scanHistoryPolicy,
  matchesSeenCompanyRole,
  requisitionIdsForDedup,
  seenJobKey,
  ANY_REQUISITION,
} from './scan.mjs';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Lowercase, hyphen-separated slug for the SEEK SEO path. */
export function slugify(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Decode the handful of HTML entities job cards use, and collapse whitespace. */
export function decodeHtml(text) {
  return String(text ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => (Number(n) <= 0x10FFFF ? String.fromCodePoint(Number(n)) : m))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Admission gate plus same-role dedup for one run.
 *
 * check(offer) returns null when the posting is admitted, otherwise one of
 * 'seen' | 'blacklisted' | 'title' | 'location' | 'duplicate-role'.
 * 'duplicate-role' is a legacy URL-less company/role identity or a matching
 * source requisition, never a conflict between distinct canonical posting URLs.
 *
 * @param {object} [options]
 * @param {object} [options.config] - Parsed portals.yml.
 * @param {object} [options.gateOptions] - Passed to createAdmissionGate (tests).
 * @param {Set<string>} [options.seenRoles] - Existing company+role keys (tests).
 */
export function createLocalGate({ config = {}, gateOptions = {}, seenRoles } = {}) {
  const snapshot = seenRoles && gateOptions.seen ? null : loadDedupSnapshot(scanHistoryPolicy(config), normalizeCompanyName);
  const gate = createAdmissionGate({ config, seen: snapshot?.seen, ...gateOptions });
  const roles = seenRoles ?? snapshot.seenCompanyRoles;
  const requisitions = seenRoles ? new Map() : snapshot.seenCompanyRoleRequisitions;
  const locatedRequisitions = new Map();
  const counts = gate.counts;
  counts.duplicateRole = 0;

  const roleKey = (offer) => companyRoleDedupKey(offer.company, offer.title, normalizeCompanyName);

  return {
    counts,
    roleKey,
    firstSeenAt: url => snapshot?.discoveryFacts.get(seenJobKey(url))?.firstSeenAt,
    check(offer) {
      const reason = gate.check(offer);
      if (reason) return reason;
      if (!normalizeCompanyName(offer.company)) return null;
      const key = roleKey(offer);
      const forms = requisitionIdsForDedup({ url: offer.url, text: offer.title, requisitionId: offer.requisitionId });
      if (matchesSeenCompanyRole({ key, baseKey: key, seen: roles, requisitions, locatedRequisitions }, forms)) {
        // gate.check already counted this posting as admitted.
        counts.admitted--;
        counts.duplicateRole++;
        return 'duplicate-role';
      }
      roles.add(key);
      if (!requisitions.has(key)) requisitions.set(key, new Set());
      for (const form of forms.length ? forms : [ANY_REQUISITION]) requisitions.get(key).add(form);
      return null;
    },
  };
}

/** One-line description of what a local gate dropped. */
export function formatLocalSkips(counts) {
  const parts = [];
  if (counts.seen) parts.push(`${counts.seen} already seen`);
  if (counts.duplicateRole) parts.push(`${counts.duplicateRole} same role already known`);
  if (counts.blacklisted) parts.push(`${counts.blacklisted} blacklisted`);
  if (counts.title) parts.push(`${counts.title} title filter`);
  if (counts.location) parts.push(`${counts.location} location filter`);
  return parts.join(', ');
}

/**
 * Append one row to data/scan-runs.tsv in scan.mjs's format, under the same
 * lock. `boards` is the number of queries run; `companies` is 0 because these
 * scanners search by keyword rather than by tracked company.
 *
 * @param {object} run
 * @param {number} run.found
 * @param {object} run.counts - A gate's counts.
 * @param {number} run.newAdded
 * @param {number} run.queries
 * @param {number} run.errors
 * @param {'completed'|'partial'|'failed'|'cancelled'} [run.status]
 * @param {string} [filePath]
 */
export async function writeRunLog(run, filePath = path.join(getCareerOpsRoot(), 'data/scan-runs.tsv')) {
  const { counts = {} } = run;
  const status = run.status ?? (run.errors === 0 ? 'completed' : run.errors < run.queries ? 'partial' : 'failed');
  await withPipelineLock(filePath, async () => appendScanRunSummary({
    timestamp: new Date().toISOString(),
    status,
    companies: 0,
    boards: run.queries,
    found: run.found,
    filteredTitle: counts.title ?? 0,
    filteredTier: 0,
    filteredLocation: counts.location ?? 0,
    filteredPostingAge: 0,
    filteredSalary: 0,
    filteredContent: 0,
    filteredCooldown: 0,
    dupes: (counts.seen ?? 0) + (counts.duplicateRole ?? 0),
    newAdded: run.newAdded,
    errors: run.errors,
    filteredBlacklist: counts.blacklisted ?? 0,
  }, filePath));
}


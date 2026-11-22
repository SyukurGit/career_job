import { canonicalJobKey } from './core/url-key.mjs';

// Append-only order shared with lib/scan-history-columns.mjs in core. Existing
// ledgers may retain an older header even after longer rows are appended.
export const HISTORY_COLUMNS = Object.freeze([
  'url', 'first_seen', 'portal', 'title', 'company', 'status', 'location',
  'fingerprint', 'posted_at', 'trust_score', 'trust_flags', 'normalized_company',
  'requisition_id', 'language', 'listing_key', 'closes_at',
  'source_updated_at', 'first_seen_at', 'last_seen_at', 'workplace_type',
  'eligibility', 'eligibility_reason', 'geography_evidence',
  'posting_status',
]);

/** Accept calendar dates without fabricating a midnight observation time. */
export function factualTimestamp(value) {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  const day = text.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const date = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return undefined;
  if (text.length === 10) return text;
  const instant = text.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-](\d{2}):?(\d{2}))$/i);
  if (!instant || Number(instant[1]) > 23 || Number(instant[2]) > 59 || Number(instant[3] ?? 0) > 59
    || Number(instant[5] ?? 0) > 23 || Number(instant[6] ?? 0) > 59) return undefined;
  return Number.isFinite(Date.parse(text)) ? text : undefined;
}

export function parsePostingFacts(value) {
  let facts = value;
  if (typeof value === 'string') {
    try { facts = JSON.parse(value); } catch { return {}; }
  }
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) return {};
  const result = {};
  for (const name of ['postedAt', 'sourceUpdatedAt', 'firstSeenAt', 'lastSeenAt', 'closesAt']) {
    const timestamp = factualTimestamp(facts[name]);
    if (timestamp) result[name] = timestamp;
  }
  if (['remote', 'hybrid', 'onsite', 'unknown'].includes(facts.workplaceType)) result.workplaceType = facts.workplaceType;
  if (['eligible', 'restricted', 'unknown'].includes(facts.eligibility)) result.eligibility = facts.eligibility;
  if (['open', 'closed', 'unknown'].includes(facts.postingStatus)) result.postingStatus = facts.postingStatus;
  if (typeof facts.eligibilityReason === 'string' && facts.eligibilityReason.trim()) result.eligibilityReason = facts.eligibilityReason.trim();
  if (facts.geographyEvidence && typeof facts.geographyEvidence === 'object' && !Array.isArray(facts.geographyEvidence)) result.geographyEvidence = structuredClone(facts.geographyEvidence);
  if (typeof facts.source === 'string' && facts.source.trim()) result.source = facts.source.trim();
  return result;
}

function earliest(a, b) { return !a ? b : !b ? a : Date.parse(a) <= Date.parse(b) ? a : b; }
function latest(a, b) { return !a ? b : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b; }

/** Observation order is independent of publication provenance. Unknown values
 * cannot replace a previous concrete admission/geography fact. */
function mergeObservedFacts(previous, incoming) {
  const result = { ...previous, ...incoming };
  for (const name of ['firstSeenAt', 'lastSeenAt', 'sourceUpdatedAt']) {
    const value = (name === 'firstSeenAt' ? earliest : latest)(previous[name], incoming[name]);
    if (value) result[name] = value;
  }
  const older = previous.lastSeenAt && (!incoming.lastSeenAt || Date.parse(incoming.lastSeenAt) < Date.parse(previous.lastSeenAt));
  for (const name of ['workplaceType', 'eligibility', 'postingStatus']) {
    if ((older || !incoming[name] || incoming[name] === 'unknown') && previous[name] && previous[name] !== 'unknown') result[name] = previous[name];
  }
  if (result.eligibility !== incoming.eligibility || !incoming.eligibilityReason) {
    if (previous.eligibilityReason) result.eligibilityReason = previous.eligibilityReason;
    else delete result.eligibilityReason;
  }
  const geography = structuredClone(previous.geographyEvidence ?? {});
  for (const [name, value] of Object.entries(incoming.geographyEvidence ?? {})) {
    const known = value !== null && value !== undefined && value !== '' && value !== 'unknown' && (!Array.isArray(value) || value.length > 0);
    if (known && (!older || geography[name] === undefined)) geography[name] = structuredClone(value);
  }
  if (!older && incoming.workplaceType && incoming.workplaceType !== 'unknown') geography.workplaceType = incoming.workplaceType;
  if (Object.keys(geography).length) result.geographyEvidence = geography;
  if (typeof geography.location === "string") result.location = geography.location;
  return result;
}

/** No scan-run join: an unrelated run proves nothing about an individual URL. */
export function parseScanMetadata(text) {
  const index = new Map();
  for (const line of String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = line.split('\t').map((cell) => /^'[=+\-@]/.test(cell) ? cell.slice(1) : cell);
    if (cells[0].trim().toLowerCase() === 'url') continue;
    const row = Object.fromEntries(HISTORY_COLUMNS.map((name, i) => [name, cells[i] ?? '']));
    const key = canonicalJobKey(row.url);
    if (!key) continue;
    let geographyEvidence;
    try { geographyEvidence = JSON.parse(row.geography_evidence); } catch { /* old ledger */ }
    if (!geographyEvidence || typeof geographyEvidence !== 'object' || Array.isArray(geographyEvidence)) geographyEvidence = {};
    if (row.location.trim() && !/^(?:—|-|unknown|n\/a)$/i.test(row.location.trim())) geographyEvidence.location = row.location.trim();
    const facts = parsePostingFacts({
      postedAt: row.posted_at, sourceUpdatedAt: row.source_updated_at,
      closesAt: row.closes_at, postingStatus: row.posting_status || (row.status === 'skipped_expired' ? 'closed' : undefined),
      firstSeenAt: factualTimestamp(row.first_seen_at) ?? row.first_seen, lastSeenAt: row.last_seen_at,
      workplaceType: row.workplace_type, eligibility: row.eligibility,
      eligibilityReason: row.eligibility_reason, geographyEvidence, source: row.portal,
    });
    const previous = index.get(key) ?? {};
    index.set(key, mergeObservedFacts(previous, facts));
  }
  return index;
}

/** Own publication evidence wins, but newer observations supersede stale row
 * admission/geography. History only joins the exact canonical posting. */
export function withPostingMetadata(job, index) {
  const facts = index.get(canonicalJobKey(job.url));
  if (!facts) return { ...job, ...(job.geographyEvidence ? { geographyEvidence: structuredClone(job.geographyEvidence) } : {}) };
  const result = mergeObservedFacts(job, facts);
  for (const name of ['postedAt', 'source']) if (job[name] !== undefined) result[name] = job[name];
  return result;
}

/** A date-only source remains date-only; instants always render in Asia/Jakarta. */
export function formatJakartaTimestamp(value) {
  const valid = factualTimestamp(value);
  if (!valid) return undefined;
  const dateOnly = valid.length === 10;
  const parts = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric',
    ...(!dateOnly ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}),
  }).formatToParts(new Date(dateOnly ? `${valid}T00:00:00Z` : valid));
  const get = (name) => parts.find((part) => part.type === name)?.value;
  const date = `${get('day')} ${get('month')} ${get('year')}`;
  return dateOnly ? date : `${date} ${get('hour')}:${get('minute')} WIB`;
}

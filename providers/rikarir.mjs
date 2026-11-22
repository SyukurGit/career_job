// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */

import { BROWSER_LIKE_USER_AGENT, fetchJsonWithRetry, sleep } from './_http.mjs';

// Rikarir provider — reads the public v1 job-board REST API at api.rikarir.com.
//
// Rikarir (rikarir.com) aggregates Indonesian job postings (primarily Glints,
// Dealls, and Kalibrr) and exposes them through a clean, no-auth JSON API at
// /api/v1/jobs with work_mode=REMOTE filtering and raw_source_url links back
// to the canonical origin posting (so scan-history dedups seamlessly).
//
// Explicit `provider: rikarir` in portals.yml.
//
// Portal entry fields (all optional except `provider`):
//   api             — search endpoint (default: https://api.rikarir.com/api/v1/jobs)
//   searchKeywords  — keyword filter (`keyword` query param)
//   workMode        — work mode filter ("REMOTE", "HYBRID", "ONSITE", or "" for all; default: "REMOTE")
//   sortBy          — sort order (default: "newest")
//   pageSize        — rows per request (default 50, capped at 100)
//   max_pages       — max pagination depth (default 10)

const DEFAULT_API = 'https://api.rikarir.com/api/v1/jobs';
const ALLOWED_HOST = 'api.rikarir.com';
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 10;
const INTER_PAGE_DELAY_MS = 120;

/** @param {string} url */
function assertRikarirUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`rikarir: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`rikarir: URL must use HTTPS: ${url}`);
  if (parsed.hostname.toLowerCase() !== ALLOWED_HOST) {
    throw new Error(`rikarir: untrusted hostname "${parsed.hostname}" — must be ${ALLOWED_HOST}`);
  }
  return url;
}

/** @param {string | null | undefined} value */
function toEpochMs(value) {
  if (typeof value !== 'string' || !value) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) || ms <= 0 ? undefined : ms;
}

/** @param {unknown} rawUrl */
function resolveCanonicalUrl(rawUrl, id) {
  if (typeof rawUrl === 'string' && rawUrl.trim()) {
    try {
      const parsed = new URL(rawUrl.trim());
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return parsed.href;
      }
    } catch {
      /* fall through to rikarir detail URL */
    }
  }
  return `https://rikarir.com/job/${encodeURIComponent(String(id))}`;
}

/**
 * Normalize one Rikarir v1 job row into the canonical Job shape.
 * Exported for unit tests.
 *
 * @param {any} item
 * @param {string} fallbackCompany
 * @returns {Job | null}
 */
export function normalizeRikarirJob(item, fallbackCompany) {
  if (!item || typeof item !== 'object' || !item.id) return null;

  const title = String(item.title || '').trim();
  if (!title) return null;

  const id = String(item.id).trim();
  const company = String(item.company_name || fallbackCompany || '').trim();
  const url = resolveCanonicalUrl(item.raw_source_url || item.source_url, id);

  const locParts = [];
  const pushLoc = (val) => {
    const s = String(val || '').trim();
    if (!s) return;
    if (!locParts.some((p) => p.toLowerCase() === s.toLowerCase())) locParts.push(s);
  };
  pushLoc(item.location_city);
  pushLoc(item.location_province);
  pushLoc(item.location_country === 'ID' ? 'Indonesia' : item.location_country);

  const mode = String(item.work_mode || '').toUpperCase();
  if (mode === 'REMOTE' && !locParts.some((p) => /\bremote\b/i.test(p))) locParts.push('Remote');
  else if (mode === 'HYBRID' && !locParts.some((p) => /\bhybrid\b/i.test(p))) locParts.push('Hybrid');

  const location = locParts.join(', ');

  /** @type {Job} */
  const job = {
    title,
    url,
    company,
    location,
    externalId: String(item.external_id || id),
  };

  const postedAt = toEpochMs(item.published_at) ?? toEpochMs(item.date_posted);
  if (postedAt !== undefined) job.postedAt = postedAt;
  const sourceUpdatedAt = toEpochMs(item.updated_at);
  if (sourceUpdatedAt !== undefined) job.sourceUpdatedAt = sourceUpdatedAt;
  if (mode === 'REMOTE') job.workplaceType = 'remote';
  if (mode === 'HYBRID') job.workplaceType = 'hybrid';
  if (['ON_SITE', 'ONSITE', 'ON-SITE'].includes(mode)) job.workplaceType = 'onsite';

  const min = Number(item.salary_min) || 0;
  const max = Number(item.salary_max) || 0;
  if (item.is_salary_disclosed && (min > 0 || max > 0)) {
    const currency = String(item.salary_currency || 'IDR').toUpperCase();
    job.salary = {
      ...(min > 0 ? { min } : {}),
      ...(max > 0 ? { max } : {}),
      currency,
    };
  }

  const skills = Array.isArray(item.skills)
    ? item.skills.map((s) => (typeof s === 'string' ? s : s?.name)).filter(Boolean).join(', ')
    : '';
  const desc = [skills, item.description_raw || item.ai_summary].filter(Boolean).join(' · ').trim();
  if (desc) job.description = desc;

  return job;
}

/** @type {Provider} */
export default {
  id: 'rikarir',

  detect(_entry) {
    return null;
  },

  async fetch(entry, ctx) {
    const api = assertRikarirUrl(entry?.api || DEFAULT_API);
    const keywords = typeof entry?.searchKeywords === 'string' ? entry.searchKeywords.trim() : '';
    const workModeRaw = entry?.workMode !== undefined ? String(entry.workMode).trim().toUpperCase() : 'REMOTE';
    const workMode = workModeRaw === 'ALL' ? '' : workModeRaw;
    const sortBy = typeof entry?.sortBy === 'string' && entry.sortBy.trim() ? entry.sortBy.trim() : 'newest';
    const rawPageSize = Number(entry?.pageSize);
    const pageSize = Number.isInteger(rawPageSize) && rawPageSize > 0 ? Math.min(rawPageSize, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
    const rawPages = Number(entry?.max_pages ?? entry?.maxPages);
    const entryMaxPages = Number.isInteger(rawPages) && rawPages > 0 ? Math.min(rawPages, 25) : DEFAULT_MAX_PAGES;
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const maxPages = Math.min(entryMaxPages, probing ? ctx.maxPages : Infinity);
    const fallbackCompany = typeof entry?.name === 'string' ? entry.name : 'Rikarir';

    /** @type {Job[]} */
    const out = [];
    const seen = new Set();

    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);

      const url = new URL(api);
      url.searchParams.set('limit', String(pageSize));
      url.searchParams.set('page', String(page));
      url.searchParams.set('sort_by', sortBy);
      if (workMode) url.searchParams.set('work_mode', workMode);
      if (keywords) url.searchParams.set('keyword', keywords);

      let json;
      try {
        json = /** @type {any} */ (
          await fetchJsonWithRetry(ctx, url.href, {
            headers: {
              Accept: 'application/json',
              'User-Agent': BROWSER_LIKE_USER_AGENT,
              Origin: 'https://rikarir.com',
              Referer: 'https://rikarir.com/',
            },
            redirect: 'error',
          })
        );
      } catch (err) {
        if (probing || page === 1) throw err;
        out.coverage = { status: 'partial', reason: `page ${page} fetch failed: ${err.message}` };
        break;
      }

      if (!Array.isArray(json?.data)) {
        if (page === 1) throw new Error('rikarir: unexpected response; missing data array');
        out.coverage = { status: 'partial', reason: `invalid response on page ${page}: missing data array` };
        break;
      }
      const items = json.data;
      const totalPages = json.meta?.total_pages == null ? null : Number(json.meta.total_pages);
      const hasPageTotal = Number.isSafeInteger(totalPages) && totalPages >= 0;
      if (items.length === 0) {
        if (hasPageTotal && page < totalPages) out.coverage = { status: 'partial', reason: `page ${page} was empty before the reported last page` };
        break;
      }

      for (const item of items) {
        const job = normalizeRikarirJob(item, fallbackCompany);
        if (!job || seen.has(job.url)) continue;
        seen.add(job.url);
        out.push(job);
      }

      if (hasPageTotal ? page >= totalPages : items.length < pageSize) break;
      if (page === maxPages) out.coverage = { status: 'partial', reason: `pagination cap reached (${maxPages} pages)` };
    }

    return out;
  },
};

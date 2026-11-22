// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */

import { BROWSER_LIKE_USER_AGENT, fetchJsonWithRetry, sleep } from './_http.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

// Dealls provider — reads the public explore-job JSON API of Dealls (dealls.com / api.sejutacita.id).
//
// Explicit `provider: dealls` in portals.yml.
//
// Portal entry fields (all optional except `provider`):
//   api             — search endpoint (default: https://api.sejutacita.id/v1/explore-job/job)
//   searchKeywords  — keyword filter (`search` query param)
//   workplaceTypes  — optional workplace filter ("remote", "hybrid", "onsite")
//   pageSize        — rows per request (default: 50, capped at 100)
//   max_pages       — max pagination depth (default: 3)

const DEFAULT_API = 'https://api.sejutacita.id/v1/explore-job/job';
const ALLOWED_HOST = 'api.sejutacita.id';
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 3;
const INTER_PAGE_DELAY_MS = 250;

/** @param {string} url */
function assertDeallsUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`dealls: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`dealls: URL must use HTTPS: ${url}`);
  if (parsed.hostname.toLowerCase() !== ALLOWED_HOST) {
    throw new Error(`dealls: untrusted hostname "${parsed.hostname}" — must be ${ALLOWED_HOST}`);
  }
  return url;
}

/** @param {string | null | undefined} value */
function toEpochMs(value) {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) || ms <= 0 ? undefined : ms;
}

/**
 * Parse a single Dealls explore-job doc into the canonical Job shape.
 * Exported for unit tests.
 *
 * @param {any} item
 * @param {string} fallbackCompany
 * @returns {Job | null}
 */
export function normalizeDeallsJob(item, fallbackCompany) {
  if (!item || typeof item !== 'object' || (!item.slug && !item.id)) return null;

  const title = String(item.role || item.title || '').trim();
  if (!title) return null;

  const slug = String(item.slug || item.id).trim();
  const encodedSlug = safeEncodeURIComponent(slug);
  if (!encodedSlug) return null;
  const company = String(item.company?.name || fallbackCompany || '').trim();
  const url = `https://dealls.com/loker/${encodedSlug}`;

  const locParts = [];
  if (item.city?.name) locParts.push(item.city.name);
  else if (typeof item.location === 'string' && item.location.trim()) locParts.push(item.location.trim());
  const countryName = item.country?.name || 'Indonesia';
  if (!locParts.some((p) => p.toLowerCase() === countryName.toLowerCase())) locParts.push(countryName);
  const wp = String(item.workplaceType || '').toLowerCase();
  if (wp === 'remote') locParts.push('Remote');
  else if (wp === 'hybrid') locParts.push('Hybrid');
  const location = locParts.join(', ');

  /** @type {Job} */
  const job = {
    title,
    url,
    company,
    location,
    externalId: String(item.id || slug),
  };

  const postedAt = toEpochMs(item.publishedAt || item.createdAt);
  if (postedAt !== undefined) job.postedAt = postedAt;

  const min = Number(item.salaryRange?.start ?? item.salary?.min) || 0;
  const max = Number(item.salaryRange?.end ?? item.salary?.max) || 0;
  if (min > 0 || max > 0) {
    job.salary = {
      ...(min > 0 ? { min } : {}),
      ...(max > 0 ? { max } : {}),
      currency: String(item.salary?.currency || 'IDR').toUpperCase(),
    };
  }

  const skillNames = Array.isArray(item.skills)
    ? item.skills.map((s) => (typeof s === 'string' ? s : s?.name)).filter(Boolean).join(', ')
    : '';
  const desc = [skillNames, item.description].filter(Boolean).join(' · ').trim();
  if (desc) job.description = desc;

  return job;
}

/** @type {Provider} */
export default {
  id: 'dealls',

  detect(_entry) {
    return null;
  },

  async fetch(entry, ctx) {
    const api = assertDeallsUrl(entry?.api || DEFAULT_API);
    const keywords = typeof entry?.searchKeywords === 'string' ? entry.searchKeywords.trim() : '';
    const workplaceTypes = typeof entry?.workplaceTypes === 'string' ? entry.workplaceTypes.trim() : '';
    const rawPageSize = Number(entry?.pageSize);
    const pageSize = Number.isInteger(rawPageSize) && rawPageSize > 0 ? Math.min(rawPageSize, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
    const rawPages = Number(entry?.max_pages ?? entry?.maxPages);
    const entryMaxPages = Number.isInteger(rawPages) && rawPages > 0 ? Math.min(rawPages, 20) : DEFAULT_MAX_PAGES;
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const maxPages = Math.min(entryMaxPages, probing ? ctx.maxPages : Infinity);
    const fallbackCompany = typeof entry?.name === 'string' ? entry.name : 'Dealls';

    /** @type {Job[]} */
    const out = [];
    const seen = new Set();

    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);

      const url = new URL(api);
      url.searchParams.set('page', String(page));
      url.searchParams.set('limit', String(pageSize));
      url.searchParams.set('sortParam', 'mostRelevant');
      url.searchParams.set('sortBy', 'asc');
      url.searchParams.set('published', 'true');
      url.searchParams.set('status', 'active');
      if (keywords) url.searchParams.set('search', keywords);
      if (workplaceTypes) url.searchParams.set('workplaceTypes', workplaceTypes);

      let json;
      try {
        json = /** @type {any} */ (
          await fetchJsonWithRetry(ctx, url.href, {
            headers: {
              Accept: 'application/json',
              'User-Agent': BROWSER_LIKE_USER_AGENT,
              Origin: 'https://dealls.com',
              Referer: 'https://dealls.com/',
            },
            redirect: 'error',
          })
        );
      } catch (err) {
        if (probing || page === 1) throw err;
        console.warn(`dealls: page ${page} failed — ${err.message}`);
        break;
      }

      const docs = Array.isArray(json?.data?.docs) ? json.data.docs : Array.isArray(json?.data?.jobs) ? json.data.jobs : [];
      if (docs.length === 0) break;

      for (const item of docs) {
        const job = normalizeDeallsJob(item, fallbackCompany);
        if (!job || seen.has(job.url)) continue;
        seen.add(job.url);
        out.push(job);
      }

      const totalPages = Number(json?.data?.totalPages);
      if (Number.isFinite(totalPages) && page >= totalPages) break;
      if (docs.length < pageSize) break;
    }

    return out;
  },
};

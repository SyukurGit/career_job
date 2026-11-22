// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */

import { BROWSER_LIKE_USER_AGENT, fetchJsonWithRetry, sleep } from './_http.mjs';
import { safeEncodeURIComponent } from './_safe-url.mjs';

// Karirhub Kemnaker provider — reads the public catalog REST API of SIAPkerja / Karirhub Kemnaker RI.
//
// Endpoint: https://api.kemnaker.go.id/karirhub/catalogue/v1/industrial-vacancies
//
// Portal entry fields (all optional except `provider`):
//   api             — search endpoint (default: https://api.kemnaker.go.id/karirhub/catalogue/v1/industrial-vacancies)
//   searchKeywords  — keyword filter (sent as `keyword` query param)
//   pageSize        — rows per request (default: 50, capped at 100)
//   max_pages       — max pagination depth (default: 3)
//   skipExternal    — when true, skip mirrored external-aggregator listings (default: false)

const DEFAULT_API = 'https://api.kemnaker.go.id/karirhub/catalogue/v1/industrial-vacancies';
const ALLOWED_HOST = 'api.kemnaker.go.id';
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 3;
const INTER_PAGE_DELAY_MS = 250;

/** @param {string} url */
function assertKarirhubUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`karirhub: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`karirhub: URL must use HTTPS: ${url}`);
  if (parsed.hostname.toLowerCase() !== ALLOWED_HOST) {
    throw new Error(`karirhub: untrusted hostname "${parsed.hostname}" — must be ${ALLOWED_HOST}`);
  }
  return url;
}

/**
 * Format city/region strings cleanly without SCREAMING_CAPS.
 * @param {string | undefined | null} city
 * @returns {string}
 */
function formatCity(city) {
  if (!city) return 'Indonesia';
  const pretty = String(city)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w === 'dki' || w === 'kab.' ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
  return `${pretty}, Indonesia`;
}

/**
 * Parse Karirhub vacancy object into the canonical Job shape.
 * Exported for unit tests.
 *
 * @param {any} item
 * @param {string} fallbackCompany
 * @returns {Job | null}
 */
export function normalizeKarirhubJob(item, fallbackCompany) {
  if (!item || typeof item !== 'object' || !item.id) return null;

  const title = String(item.title || item.position_name || item.name || '').trim();
  if (!title) return null;

  const id = String(item.id).trim();
  const encodedId = safeEncodeURIComponent(id);
  if (!encodedId) return null;
  const company = String(item.company_name || item.industrial_name || fallbackCompany || '').trim();
  const url = `https://karirhub.kemnaker.go.id/lowongan-dalam-negeri/lowongan/${encodedId}`;
  const location = formatCity(item.city_name);

  let postedAt;
  if (typeof item.published_at === 'number' && Number.isFinite(item.published_at) && item.published_at > 0) {
    postedAt = item.published_at > 1e12 ? item.published_at : item.published_at * 1000;
  } else if (typeof item.created_at === 'string') {
    const ms = Date.parse(item.created_at);
    if (!Number.isNaN(ms) && ms > 0) postedAt = ms;
  }

  /** @type {Job} */
  const job = {
    title,
    url,
    company,
    location,
    externalId: id,
  };
  if (postedAt !== undefined) job.postedAt = postedAt;

  if (item.show_salary !== false) {
    const min = Number(item.min_salary_amount ?? item.min_salary) || 0;
    const max = Number(item.max_salary_amount ?? item.max_salary) || 0;
    const currency = String(item.min_salary_currency || item.currency || 'IDR').toUpperCase();
    if (min > 0 || max > 0) {
      job.salary = {
        ...(min > 0 ? { min } : {}),
        ...(max > 0 ? { max } : {}),
        currency,
      };
    }
  }

  const desc = [item.job_function_name, item.job_type_name, item.description].filter(Boolean).join(' · ').trim();
  if (desc) job.description = desc;

  return job;
}

/** @type {Provider} */
export default {
  id: 'karirhub',

  detect(_entry) {
    return null;
  },

  async fetch(entry, ctx) {
    const api = assertKarirhubUrl(entry?.api || DEFAULT_API);
    const keywords = typeof entry?.searchKeywords === 'string' ? entry.searchKeywords.trim() : '';
    const rawPageSize = Number(entry?.pageSize);
    const pageSize = Number.isInteger(rawPageSize) && rawPageSize > 0 ? Math.min(rawPageSize, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
    const rawPages = Number(entry?.max_pages ?? entry?.maxPages);
    const entryMaxPages = Number.isInteger(rawPages) && rawPages > 0 ? Math.min(rawPages, 20) : DEFAULT_MAX_PAGES;
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const maxPages = Math.min(entryMaxPages, probing ? ctx.maxPages : Infinity);
    const skipExternal = entry?.skipExternal === true;
    const fallbackCompany = typeof entry?.name === 'string' ? entry.name : 'Karirhub';

    /** @type {Job[]} */
    const out = [];
    const seen = new Set();

    for (let page = 1; page <= maxPages; page++) {
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS, ctx);

      const url = new URL(api);
      url.searchParams.set('page', String(page));
      url.searchParams.set('limit', String(pageSize));
      if (keywords) url.searchParams.set('keyword', keywords);

      let json;
      try {
        json = /** @type {any} */ (
          await fetchJsonWithRetry(ctx, url.href, {
            headers: {
              Accept: 'application/json',
              'User-Agent': BROWSER_LIKE_USER_AGENT,
            },
            redirect: 'error',
          })
        );
      } catch (err) {
        if (probing || page === 1) throw err;
        console.warn(`karirhub: page ${page} failed — ${err.message}`);
        break;
      }

      const list = Array.isArray(json?.data) ? json.data : Array.isArray(json?.data?.data) ? json.data.data : [];
      if (list.length === 0) break;

      for (const item of list) {
        if (skipExternal && item?.platform_type === 'external') continue;
        const job = normalizeKarirhubJob(item, fallbackCompany);
        if (!job || seen.has(job.url)) continue;
        seen.add(job.url);
        out.push(job);
      }

      const lastPage = Number(json?.meta?.last_page);
      if (Number.isFinite(lastPage) && page >= lastPage) break;
      if (list.length < pageSize) break;
    }

    return out;
  },
};

// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */

import { BROWSER_LIKE_USER_AGENT, fetchTextWithRetry, sleep } from './_http.mjs';
import { decodeEntities } from './_html-entities.mjs';

// LinkedIn provider — reads the public, no-auth guest job-search HTML endpoint
// (`jobs-guest/jobs/api/seeMoreJobPostings/search`) used for logged-out job previews.
//
// Explicit `provider: linkedin` only in portals.yml; auto-detection is disabled so
// company profile links in tracked_companies are never claimed.
//
// Portal entry fields (all optional except `provider`):
//   api             — guest search endpoint (default: https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search)
//   searchKeywords  — keywords query param (supports Boolean OR, e.g. "laravel OR backend")
//   searchLocation  — location query param (default: "Indonesia")
//   workType        — LinkedIn f_WT filter ("1"=Onsite, "2"=Remote, "3"=Hybrid)
//   timeRange       — LinkedIn f_TPR filter (e.g. "r604800" for 7 days)
//   max_pages       — page cap (default: 2, capped at 10 to avoid 429 rate-limits)

const DEFAULT_API = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
const ALLOWED_HOSTS = new Set(['www.linkedin.com', 'linkedin.com']);
const DEFAULT_MAX_PAGES = 2;
const MAX_PAGES_CAP = 10;
const INTER_PAGE_DELAY_MS = 1200;

/** @param {string} url */
function assertLinkedInUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`linkedin: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`linkedin: URL must use HTTPS: ${url}`);
  if (!ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(`linkedin: untrusted hostname "${parsed.hostname}" — must be linkedin.com`);
  }
  return url;
}

/** @param {string | null | undefined} value */
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** @param {string} raw */
function cleanText(raw) {
  if (!raw) return '';
  return decodeEntities(raw.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Parse LinkedIn guest job-card HTML into normalized Job rows.
 * Exported for offline contract tests.
 *
 * @param {string} html
 * @returns {{ jobs: Job[], rawCount: number }}
 */
export function parseLinkedInGuestHtml(html) {
  if (typeof html !== 'string' || !html.trim()) return { jobs: [], rawCount: 0 };
  const chunks = html.split(/<li[\s>]/i).slice(1);
  const jobs = [];
  for (const chunk of chunks) {
    const urnMatch = chunk.match(/data-entity-urn=["']urn:li:jobPosting:(\d+)["']/i);
    const id = urnMatch?.[1];
    if (!id) continue;

    const titleRaw = chunk.match(/<h3[^>]*class=["'][^"']*base-search-card__title[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1];
    const companyRaw = chunk.match(/<h4[^>]*class=["'][^"']*base-search-card__subtitle[^"']*["'][^>]*>([\s\S]*?)<\/h4>/i)?.[1];
    const locRaw = chunk.match(/<span[^>]*class=["'][^"']*job-search-card__location[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1];
    const dateRaw = chunk.match(/<time[^>]*datetime=["']([^"']+)["']/i)?.[1];

    const title = cleanText(titleRaw || '');
    if (!title) continue;

    const company = cleanText(companyRaw || '');
    const location = cleanText(locRaw || '');
    const postedAt = toEpochMs(dateRaw);

    /** @type {Job} */
    const job = {
      title,
      url: `https://www.linkedin.com/jobs/view/${id}`,
      company,
      location,
      externalId: id,
    };
    if (postedAt !== undefined) job.postedAt = postedAt;
    jobs.push(job);
  }
  return { jobs, rawCount: chunks.length };
}

/** @type {Provider} */
export default {
  id: 'linkedin',

  detect(_entry) {
    return null;
  },

  async fetch(entry, ctx) {
    const api = assertLinkedInUrl(entry?.api || DEFAULT_API);
    const keywords = typeof entry?.searchKeywords === 'string' ? entry.searchKeywords.trim() : '';
    const location = typeof entry?.searchLocation === 'string' ? entry.searchLocation.trim() : 'Indonesia';
    const workType = entry?.workType != null ? String(entry.workType).trim() : '';
    const timeRange = typeof entry?.timeRange === 'string' ? entry.timeRange.trim() : '';

    const rawCap = Number(entry?.max_pages ?? entry?.maxPages);
    const entryMaxPages = Number.isInteger(rawCap) && rawCap > 0 ? Math.min(rawCap, MAX_PAGES_CAP) : DEFAULT_MAX_PAGES;
    const probing = Number.isInteger(ctx?.maxPages) && ctx.maxPages > 0;
    const maxPages = Math.min(entryMaxPages, probing ? ctx.maxPages : Infinity);

    /** @type {Job[]} */
    const out = [];
    const seen = new Set();
    let start = 0;

    for (let page = 0; page < maxPages; page++) {
      if (page > 0) await sleep(INTER_PAGE_DELAY_MS, ctx);

      const url = new URL(api);
      if (keywords) url.searchParams.set('keywords', keywords);
      if (location) url.searchParams.set('location', location);
      if (workType) url.searchParams.set('f_WT', workType);
      if (timeRange) url.searchParams.set('f_TPR', timeRange);
      url.searchParams.set('start', String(start));

      let html;
      try {
        html = await fetchTextWithRetry(ctx, url.href, {
          headers: {
            'User-Agent': BROWSER_LIKE_USER_AGENT,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
          },
          redirect: 'error',
        });
      } catch (err) {
        if (probing || page === 0) throw err;
        console.warn(`linkedin: page start=${start} failed — ${err.message}`);
        break;
      }

      const { jobs, rawCount } = parseLinkedInGuestHtml(html);
      if (rawCount === 0 || jobs.length === 0) break;

      for (const job of jobs) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        out.push(job);
      }
      start += rawCount;
    }

    return out;
  },
};

import { canonicalJobKey } from "./core/url-key.mjs";
import { compareSalaryDescending } from "./salary.mjs";
import { factualTimestamp, formatJakartaTimestamp } from "./catalog-metadata.mjs";

const DAY_MS = 86_400_000;
const WIB_OFFSET = 7 * 3_600_000;

/** Calendar-day age in WIB, not an elapsed 24-hour claim. */
export function getJobDaysAgo(value, now = Date.now()) {
  value = factualTimestamp(value);
  if (!value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const timestamp = Date.parse(dateOnly ? `${value}T00:00:00+07:00` : value);
  if (!Number.isFinite(timestamp)) return null;
  const age = Math.floor((now + WIB_OFFSET) / DAY_MS) - Math.floor((timestamp + WIB_OFFSET) / DAY_MS);
  return age < 0 ? null : age;
}

/** True when published today in WIB OR newly discovered within the last 24h. */
export function isNewCatalogJob(job, now = Date.now()) {
  if (!job || typeof job !== "object") return false;
  if (getJobDaysAgo(job.postedAt, now) === 0) return true;
  const seen = factualTimestamp(job.firstSeenAt);
  if (!seen) return false;
  const ts = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(seen) ? `${seen}T00:00:00+07:00` : seen);
  if (!Number.isFinite(ts)) return false;
  const elapsed = now - ts;
  return elapsed >= 0 && elapsed <= DAY_MS;
}

/** Calendar-day relative WIB label, e.g. "hari ini", "kemarin", "2 hari lalu". */
export function formatRelativeWibLabel(value, now) {
  if (!Number.isFinite(now)) return null;
  const days = getJobDaysAgo(value, now);
  if (days === null) return null;
  if (days === 0) return "hari ini";
  if (days === 1) return "kemarin";
  return `${days} hari lalu`;
}

/**
 * Shared timestamp chips for catalog and detail cards:
 * - "Diposting" (publication date from source)
 * - "Di-scan" (first scan discovery time)
 * - "Dicek ulang" (latest active scan check, omitted when identical to "Di-scan")
 * - "Diperbarui sumber" (only when distinct from postedAt)
 * @param {Record<string, any>} job
 * @param {number | null} [now]
 */
export function buildJobTimestampChips(job, now = null) {
  if (!job || typeof job !== "object") return [];
  const postedValue = formatJakartaTimestamp(job.postedAt);
  const postedRel = now != null ? formatRelativeWibLabel(job.postedAt, now) : null;
  const firstValue = formatJakartaTimestamp(job.firstSeenAt);
  const firstRel = now != null ? formatRelativeWibLabel(job.firstSeenAt, now) : null;
  const lastValue = formatJakartaTimestamp(job.lastSeenAt);
  const lastRel = now != null ? formatRelativeWibLabel(job.lastSeenAt, now) : null;
  const updatedValue = formatJakartaTimestamp(job.sourceUpdatedAt);
  const updatedRel = now != null ? formatRelativeWibLabel(job.sourceUpdatedAt, now) : null;

  const chips = [
    {
      kind: "posted",
      label: "Diposting",
      value: postedValue || "Belum diketahui",
      relative: postedValue ? postedRel : null,
    },
  ];
  if (firstValue) {
    chips.push({ kind: "scanned", label: "Di-scan", value: firstValue, relative: firstRel });
  }
  if (lastValue && lastValue !== firstValue) {
    chips.push({
      kind: firstValue ? "rechecked" : "scanned",
      label: firstValue ? "Dicek ulang" : "Di-scan",
      value: lastValue,
      relative: lastRel,
    });
  }
  if (updatedValue && updatedValue !== postedValue) {
    chips.push({ kind: "updated", label: "Diperbarui sumber", value: updatedValue, relative: updatedRel });
  }
  return chips;
}

export function normalizedSeniority(job) {
  const text = `${job.role || ""} ${job.yrs || ""}`;
  if (/\b(?:senior|sr\.?|lead|principal|manager)\b/i.test(text)) return "senior";
  if (/\b(?:junior|jr\.?|entry(?:[- ]level)?|intern(?:ship)?|fresh grad(?:uate)?)\b|\b(?:0\s*[-–]\s*[12]|1\s*[-–]\s*2)\s*(?:years?|tahun|yoe)?/i.test(text)) return "junior";
  return "unknown";
}

/** True for explicit Senior/Lead/Principal titles or 5+ years experience minimums. */
export function isHeavySeniorJob(job) {
  if (normalizedSeniority(job) === "senior") return true;
  const yrs = String(job?.yrs || "").trim();
  const minMatch = yrs.match(/^(\d+)\s*(?:\+|[-–]|years?|thn|tahun|yrs?)/i);
  return Boolean(minMatch && Number(minMatch[1]) >= 5);
}

const GLOBAL_REMOTE_TEXT = /\b(?:worldwide|global(?:ly)?|anywhere|international|distributed|remoteok|remotive|weworkremotely|workingnomads|himalayas|jobicy|4dayweek|nodesk|apac|asia pacific|southeast asia)\b/i;

/** Classify job geography priority cleanly for UI badges & quick focus filters. */
export function classifyCatalogGeography(job) {
  const location = String(job?.location || "");
  const source = String(job?.source || "");
  const combined = `${location} ${job?.role || ""} ${job?.note || ""}`;
  const isBandaOrAcehBesar = /\b(?:banda\s+aceh|aceh\s+besar|darussalam)\b/i.test(combined);
  if (job?.workplaceType !== "remote") {
    if (isBandaOrAcehBesar) return { tier: "aceh_focus", label: "Fokus Banda Aceh / Aceh Besar" };
    if (/\baceh\b/i.test(combined)) return { tier: "aceh_onsite", label: "On-site Aceh" };
    return { tier: "other_onsite", label: job?.workplaceType === "hybrid" ? "Hybrid" : "On-site" };
  }
  const hasId = /\bindonesia\b/i.test(location);
  const hasGlobal = GLOBAL_REMOTE_TEXT.test(`${location} ${source}`);
  if (hasGlobal && !/\bindonesia only\b/i.test(location)) {
    return { tier: "remote_global", label: hasId ? "Remote Global / Indonesia" : "Remote Global" };
  }
  if (hasId) return { tier: "remote_id", label: "Remote Indonesia" };
  return { tier: "remote_global", label: "Remote Global" };
}

export function geographyPriorityRank(job) {
  const { tier } = classifyCatalogGeography(job);
  if (tier === "aceh_focus") return 0;
  if (tier === "aceh_onsite") return 1;
  if (tier === "remote_global") return 2;
  if (tier === "remote_id") return 3;
  return 4;
}

export function readCatalogQuery(search = "") {
  const p = new URLSearchParams(search);
  const time = p.get("age") || "ALL";
  const sort = p.get("sort") || "newest";
  const focus = p.get("focus") || "ALL";
  const evalState = p.get("eval") || "ALL";
  const requestedPage = Number(p.get("page"));
  return {
    q: p.get("q") || "", portal: p.get("portal") || "ALL",
    eligibility: p.get("eligibility") === "unknown" ? "unknown" : "eligible",
    focus: ["ALL", "aceh_focus", "remote_global", "remote_id"].includes(focus) ? focus : "ALL",
    evalState: ["ALL", "evaluated", "unevaluated"].includes(evalState) ? evalState : "ALL",
    remote: p.has("remote") ? p.get("remote") === "1" : null,
    salary: p.get("salary") === "1", junior: p.get("junior") === "1", onlyNew: p.get("new") === "1", excludeSenior: p.get("nosr") === "1", hideSaved: p.get("saved") !== "1",
    age: ["ALL", "1D", "3D", "7D", "14D", "30D", "60D"].includes(time) ? time : "ALL",
    sort: ["newest", "oldest", "salary_high", "company_asc", "priority"].includes(sort) ? sort : "newest",
    page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1, size: [15, 30, 50].includes(Number(p.get("size"))) ? Number(p.get("size")) : 15,
  };
}

export function writeCatalogQuery(state, search = "") {
  const p = new URLSearchParams(search);
  for (const [key, value] of Object.entries({ q: state.q, portal: state.portal, eligibility: state.eligibility, focus: !state.focus || state.focus === "ALL" ? "" : state.focus, eval: !state.evalState || state.evalState === "ALL" ? "" : state.evalState, remote: state.remote == null ? "" : state.remote ? "1" : "0", salary: state.salary ? "1" : "", junior: state.junior ? "1" : "", new: state.onlyNew ? "1" : "", nosr: state.excludeSenior ? "1" : "", saved: state.hideSaved ? "" : "1", age: state.age, sort: state.sort, page: String(state.page), size: String(state.size) })) {
    if (value === "") p.delete(key); else p.set(key, value);
  }
  return p.size ? `?${p}` : "";
}

/** Apply browser preferences and user filters without guessing geography or FX. */
export function selectCatalogJobs(jobs, filters, preferences, savedJobs, now = Date.now()) {
  const savedKeys = new Set(savedJobs.map((job) => canonicalJobKey(job.url) || job.url));
  const onlyRemote = filters.remote ?? preferences.onlyRemoteDefault;
  const focus = filters.focus || "ALL";
  const contextual = jobs.filter((job) => {
    if (job.eligibility === "restricted" || (job.eligibility || "unknown") !== filters.eligibility) return false;
    if (filters.hideSaved && savedKeys.has(canonicalJobKey(job.url) || job.url)) return false;
    if (onlyRemote && job.workplaceType !== "remote") return false;
    if (focus !== "ALL") {
      const geo = classifyCatalogGeography(job);
      if (focus === "aceh_focus" && geo.tier !== "aceh_focus" && geo.tier !== "aceh_onsite") return false;
      if (focus === "remote_global" && geo.tier !== "remote_global") return false;
      if (focus === "remote_id" && geo.tier !== "remote_id" && !(geo.tier === "remote_global" && /\bindonesia\b/i.test(job.location || ""))) return false;
    }
    if (filters.salary && (!job.compensation?.trim() || job.compensation === "-")) return false;
    if (filters.junior && normalizedSeniority(job) !== "junior") return false;
    if (filters.onlyNew && !isNewCatalogJob(job, now)) return false;
    if (filters.excludeSenior && isHeavySeniorJob(job)) return false;
    const evalMode = filters.evalState || "ALL";
    if (evalMode !== "ALL") {
      const done = Boolean(job.isEvaluated || job.evaluatedScore);
      if (evalMode === "evaluated" && !done) return false;
      if (evalMode === "unevaluated" && done) return false;
    }
    if (filters.age !== "ALL") {
      const days = getJobDaysAgo(job.postedAt, now);
      if (days === null || days >= Number(filters.age.slice(0, -1))) return false;
    }
    const term = filters.q.trim().toLowerCase();
    return !term || `${job.role} ${job.company} ${job.location || ""} ${job.compensation || ""} ${job.note || ""} ${job.source}`.toLowerCase().includes(term);
  });
  const portalCounts = new Map();
  for (const job of contextual) portalCounts.set(job.source, (portalCounts.get(job.source) || 0) + 1);
  if (filters.portal !== "ALL" && !portalCounts.has(filters.portal)) portalCounts.set(filters.portal, 0);
  const results = contextual.filter((job) => filters.portal === "ALL" || job.source === filters.portal).sort((a, b) => {
    if (filters.sort === "priority") {
      const rankDiff = geographyPriorityRank(a) - geographyPriorityRank(b);
      if (rankDiff !== 0) return rankDiff;
    }
    if (filters.sort === "salary_high") return compareSalaryDescending(a.compensation, b.compensation);
    if (filters.sort === "company_asc") return a.company.localeCompare(b.company);
    const aDate = a.postedAt ? Date.parse(a.postedAt) : NaN;
    const bDate = b.postedAt ? Date.parse(b.postedAt) : NaN;
    if (!Number.isFinite(aDate)) return Number.isFinite(bDate) ? 1 : 0;
    if (!Number.isFinite(bDate)) return -1;
    return filters.sort === "oldest" ? aDate - bDate : bDate - aDate;
  });
  return { results, contextualCount: contextual.length, portals: [...portalCounts].sort(([a], [b]) => a.localeCompare(b)) };
}

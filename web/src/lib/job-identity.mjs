import { createHash } from "node:crypto";
import { canonicalJobKey, normalizeUrl } from "./core/url-key.mjs";
import { postingHref } from "./posting-url.mjs";
import { unwrapReportUrlToken } from "./core/report-url-token.mjs";

export function canonicalPostingKey(raw) {
  const url = postingHref(raw);
  if (!url) return /^local:manual\/[A-Za-z0-9_-]+$/.test(raw) ? String(raw) : "";
  return normalizeUrl(url);
}

export function makeJobId(url, company, role) {
  const key = canonicalJobKey(url) || url || `${company}::${role}`;
  return createHash("sha1").update(key.trim()).digest("hex").slice(0, 16);
}

export function authoritativeReportUrl(markdown) {
  // An archived JD or a related link is not the report's source header.
  const header = String(markdown ?? "").split(/^##\s|^---\s*$/m)[0];
  const token = header.match(/^\*\*URL:\*\*[ \t]*(.+)$/mi)?.[1]?.trim();
  if (!token) return "";
  const target = unwrapReportUrlToken(token);
  return /^local:manual\/[A-Za-z0-9_-]+$/.test(target) ? target : postingHref(target);
}

const textKey = (value) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
export function matchJobIdentity(target, candidates) {
  const key = canonicalPostingKey(target.url);
  const exact = key ? candidates.filter((row) => canonicalPostingKey(row.url) === key) : [];
  if (exact.length === 1) return { match: exact[0], ambiguous: false };
  if (exact.length > 1) return { match: null, ambiguous: true };
  const fallback = candidates.filter((row) => textKey(row.company) === textKey(target.company)
    && textKey(row.role) === textKey(target.role)
    && !(key && canonicalPostingKey(row.url) && key !== canonicalPostingKey(row.url)));
  return { match: fallback.length === 1 ? fallback[0] : null, ambiguous: fallback.length > 1 };
}

export function mergeJobMetadata(bookmark, canonical) {
  const merged = { ...(bookmark ?? {}) };
  for (const [key, value] of Object.entries(canonical ?? {})) {
    if (value !== undefined && value !== null && value !== "") merged[key] = value;
  }
  return merged;
}

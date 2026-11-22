// @ts-check
import { htmlToText } from './_html-to-text.mjs';

/** Extract publisher facts, never infer publication from modification/discovery. */
export function postingFactsFromHtml(html) {
  const nodes = [];
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
    if (types.some(t => /(?:^|\/)JobPosting$/.test(t || ''))) nodes.push(value);
    if (value['@graph']) visit(value['@graph']);
  };
  for (const match of String(html).matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try { visit(JSON.parse(match[1])); } catch { /* Other invalid script blocks do not erase valid job facts. */ }
  }
  const node = nodes.sort((a, b) => String(b.description || '').length - String(a.description || '').length)[0];
  const out = {};
  const date = value => { const n = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(n) && n > 0 ? n : undefined; };
  if (node) {
    const postedAt = date(node.datePosted), sourceUpdatedAt = date(node.dateModified);
    if (postedAt !== undefined) out.postedAt = postedAt;
    if (sourceUpdatedAt !== undefined) out.sourceUpdatedAt = sourceUpdatedAt;
    if (node.applicantLocationRequirements) out.applicantLocationRequirements = node.applicantLocationRequirements;
    if (/TELECOMMUTE|REMOTE/i.test(String(node.jobLocationType || ''))) out.workplaceType = 'remote';
    if (node.description) out.description = htmlToText(node.description, { cap: Infinity });
    const locations = (Array.isArray(node.jobLocation) ? node.jobLocation : [node.jobLocation]).filter(Boolean).map(location => {
      const a = location.address || {};
      return [a.addressLocality, a.addressRegion, typeof a.addressCountry === 'object' ? a.addressCountry.name : a.addressCountry].filter(Boolean).join(', ');
    }).filter(Boolean);
    if (locations.length) out.location = locations.join(' / ');
  }
  if (!out.description) {
    const body = String(html).match(/<(?:main|article)\b[^>]*>([\s\S]*?)<\/(?:main|article)>/i)?.[1];
    if (body) out.description = htmlToText(body, { cap: Infinity });
  }
  return out;
}

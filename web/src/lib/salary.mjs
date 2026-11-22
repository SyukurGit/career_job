/**
 * Conservative guaranteed lower bound, in IDR/month. Bare amounts assume IDR
 * monthly; explicit annual pay divides by 12. Other periods need paid-hours
 * assumptions and remain unknown. No bundled/live FX rate exists: foreign
 * currency requires an explicit caller-supplied IDR-per-unit rate.
 */
export function salaryMonthlyComparable(value, { rates = {} } = {}) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let text = value.toLowerCase().replace(/[–—−]/g, '-').trim();
  text = text.replace(/\s*\((?:gross|net)\)\s*$/i, '').replace(/\s+(?:gross|net)\s*$/i, '').trim();
  text = text.replace(/\/\s*m\s*$/, '/month').replace(/\/\s*y\s*$/, '/year');
  const period = text.match(/\s*(?:\/\s*|per\s+|a\s+)?(month(?:ly)?|bulan(?:an)?|bln|mo|mth|year(?:ly)?|annual(?:ly)?|tahun(?:an)?|thn|annum|yr|p\.?a\.?)\s*$/);
  let annual = false;
  if (period) {
    annual = /^(?:year|annual|tahun|thn|annum|yr|p\.?a)/.test(period[1]);
    text = text.slice(0, period.index).trim();
  }
  const currencies = new Set();
  // Bound letters, not digits: USD1200 and Rp5jt are common source formats.
  const markers = /(?<![a-z])(?:us\$|s\$|a\$|c\$|usd|sgd|aud|cad|idr|rupiah|rp\.?|eur|gbp)(?![a-z])|[€£]/g;
  const codes = { 'us$': 'USD', 's$': 'SGD', 'a$': 'AUD', 'c$': 'CAD', usd: 'USD', sgd: 'SGD', aud: 'AUD', cad: 'CAD', idr: 'IDR', rupiah: 'IDR', rp: 'IDR', 'rp.': 'IDR', eur: 'EUR', '€': 'EUR', gbp: 'GBP', '£': 'GBP' };
  text = text.replace(markers, (marker) => { currencies.add(codes[marker]); return ''; }).trim();
  if (currencies.size > 1) return null;
  const currency = [...currencies][0] ?? 'IDR';
  if (['USD', 'SGD', 'AUD', 'CAD'].includes(currency)) text = text.replace(/\$/g, '').trim();
  const rate = currency === 'IDR' ? 1 : rates[currency];
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;
  // Full format matching rejects unsupported currencies, bare $, hourly pay,
  // upper-bound-only offers and numeric bonus/schedule prose, not just numbers.
  const amount = '(\\d+(?:[.,]\\d+)*)(?:\\s*(juta|jt|million|m|k|ribu|rb))?';
  const match = text.match(new RegExp(`^${amount}(?:\\s*(?:-|to|sampai|s\\/?d|s\\.d\\.?)\\s*${amount})?$`));
  if (!match) return null;
  const magnitudes = { juta: 1e6, jt: 1e6, million: 1e6, m: 1e6, k: 1e3, ribu: 1e3, rb: 1e3 };
  const inherited = match[2] ?? match[4];
  const parse = (raw, magnitude) => {
    const dots = (raw.match(/\./g) ?? []).length;
    const commas = (raw.match(/,/g) ?? []).length;
    let numeric = raw;
    if (dots && commas) {
      const decimal = raw.lastIndexOf('.') > raw.lastIndexOf(',') ? '.' : ',';
      const [integer, fraction, extra] = raw.split(decimal);
      const groups = integer.split(decimal === '.' ? ',' : '.');
      if (extra !== undefined || fraction.length > 2 || !groups.slice(1).every((part) => part.length === 3)) return NaN;
      numeric = `${groups.join('')}.${fraction}`;
    } else if (dots || commas) {
      const groups = raw.split(dots ? '.' : ',');
      if (groups.length > 2 || (groups[1].length === 3 && !magnitude)) {
        if (!groups.slice(1).every((part) => part.length === 3)) return NaN;
        numeric = groups.join('');
      } else {
        if (groups[1].length > 2) return NaN;
        numeric = groups.join('.');
      }
    }
    return Number(numeric) * (magnitudes[magnitude] ?? 1);
  };
  const lower = parse(match[1], match[2] ?? inherited);
  const upper = match[3] ? parse(match[3], match[4] ?? inherited) : lower;
  if (![lower, upper].every((amount) => Number.isFinite(amount) && amount > 0) || upper < lower) return null;
  return lower * rate / (annual ? 12 : 1);
}

/** Unknown values stay last regardless of the supported currency/period. */
export function compareSalaryDescending(a, b, options) {
  const left = salaryMonthlyComparable(a, options);
  const right = salaryMonthlyComparable(b, options);
  return left === null ? (right === null ? 0 : 1) : right === null ? -1 : right - left;
}

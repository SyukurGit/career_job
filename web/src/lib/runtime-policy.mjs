import { configuredPortals } from './portals-config.mjs';

const text = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const list = (value) => (Array.isArray(value) ? value : typeof value === 'string' ? [value] : []).filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim());

/** Only actual configured facts; missing candidate facts remain unknown. */
export function runtimePolicySnapshot(config = {}, profile = {}, cv = '', experienceFilter = { enabled: false }) {
  const candidate = profile.candidate ?? {};
  const location = config.location_filter ?? {};
  const title = config.title_filter ?? {};
  const sources = configuredPortals(config);
  const rawAge = config.max_posting_age_days ?? 60;
  const maxDays = Number.isInteger(rawAge) && rawAge > 0 ? rawAge : null;
  const cvName = String(cv).match(/^#\s+(?:CV\s*(?:--|[-–—:])\s*)?(.+)$/m)?.[1];
  const cvLocation = String(cv).match(/^\*\*Location:\*\*\s*(.+)$/mi)?.[1];
  const targetHeadline = list(profile.target_roles?.primary).join(' • ');
  return {
    candidate: {
      name: text(candidate.full_name) ?? text(cvName),
      location: text(candidate.location) ?? text(cvLocation),
      yearsOfExperience: typeof candidate.years_of_experience === 'number' && Number.isFinite(candidate.years_of_experience) && candidate.years_of_experience >= 0 && candidate.years_of_experience <= 60 ? candidate.years_of_experience : null,
      headline: text(candidate.title) ?? text(profile.narrative?.headline) ?? text(targetHeadline),
    },
    sources: { enabled: sources.filter((source) => source.enabled).length, total: sources.length },
    policy: {
      allow: list(location.allow), alwaysAllow: list(location.always_allow),
      block: list(location.block), blockHard: list(location.block_hard),
      titleAllow: list(title.positive), titleBlock: list(title.negative),
      workplace: location.workplace_policy ?? null,
    },
    experienceFilter,
    postingAge: { maxDays, allAges: maxDays === null },
    salary: { currency: 'IDR', period: 'month', foreignRates: null },
  };
}

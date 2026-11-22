const SOURCES = [
  ['jobstreet.com', 'JobStreet'], ['jobstreet.co.id', 'JobStreet'], ['id.jobstreet.com', 'JobStreet'],
  ['glints.com', 'Glints'], ['rikarir.com', 'Rikarir'], ['dealls.com', 'Dealls'],
  ['kalibrr.com', 'Kalibrr'], ['kemnaker.go.id', 'Karirhub'], ['linkedin.com', 'LinkedIn'],
  ['indeed.com', 'Indeed'], ['techinasia.com', 'Tech in Asia'], ['jobicy.com', 'Jobicy'],
  ['himalayas.app', 'Himalayas'], ['larajobs.com', 'LaraJobs'], ['remoteok.com', 'RemoteOK'],
  ['remotive.com', 'Remotive'], ['ashbyhq.com', 'Ashby'], ['greenhouse.io', 'Greenhouse'],
  ['lever.co', 'Lever'], ['weworkremotely.com', 'WeWorkRemotely'], ['factorialhr.com', 'Factorial'],
  ['workable.com', 'Workable'],
];

/** DNS label boundaries, not brand substrings (glints.com.evil is not Glints). */
export function deriveSource(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return 'Web';
    const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
    return SOURCES.find(([domain]) => host === domain || host.endsWith(`.${domain}`))?.[1] ?? host;
  } catch { return 'Web'; }
}

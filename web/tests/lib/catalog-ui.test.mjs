import assert from "node:assert/strict";
import { test } from "node:test";
import { getJobDaysAgo, normalizedSeniority, readCatalogQuery, writeCatalogQuery, selectCatalogJobs, classifyCatalogGeography, isNewCatalogJob, isHeavySeniorJob, formatRelativeWibLabel, buildJobTimestampChips } from "../../src/lib/catalog-ui.mjs";

const preferences = { onlyRemoteDefault: false, minSalary: 5_000_000 };
const job = (id, extra = {}) => ({ id, url: `https://example.com/jobs/${id}`, role: "Engineer", company: "Fictional Co", source: "Fixture", eligibility: "eligible", workplaceType: "remote", ...extra });

test("calendar publication age uses WIB midnight, never first-seen or an invented publication", () => {
  const now = Date.parse("2026-11-15T00:05:00+07:00");
  assert.equal(getJobDaysAgo("2026-11-14T23:55:00+07:00", now), 1);
  assert.equal(getJobDaysAgo("2026-11-14T17:01:00Z", now), 0);
  assert.equal(getJobDaysAgo("2026-11-15", now), 0);
  assert.equal(getJobDaysAgo("2026-11-16", now), null);
  assert.equal(getJobDaysAgo("invalid", now), null);
  const jobs = [job("published", { postedAt: "2026-11-15" }), job("observed", { firstSeenAt: "2026-11-15" })];
  assert.equal(getJobDaysAgo("2026-02-30", now), null);
  assert.equal(getJobDaysAgo("2026-11-15T12:00:00", now), null);
  assert.deepEqual(selectCatalogJobs(jobs, readCatalogQuery("?age=1D"), preferences, [], now).results.map((j) => j.id), ["published"]);
});

test("junior recognizes Jr. and Entry without admitting senior roles", () => {
  for (const role of ["Jr. Engineer", "Junior Analyst", "Entry-level Developer", "Fresh Graduate", "Intern Engineer"]) assert.equal(normalizedSeniority({ role }), "junior", role);
  assert.equal(normalizedSeniority({ role: "Senior Engineer with junior mentoring" }), "senior");
  assert.equal(normalizedSeniority({ role: "Engineer", yrs: "0–2 years" }), "junior");
});

test("unknown location stays a separate review pool and restricted is never certified", () => {
  const jobs = [job("eligible"), job("unknown", { eligibility: "unknown" }), job("legacy", { eligibility: undefined }), job("restricted", { eligibility: "restricted" })];
  assert.deepEqual(selectCatalogJobs(jobs, readCatalogQuery(), preferences, []).results.map((j) => j.id), ["eligible"]);
  assert.deepEqual(selectCatalogJobs(jobs, readCatalogQuery("?eligibility=unknown"), preferences, []).results.map((j) => j.id), ["unknown", "legacy"]);
});

test("portal counts reflect all other filters but not the selected portal", () => {
  const jobs = [job("alpha", { source: "A", role: "Jr. Engineer" }), job("beta", { source: "B", role: "Entry Engineer" }), job("senior", { source: "B", role: "Senior Engineer" })];
  const selected = selectCatalogJobs(jobs, readCatalogQuery("?junior=1&portal=A"), preferences, []);
  assert.equal(selected.contextualCount, 2);
  assert.deepEqual(selected.portals, [["A", 1], ["B", 1]]);
  assert.deepEqual(selected.results.map((j) => j.id), ["alpha"]);
  assert.deepEqual(selectCatalogJobs(jobs, readCatalogQuery("?q=missing&portal=A"), preferences, []).portals, [["A", 0]]);
});

test("saved filtering follows posting identity, not changing Glints slugs or company/title", () => {
  const uuid = "123e4567-e89b-12d3-a456-426614174000";
  const other = "123e4567-e89b-12d3-a456-426614174001";
  const jobs = [job("same", { url: `https://glints.com/id/opportunities/jobs/new-title/${uuid}` }), job("other", { url: `https://glints.com/id/opportunities/jobs/new-title/${other}` })];
  const saved = [{ url: `https://glints.com/id/opportunities/jobs/old-title/${uuid}?utm_source=fixture` }];
  assert.deepEqual(selectCatalogJobs(jobs, readCatalogQuery(), preferences, saved).results.map((j) => j.id), ["other"]);
  assert.equal(selectCatalogJobs(jobs, readCatalogQuery("?saved=1"), preferences, saved).results.length, 2);
});

test("salary target never silently removes low or missing salaries, and sorting keeps incomparable pay last", () => {
  const jobs = [job("foreign", { compensation: "USD 9000/month" }), job("low", { compensation: "Rp 3 juta/bulan" }), job("annual", { compensation: "IDR 96 million/year" }), job("missing")];
  const selected = selectCatalogJobs(jobs, readCatalogQuery("?sort=salary_high"), preferences, []);
  assert.deepEqual(selected.results.map((j) => j.id), ["annual", "low", "foreign", "missing"]);
  assert.equal(selectCatalogJobs(jobs, readCatalogQuery("?salary=1"), preferences, []).results.length, 3);
});

test("configured remote default applies only when the user has not set an explicit filter", () => {
  const jobs = [job("remote"), job("onsite", { workplaceType: "onsite" })];
  const remotePreference = { ...preferences, onlyRemoteDefault: true };
  assert.equal(selectCatalogJobs(jobs, readCatalogQuery(), remotePreference, []).results.length, 1);
  assert.equal(selectCatalogJobs(jobs, readCatalogQuery("?remote=0"), remotePreference, []).results.length, 2);
});

test("catalogue URL roundtrip retains navigation filters and scan provenance", () => {
  const query = "?q=entry+go&portal=B&eligibility=unknown&remote=0&salary=1&junior=1&saved=1&age=7D&sort=salary_high&page=3&size=30&scanRun=fixture";
  const state = readCatalogQuery(query);
  const written = writeCatalogQuery(state, query);
  assert.deepEqual(readCatalogQuery(written), state);
  assert.equal(new URLSearchParams(written).get("scanRun"), "fixture");
  for (const invalid of ["Infinity", "1.5", "-3", "wat"]) assert.equal(readCatalogQuery(`?page=${invalid}`).page, 1);
});

test("geography focus distinguishes Banda Aceh & Aceh Besar onsite from Indonesia and Global remote", () => {
  const jobs = [
    job("aceh", { workplaceType: "onsite", location: "Banda Aceh, Aceh, Indonesia", source: "jobstreet.com" }),
    job("aceh-besar", { workplaceType: "hybrid", location: "Aceh Besar, Aceh", source: "karirhub.kemnaker.go.id" }),
    job("remote-id", { workplaceType: "remote", location: "Indonesia (Remote)", source: "glints.com" }),
    job("remote-global", { workplaceType: "remote", location: "Worldwide — Remote", source: "remotive.com" }),
  ];
  assert.equal(classifyCatalogGeography(jobs[0]).tier, "aceh_focus");
  assert.equal(classifyCatalogGeography(jobs[1]).tier, "aceh_focus");
  assert.equal(classifyCatalogGeography(jobs[2]).tier, "remote_id");
  assert.equal(classifyCatalogGeography(jobs[3]).tier, "remote_global");
  assert.deepEqual(selectCatalogJobs(jobs, readCatalogQuery("?focus=aceh_focus"), preferences, []).results.map((j) => j.id), ["aceh", "aceh-besar"]);
  assert.deepEqual(selectCatalogJobs(jobs, readCatalogQuery("?focus=remote_global"), preferences, []).results.map((j) => j.id), ["remote-global"]);
  assert.deepEqual(selectCatalogJobs(jobs, readCatalogQuery("?sort=priority"), preferences, []).results.map((j) => j.id), ["aceh", "aceh-besar", "remote-global", "remote-id"]);
});

test("BARU badge (< 24h / today WIB) and heavy-senior exclusion filters work deterministically", () => {
  const now = Date.parse("2026-11-15T14:00:00+07:00");
  const jobs = [
    job("today-posted", { postedAt: "2026-11-15", yrs: "1-2 years" }),
    job("fresh-scan", { firstSeenAt: "2026-11-15T06:00:00+07:00", role: "Backend Developer" }),
    job("stale-senior", { postedAt: "2026-11-10", role: "Senior Backend Developer", yrs: "5+ years" }),
    job("exp-heavy", { postedAt: "2026-11-12", role: "Engineer", yrs: "6 tahun" }),
  ];
  assert.equal(isNewCatalogJob(jobs[0], now), true);
  assert.equal(isNewCatalogJob(jobs[1], now), true);
  assert.equal(isNewCatalogJob(jobs[2], now), false);
  assert.equal(isHeavySeniorJob(jobs[0]), false);
  assert.equal(isHeavySeniorJob(jobs[2]), true);
  assert.equal(isHeavySeniorJob(jobs[3]), true);
  assert.deepEqual(selectCatalogJobs(jobs, readCatalogQuery("?new=1"), preferences, [], now).results.map((j) => j.id), ["today-posted", "fresh-scan"]);
  assert.deepEqual(selectCatalogJobs(jobs, readCatalogQuery("?nosr=1"), preferences, [], now).results.map((j) => j.id), ["today-posted", "fresh-scan"]);
  const fullState = readCatalogQuery("?new=1&nosr=1&eval=unevaluated");
  assert.deepEqual(readCatalogQuery(writeCatalogQuery(fullState)), fullState);
  const evalPool = [
    job("done-eval", { evaluatedScore: "4.5/5", isEvaluated: true }),
    job("not-eval", {}),
  ];
  assert.deepEqual(selectCatalogJobs(evalPool, readCatalogQuery("?eval=evaluated"), preferences, []).results.map((j) => j.id), ["done-eval"]);
  assert.deepEqual(selectCatalogJobs(evalPool, readCatalogQuery("?eval=unevaluated"), preferences, []).results.map((j) => j.id), ["not-eval"]);
});

test("timestamp chips rename labels to Diposting/Di-scan, add relative WIB days, and hide duplicate recheck", () => {
  const now = Date.parse("2026-11-22T16:30:00+07:00");
  assert.equal(formatRelativeWibLabel("2026-11-22", now), "hari ini");
  assert.equal(formatRelativeWibLabel("2026-11-21T20:50:00+07:00", now), "kemarin");
  assert.equal(formatRelativeWibLabel("2026-11-20", now), "2 hari lalu");
  assert.equal(formatRelativeWibLabel("2026-11-25", now), null);

  const sameScan = buildJobTimestampChips({
    postedAt: "2026-11-19",
    firstSeenAt: "2026-11-21T20:50:00+07:00",
    lastSeenAt: "2026-11-21T20:50:00+07:00",
  }, now);
  assert.equal(sameScan.length, 2);
  assert.equal(sameScan[0].label, "Diposting");
  assert.equal(sameScan[0].relative, "3 hari lalu");
  assert.equal(sameScan[1].label, "Di-scan");
  assert.equal(sameScan[1].relative, "kemarin");

  const rechecked = buildJobTimestampChips({
    postedAt: "2026-11-19",
    firstSeenAt: "2026-11-21T20:50:00+07:00",
    lastSeenAt: "2026-11-22T08:00:00+07:00",
  }, now);
  assert.equal(rechecked.length, 3);
  assert.equal(rechecked[2].label, "Dicek ulang");
  assert.equal(rechecked[2].relative, "hari ini");
});

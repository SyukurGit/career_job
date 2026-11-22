import assert from "node:assert/strict";
import { test } from "node:test";
import { closesSoonInfo, followUpDueInfo, pipelineStageCounts } from "../../src/lib/pipeline-insights.mjs";
import { buildOutreachMessages, splitCoverDraftForPayload } from "../../src/lib/outreach-templates.mjs";

test("closesSoonInfo identifies urgent deadlines and expired ads accurately", () => {
  const now = Date.parse("2026-11-22T12:00:00+07:00");
  assert.deepEqual(closesSoonInfo("2026-11-22", now), { daysLeft: 0, expired: false, urgent: true, label: "Tutup hari ini" });
  assert.deepEqual(closesSoonInfo("2026-11-23", now), { daysLeft: 1, expired: false, urgent: true, label: "Tutup besok" });
  assert.deepEqual(closesSoonInfo("2026-11-25", now), { daysLeft: 3, expired: false, urgent: true, label: "Tutup 3h lagi" });
  assert.deepEqual(closesSoonInfo("2026-11-20", now), { daysLeft: -2, expired: true, urgent: false, label: "Sudah lewat batas" });
  assert.equal(closesSoonInfo(undefined, now), null);
});

test("followUpDueInfo triggers at >=7 WIB days for Applied without recorded follow-up", () => {
  const now = Date.parse("2026-11-22T12:00:00+07:00");
  assert.equal(followUpDueInfo({ applicationStatus: "Applied", date: "2026-11-14", followUp: "—" }, now).due, true);
  assert.equal(followUpDueInfo({ applicationStatus: "Applied", date: "2026-11-18", followUp: "" }, now).due, false);
  assert.equal(followUpDueInfo({ applicationStatus: "Applied", date: "2026-11-10", followUp: "2026-11-17" }, now).due, false);
  assert.equal(followUpDueInfo({ applicationStatus: "Evaluated", date: "2026-11-01", followUp: "" }, now).due, false);

  const counts = pipelineStageCounts([
    { status: "Evaluated", date: "2026-11-20" },
    { status: "Applied", date: "2026-11-10", followUp: "—" },
    { status: "Interview", date: "2026-11-12" },
    { status: "Rejected", date: "2026-11-01" },
  ], now);
  assert.deepEqual(counts, { total: 4, evaluated: 1, applied: 1, interview: 1, closed: 1, needsFollowUp: 1 });
});

test("buildOutreachMessages creates email, WhatsApp, and LinkedIn grounded in actual fields", () => {
  const draft = "Yth. HRD,\n\nSaya berpengalaman membangun backend Go dan API PostgreSQL.\n\nHormat saya,\nBudi Santoso";
  const msg = buildOutreachMessages({
    role: "Backend Developer",
    company: "AcehTech",
    location: "Banda Aceh",
    candidateName: "Budi Santoso",
    candidateHeadline: "Backend Developer",
    candidateLocation: "Banda Aceh",
    coverDraft: draft,
  });
  assert.equal(msg.emailSubject, "Lamaran Pekerjaan: Backend Developer - Budi Santoso");
  assert.match(msg.emailBody, /AcehTech/);
  assert.match(msg.emailBody, /backend Go dan API PostgreSQL/);
  assert.match(msg.whatsapp, /\*Backend Developer\*/);
  assert.match(msg.linkedin, /Budi Santoso/);
});

test("splitCoverDraftForPayload produces complete payload sections required by generate-cover-letter.mjs", () => {
  const parts = splitCoverDraftForPayload("Yth. Tim Rekrutmen,\n\nParagraf pembuka.\n\nPengenalan profil.\n\nSolusi masalah teknis.\n\nTerima kasih atas waktunya.\n\nHormat saya,\nBudi Santoso", "Software Engineer", "Nusa");
  assert.equal(parts.greeting, "Yth. Tim Rekrutmen,");
  assert.equal(parts.opening, "Paragraf pembuka.");
  assert.equal(parts.profile_intro, "Pengenalan profil.");
  assert.match(parts.problems_section, /Solusi masalah teknis/);
});

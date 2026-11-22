import { factualTimestamp } from "./catalog-metadata.mjs";

const DAY_MS = 86_400_000;
const WIB_OFFSET = 7 * 3_600_000;

function parseWibDay(value) {
  const raw = factualTimestamp(value);
  if (!raw) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00+07:00` : raw;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;
  return Math.floor((ts + WIB_OFFSET) / DAY_MS);
}

/**
 * Pure deadline helper for `closesAt`. Returns null when no factual date is present.
 * Never invents a closing date.
 */
export function closesSoonInfo(closesAt, now = Date.now()) {
  const targetDay = parseWibDay(closesAt);
  if (targetDay === null) return null;
  const todayDay = Math.floor((now + WIB_OFFSET) / DAY_MS);
  const daysLeft = targetDay - todayDay;
  if (daysLeft < 0) {
    return { daysLeft, expired: true, urgent: false, label: "Sudah lewat batas" };
  }
  if (daysLeft === 0) {
    return { daysLeft: 0, expired: false, urgent: true, label: "Tutup hari ini" };
  }
  if (daysLeft === 1) {
    return { daysLeft: 1, expired: false, urgent: true, label: "Tutup besok" };
  }
  return {
    daysLeft,
    expired: false,
    urgent: daysLeft <= 5,
    label: `Tutup ${daysLeft}h lagi`,
  };
}

/**
 * Compute follow-up reminder from tracker application row or enriched bookmark.
 * Triggers when canonical status is "applied", at least 7 WIB days elapsed since `date`,
 * and no followUp date is recorded.
 */
export function followUpDueInfo(entry, now = Date.now()) {
  const statusRaw = String(entry?.applicationStatus || entry?.status || "").toLowerCase();
  if (!statusRaw.includes("applied")) return { due: false, daysSince: null, label: null };
  const dateStr = entry?.date || entry?.appliedDate || entry?.savedAt;
  const startDay = parseWibDay(typeof dateStr === "string" && /^\d{4}-\d{2}-\d{2}/.test(dateStr) ? dateStr.slice(0, 10) : dateStr);
  if (startDay === null) return { due: false, daysSince: null, label: null };
  const todayDay = Math.floor((now + WIB_OFFSET) / DAY_MS);
  const daysSince = todayDay - startDay;
  if (daysSince < 0) return { due: false, daysSince: null, label: null };
  const recordedFollowUp = String(entry?.followUp || "").trim();
  const hasFollowUp = Boolean(recordedFollowUp && recordedFollowUp !== "—" && recordedFollowUp !== "-" && recordedFollowUp.toLowerCase() !== "none");
  const due = !hasFollowUp && daysSince >= 7;
  return {
    due,
    daysSince,
    label: due ? `Perlu follow-up (${daysSince}h lalu)` : null,
  };
}

/** Aggregate pipeline stage counts from applications.md rows. */
export function pipelineStageCounts(applications = [], now = Date.now()) {
  const counts = {
    total: 0,
    evaluated: 0,
    applied: 0,
    interview: 0,
    closed: 0,
    needsFollowUp: 0,
  };
  for (const app of applications) {
    if (!app || typeof app !== "object") continue;
    counts.total++;
    const s = String(app.status || "").replace(/\*/g, "").toLowerCase();
    if (s.includes("interview")) counts.interview++;
    else if (s.includes("reject") || s.includes("discard") || s.includes("skip")) counts.closed++;
    else if (s.includes("applied")) {
      counts.applied++;
      if (followUpDueInfo(app, now).due) counts.needsFollowUp++;
    } else {
      counts.evaluated++;
    }
  }
  return counts;
}

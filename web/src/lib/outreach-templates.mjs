/**
 * Grounded outreach templates for Email, WhatsApp HRD, and LinkedIn DM.
 * Never fabricates unlisted skills or fake metrics; pulls only factual fields
 * from job/candidate profile or an already-generated cover draft.
 */

function firstParagraphOfCover(coverDraft) {
  if (!coverDraft || typeof coverDraft !== "string") return "";
  const lines = coverDraft
    .replace(/^#.*$/gm, "")
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p && !/^(yth\.|dear|halo|assalamu|hormat saya|sincerely|best regards)/i.test(p));
  return lines[0] || "";
}

export function buildOutreachMessages({
  role = "Posisi Terkait",
  company = "Perusahaan",
  location = "",
  candidateName = "[Nama Anda]",
  candidateHeadline = "",
  candidateLocation = "",
  coverDraft = "",
} = {}) {
  const safeName = candidateName?.trim() || "[Nama Anda]";
  const safeRole = role?.trim() || "Posisi Terkait";
  const safeCompany = company?.trim() || "Perusahaan";
  const intro = firstParagraphOfCover(coverDraft);
  const focusLine = intro
    ? intro
    : candidateHeadline?.trim()
      ? `Saya memiliki latar belakang di bidang ${candidateHeadline.trim()} serta pengalaman proyek terkait yang terlampir di CV.`
      : `Saya melampirkan CV dan portofolio proyek terkait sebagai bahan pertimbangan.`;
  const locNote = candidateLocation?.trim()
    ? ` Saat ini saya berdomisili di ${candidateLocation.trim()}${location ? ` dan siap menyesuaikan dengan ketentuan lokasi (${location})` : ""}.`
    : "";

  const emailSubject = `Lamaran Pekerjaan: ${safeRole} - ${safeName}`;
  const emailBody = [
    `Yth. Tim Rekrutmen / HRD ${safeCompany},`,
    "",
    `Perkenalkan, nama saya ${safeName}. Melalui email ini saya ingin menyampaikan ketertarikan untuk melamar posisi ${safeRole} di ${safeCompany}.${locNote}`,
    "",
    focusLine,
    "",
    `Sebagai kelengkapan administrasi, bersama email ini saya lampirkan CV terbaru saya. Terima kasih atas waktu dan kesempatannya, besar harapan saya dapat berdiskusi lebih lanjut pada tahap wawancara.`,
    "",
    "Hormat saya,",
    safeName,
  ].join("\n");

  const whatsapp = [
    `Selamat pagi/siang Bapak/Ibu HRD ${safeCompany}, mohon maaf mengganggu waktunya.`,
    `Saya ${safeName}${candidateLocation?.trim() ? ` dari ${candidateLocation.trim()}` : ""}. Izin menyampaikan ketertarikan untuk posisi *${safeRole}* di ${safeCompany}.`,
    focusLine,
    `Apakah lowongan ini masih terbuka dan boleh saya kirimkan CV via email/WA? Terima kasih banyak.`,
  ].join("\n\n");

  const headlineShort = candidateHeadline?.trim() ? ` (${candidateHeadline.split("•")[0].trim()})` : "";
  const linkedin = `Halo Tim ${safeCompany}, saya ${safeName}${headlineShort}. Saya tertarik pada posisi ${safeRole} di ${safeCompany} dan telah melampirkan CV sesuai kualifikasi. Senang jika dapat terhubung dan berdiskusi lebih lanjut. Terima kasih!`;

  return {
    emailSubject,
    emailBody,
    whatsapp,
    linkedin,
  };
}

/**
 * Split a markdown/plain cover letter draft into structured fields matching
 * `generate-cover-letter.mjs` buildHtml payload requirements.
 */
export function splitCoverDraftForPayload(draftText = "", role = "", company = "") {
  const cleaned = String(draftText || "")
    .replace(/^<<\/?cover-draft>>\s*$/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .trim();
  const blocks = cleaned.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  let greeting = "";
  let bodyBlocks = [...blocks];
  if (bodyBlocks.length > 1 && /^(yth\.|dear|halo|kepada)/i.test(bodyBlocks[0])) {
    greeting = bodyBlocks.shift();
  }
  let closing = "";
  let signature = "";
  if (bodyBlocks.length > 2 && /^(hormat saya|sincerely|best|regards|salam|terima kasih)/i.test(bodyBlocks[bodyBlocks.length - 1])) {
    signature = bodyBlocks.pop();
  } else if (bodyBlocks.length > 3 && bodyBlocks[bodyBlocks.length - 1].split("\n").length <= 3 && /^(hormat saya|sincerely|best|regards|salam)/i.test(bodyBlocks[bodyBlocks.length - 2])) {
    const signName = bodyBlocks.pop();
    signature = `${bodyBlocks.pop()} — ${signName}`.replace(/\n/g, " ");
  }
  const opening = bodyBlocks[0] || `Saya tertarik melamar posisi ${role || "terkait"} di ${company || "perusahaan Anda"}.`;
  const profile_intro = bodyBlocks[1] || bodyBlocks[0] || "Latar belakang dan pengalaman proyek saya tercantum lengkap dalam CV terlampir.";
  const remaining = bodyBlocks.slice(2);
  if (remaining.length > 1) {
    closing = remaining.pop();
  }
  const problems_section = remaining.join("\n\n");
  return {
    greeting: greeting || `Tim Rekrutmen ${company || "Yth."},`,
    opening,
    profile_intro,
    problems_section,
    closing: closing || "Terima kasih atas waktu dan pertimbangannya. Saya siap berdiskusi lebih lanjut melalui wawancara.",
    signature: signature || "Hormat saya,",
  };
}

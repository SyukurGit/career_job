import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";
import * as yaml from "js-yaml";

/**
 * A configuration error that lets the route distinguish a broken user-layer
 * file (409: the user must repair it) from an installation/read failure (500).
 */
export class PortalsConfigError extends Error {
  /**
   * @param {string} message
   * @param {"invalid-user-config" | "read-failed" | "invalid-template"} kind
   * @param {unknown} [cause]
   */
  constructor(message, kind, cause) {
    super(message, { cause });
    this.name = "PortalsConfigError";
    this.kind = kind;
  }
}

/** @param {unknown} value */
export function isMapping(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Load portals.yml without treating parse/read failures as a missing file.
 * The shipped template is used only when the user-layer file is absent.
 *
 * @param {string} file
 * @param {string} templateFile
 * @returns {{ doc: Record<string, unknown>, seeded: boolean, source: string }}
 */
export function loadPortalsDocument(file, templateFile) {
  let source;
  let seeded = false;

  try {
    source = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT") {
      throw new PortalsConfigError("could not read portals.yml", "read-failed", error);
    }

    seeded = true;
    try {
      source = fs.readFileSync(templateFile, "utf8");
    } catch (templateError) {
      throw new PortalsConfigError("could not read portals template", "read-failed", templateError);
    }
  }

  let parsed;
  try {
    parsed = yaml.load(source);
  } catch (error) {
    throw new PortalsConfigError(
      seeded ? "portals template contains invalid YAML" : "portals.yml contains invalid YAML",
      seeded ? "invalid-template" : "invalid-user-config",
      error,
    );
  }

  if (!isMapping(parsed)) {
    throw new PortalsConfigError(
      seeded ? "portals template must contain a YAML mapping" : "portals.yml must contain a YAML mapping",
      seeded ? "invalid-template" : "invalid-user-config",
    );
  }

  return { doc: parsed, seeded, source };
}

/**
 * Return a merge-safe document that changes only the filters owned by the web
 * onboarding flow. All scanner sources and user customizations are preserved.
 *
 * @param {Record<string, unknown>} doc
 * @param {string[]} roles
 * @param {string[] | undefined} locations
 */
export function mergePortalFilters(doc, roles, locations) {
  const merged = { ...doc };
  const titleFilter = isMapping(doc.title_filter) ? { ...doc.title_filter } : {};
  titleFilter.positive = [...roles];
  merged.title_filter = titleFilter;

  if (locations?.length) {
    const locationFilter = isMapping(doc.location_filter) ? { ...doc.location_filter } : {};
    locationFilter.allow = [...locations];
    merged.location_filter = locationFilter;
  }

  return merged;
}

const isTopLevelKey = (line) => /^[^\s#-]/.test(line);
const isNote = (line) => line.trim() === "" || line.trim().startsWith("#");
const indentOf = (line) => line.length - line.trimStart().length;

/**
 * Replace (or add) one list, `section.key`, in portals.yml text, line by line,
 * so every other line, comments included, stays byte-for-byte. Returns null
 * for a shape this edit does not handle (a flow-style section, a scalar
 * value), so the caller can fall back.
 *
 * @param {string[]} lines - edited in place.
 * @param {string} section
 * @param {string} key
 * @param {string[]} items
 * @returns {string[] | null}
 */
function setListInText(lines, section, key, items) {
  const head = lines.findIndex((l) => new RegExp(`^${section}:\\s*(#.*)?$`).test(l));
  if (head < 0) {
    if (lines.some((l) => l.startsWith(`${section}:`))) return null; // flow style or a value on the same line
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push(`${section}:`, `  ${key}:`, ...items.map((i) => `    - ${JSON.stringify(i)}`), "");
    return lines;
  }
  let end = head + 1;
  while (end < lines.length && !isTopLevelKey(lines[end])) end++;
  const child = lines.slice(head + 1, end).find((l) => !isNote(l));
  const childIndent = child ? " ".repeat(indentOf(child)) : "  ";
  const at = lines.findIndex((l, i) => i > head && i < end && l.startsWith(`${childIndent}${key}:`));
  if (at < 0) {
    lines.splice(head + 1, 0, `${childIndent}${key}:`, ...items.map((i) => `${childIndent}  - ${JSON.stringify(i)}`));
    return lines;
  }
  const value = lines[at].slice(childIndent.length + key.length + 1).replace(/\s+#.*$/, "").trim();
  if (value !== "" && !/^\[.*\]$/.test(value)) return null;
  // The list's own lines: everything more indented than the key, up to its last
  // item. Notes between items stay (ahead of the new items, as onboard-write.mjs
  // keeps them); notes after the last item are left where they are.
  let last = at;
  for (let i = at + 1; i < end; i++) {
    if (isNote(lines[i])) continue;
    const sameIndentItem = indentOf(lines[i]) === childIndent.length && lines[i].trimStart().startsWith("- ");
    if (indentOf(lines[i]) <= childIndent.length && !sameIndentItem) break;
    last = i;
  }
  const body = lines.slice(at + 1, last + 1);
  const firstItem = body.find((l) => !isNote(l));
  const itemIndent = firstItem ? " ".repeat(indentOf(firstItem)) : `${childIndent}  `;
  lines.splice(at, last - at + 1, `${childIndent}${key}:`, ...body.filter(isNote), ...items.map((i) => `${itemIndent}- ${JSON.stringify(i)}`));
  return lines;
}

/**
 * portals.yml text with the web-owned filters replaced, keeping every comment
 * and every commented-out company block. A round-trip through yaml.dump would
 * drop all of them (fix-slugs.mjs edits this file as text for the same reason).
 * The result must parse to exactly `mergePortalFilters(doc, ...)`; when it does
 * not, or the file uses a shape the line edit does not handle, this returns
 * null and the caller falls back to serializing the merged document.
 *
 * @param {string} source - the text loadPortalsDocument parsed.
 * @param {string[]} roles
 * @param {string[] | undefined} locations
 * @returns {string | null}
 */
export function patchPortalFiltersText(source, roles, locations) {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  let lines = source.split(/\r?\n/);
  lines = setListInText(lines, "title_filter", "positive", roles);
  if (lines && locations?.length) lines = setListInText(lines, "location_filter", "allow", locations);
  if (!lines) return null;
  const text = lines.join(eol);
  try {
    const expected = mergePortalFilters(/** @type {Record<string, unknown>} */ (yaml.load(source)), roles, locations);
    return isDeepStrictEqual(yaml.load(text), expected) ? text : null;
  } catch {
    return null;
  }
}

/**
 * @typedef {{ name: string, enabled: boolean, host: string }} WatchedCompany
 */

/**
 * The companies in tracked_companies, scanned ones first, so the Portals page
 * can list them before any health check runs.
 *
 * @param {Record<string, unknown>} doc
 * @returns {WatchedCompany[]}
 */
export function watchedCompanies(doc) {
  const list = Array.isArray(doc.tracked_companies) ? doc.tracked_companies : [];
  const hostOf = (url) => {
    try {
      return new URL(String(url)).host;
    } catch {
      return "";
    }
  };
  return list
    .filter((c) => isMapping(c) && typeof c.name === "string" && c.name.trim())
    .map((c) => ({ name: c.name.trim(), enabled: c.enabled !== false, host: hostOf(c.careers_url ?? c.api) }))
    .sort((a, b) => Number(b.enabled) - Number(a.enabled));
}

/**
 * @typedef {{
 *   name: string,
 *   enabled: boolean,
 *   kind: "board" | "company",
 *   host: string,
 *   provider: string,
 *   notes: string,
 * }} ConfiguredPortal
 */

const PROVIDER_HOST_HINT = {
  jobstreet: "id.jobstreet.com",
  kalibrr: "kalibrr.com",
  glints: "glints.com",
  techinasia: "techinasia.com",
  rikarir: "rikarir.com",
  linkedin: "linkedin.com",
  larajobs: "larajobs.com",
  remoteok: "remoteok.com",
  remotive: "remotive.com",
  weworkremotely: "weworkremotely.com",
  workingnomads: "workingnomads.com",
  himalayas: "himalayas.app",
  jobicy: "jobicy.com",
  "4dayweek": "4dayweek.io",
  nodesk: "nodesk.co",
  pythonorg: "python.org",
};

/**
 * All portals configured in portals.yml (both job_boards and tracked_companies),
 * active ones first, including paused (enabled: false) entries so the Portals
 * page lets the user search and inspect every active and paused portal.
 *
 * @param {Record<string, unknown>} doc
 * @returns {ConfiguredPortal[]}
 */
export function configuredPortals(doc) {
  const hostOf = (url) => {
    try {
      return new URL(String(url)).host;
    } catch {
      return "";
    }
  };
  const mapList = (raw, kind) => {
    const list = Array.isArray(raw) ? raw : [];
    return list
      .filter((c) => isMapping(c) && typeof c.name === "string" && c.name.trim())
      .map((c) => {
        const provider =
          typeof c.provider === "string" && c.provider.trim()
            ? c.provider.trim()
            : typeof c.scan_method === "string" && c.scan_method.trim()
              ? c.scan_method.trim()
              : "";
        const host = hostOf(c.careers_url ?? c.api) || (provider ? PROVIDER_HOST_HINT[provider] ?? "" : "");
        const notes = typeof c.notes === "string" ? c.notes.trim() : "";
        return {
          name: c.name.trim(),
          enabled: c.enabled !== false,
          kind,
          host,
          provider,
          notes,
        };
      });
  };
  return [...mapList(doc.job_boards, "board"), ...mapList(doc.tracked_companies, "company")].sort(
    (a, b) => Number(b.enabled) - Number(a.enabled) || (a.kind === b.kind ? 0 : a.kind === "board" ? -1 : 1),
  );
}

/**
 * Extract the YAML name value from a `- name: ...` sequence item header.
 * Returns null when not a matching item line.
 */
function parseYamlItemName(line) {
  const m = line.match(/^\s*-\s+name:\s*(.+)$/);
  if (!m) return null;
  let val = m[1].trim();
  const commentMatch = val.match(/^(['"])(.*)\1\s*(?:#.*)?$/);
  if (commentMatch) return commentMatch[2].trim();
  val = val.replace(/\s+#.*$/, "").trim();
  return val;
}

/**
 * Surgically toggle `enabled: true|false` for an existing portal inside
 * `job_boards` or `tracked_companies`, keeping every comment and formatting intact.
 * Throws 404 when the target entry does not exist.
 */
export function togglePortalEnabledInText(source, { name, kind, enabled }) {
  const targetSection = kind === "board" ? "job_boards" : "tracked_companies";
  const targetName = String(name || "").trim();
  if (!targetName || typeof enabled !== "boolean") {
    throw Object.assign(new Error("Nama portal dan status aktif wajib diisi."), { status: 400 });
  }
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  const head = lines.findIndex((l) => new RegExp(`^${targetSection}:\\s*(#.*)?$`).test(l));
  if (head < 0) throw Object.assign(new Error(`Bagian ${targetSection} tidak ditemukan di portals.yml.`), { status: 404 });

  let sectionEnd = head + 1;
  while (sectionEnd < lines.length && !isTopLevelKey(lines[sectionEnd])) sectionEnd++;

  let itemStart = -1;
  let itemIndentLen = 2;
  for (let i = head + 1; i < sectionEnd; i++) {
    if (isNote(lines[i])) continue;
    const itemName = parseYamlItemName(lines[i]);
    if (itemName && itemName === targetName) {
      itemStart = i;
      itemIndentLen = lines[i].match(/^\s*/)?.[0]?.length ?? 2;
      break;
    }
  }
  if (itemStart < 0) {
    throw Object.assign(new Error(`Portal "${targetName}" tidak ditemukan di ${targetSection}.`), { status: 404 });
  }

  let itemEnd = itemStart + 1;
  while (itemEnd < sectionEnd) {
    const line = lines[itemEnd];
    if (!isNote(line)) {
      const ind = indentOf(line);
      if (ind < itemIndentLen || (ind === itemIndentLen && line.trimStart().startsWith("- "))) break;
    }
    itemEnd++;
  }

  const propIndent = " ".repeat(itemIndentLen + 2);
  let foundEnabled = -1;
  for (let i = itemStart + 1; i < itemEnd; i++) {
    if (new RegExp(`^${propIndent}enabled:\\s*(true|false)\\b`).test(lines[i])) {
      foundEnabled = i;
      break;
    }
  }
  if (foundEnabled >= 0) {
    lines[foundEnabled] = lines[foundEnabled].replace(/enabled:\s*(?:true|false)/, `enabled: ${enabled ? "true" : "false"}`);
  } else {
    lines.splice(itemEnd, 0, `${propIndent}enabled: ${enabled ? "true" : "false"}`);
  }

  const nextText = lines.join(eol);
  const parsed = yaml.load(nextText);
  if (!isMapping(parsed)) throw Object.assign(new Error("Hasil YAML tidak valid setelah perubahan."), { status: 500 });
  return nextText;
}

/**
 * Append a new company portal entry cleanly under `tracked_companies:` while
 * keeping comments intact. Rejects invalid URLs and duplicate company names.
 */
export function appendTrackedCompanyInText(source, { name, careersUrl, provider = "", notes = "" }) {
  const safeName = String(name || "").trim();
  const safeUrl = String(careersUrl || "").trim();
  if (!safeName || !safeUrl) {
    throw Object.assign(new Error("Nama perusahaan dan URL karir wajib diisi."), { status: 400 });
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(safeUrl);
  } catch {
    throw Object.assign(new Error("URL halaman karir tidak valid."), { status: 400 });
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw Object.assign(new Error("URL halaman karir harus memakai https:// atau http://."), { status: 400 });
  }
  const existingDoc = yaml.load(source);
  if (!isMapping(existingDoc)) {
    throw Object.assign(new Error("portals.yml bukan mapping YAML yang valid."), { status: 409 });
  }
  const existingList = Array.isArray(existingDoc.tracked_companies) ? existingDoc.tracked_companies : [];
  if (existingList.some((c) => isMapping(c) && typeof c.name === "string" && c.name.trim().toLowerCase() === safeName.toLowerCase())) {
    throw Object.assign(new Error(`Perusahaan "${safeName}" sudah terdaftar di portals.yml.`), { status: 409 });
  }

  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  const block = [
    `  - name: ${JSON.stringify(safeName)}`,
    `    careers_url: ${safeUrl}`,
    ...(provider.trim() ? [`    provider: ${JSON.stringify(provider.trim())}`] : []),
    ...(notes.trim() ? [`    notes: ${JSON.stringify(notes.trim())}`] : []),
    `    enabled: true`,
  ];

  const head = lines.findIndex((l) => /^tracked_companies:\s*(#.*)?$/.test(l));
  if (head < 0) {
    if (lines.length && lines[lines.length - 1].trim() !== "") lines.push("");
    lines.push("tracked_companies:", "", ...block, "");
  } else {
    let insertAt = head + 1;
    while (insertAt < lines.length && isNote(lines[insertAt])) insertAt++;
    lines.splice(insertAt, 0, ...block, "");
  }

  const nextText = lines.join(eol);
  const parsed = yaml.load(nextText);
  if (!isMapping(parsed)) throw Object.assign(new Error("Hasil YAML tidak valid."), { status: 500 });
  return nextText;
}

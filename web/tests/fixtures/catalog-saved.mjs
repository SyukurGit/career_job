import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-catalog-saved-"));
fs.mkdirSync(path.join(root, "data"));
fs.writeFileSync(path.join(root, "cv.md"), "# Fictional browser fixture\n\nNot a real candidate.\n");
fs.writeFileSync(path.join(root, ".catalog-saved-fixture"), "fictional-only\n");
fs.writeFileSync(path.join(root, "portals.yml"), `portals: []
location_filter:
  workplace_policy:
    onsite_locations: [Aceh, Banda Aceh]
    remote_countries: [Indonesia]
    remote_regions: [Asia, APAC]
`);
const rows = Array.from({ length: 17 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  return `- [ ] https://example.test/fixture-${n}${n === "16" ? "?utm_source=fixture" : ""} | Fixture Co ${n} | Jr. Fixture Engineer ${n} | Remote Indonesia | ${i === 0 ? "IDR 3 juta/month" : "IDR 6 juta/month"} | facts: {"firstSeenAt":"2026-11-14","workplaceType":"remote"}`;
});
rows.push("- [ ] https://example.test/fixture-office | Fixture Office | Entry Office Fixture | Onsite Banda Aceh | facts: {\"workplaceType\":\"onsite\"}");
rows.push("- [ ] https://example.test/fixture-unknown | Fixture Unknown | Entry Unconfirmed Fixture | Remote | facts: {\"workplaceType\":\"remote\"}");
rows.push("- [ ] https://example.test/fixture-restricted | Fixture Foreign | Jr Foreign Fixture | Remote United States only | facts: {\"workplaceType\":\"remote\"}");
fs.writeFileSync(path.join(root, "data/pipeline.md"), `# Fictional catalogue\n\n## Pending\n${rows.join("\n")}\n`);
console.log(root);

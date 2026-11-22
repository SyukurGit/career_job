import { Radar } from "lucide-react";
import path from "node:path";
import { PortalsView } from "@/components/portals-view";
import { careerOpsRoot, portalsConfigPath } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { configuredPortals, loadPortalsDocument, watchedCompanies, type ConfiguredPortal, type WatchedCompany } from "@/lib/portals-config.mjs";

export const dynamic = "force-dynamic";

function readWatched(): {
  watched: WatchedCompany[];
  portals: ConfiguredPortal[];
  missing: boolean;
  error: string | null;
} {
  const root = careerOpsRoot();
  try {
    // The template ships with the code, which a data-only CAREER_OPS_ROOT does not hold.
    const template = path.join(resolveCodeRoot(process.cwd(), process.env), "templates", "portals.example.yml");
    const { doc, seeded } = loadPortalsDocument(portalsConfigPath(root), template);
    return {
      watched: seeded ? [] : watchedCompanies(doc),
      portals: seeded ? [] : configuredPortals(doc),
      missing: seeded,
      error: null,
    };
  } catch (e) {
    return { watched: [], portals: [], missing: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export default function PortalsPage() {
  const { watched, portals, missing, error } = readWatched();
  // Name the file the page reads, which CAREER_OPS_PORTALS can move.
  const target = process.env.CAREER_OPS_PORTALS?.trim() ? portalsConfigPath(careerOpsRoot()) : "portals.yml";
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Radar className="size-6 text-brand-text" />
          <h1 className="font-display text-2xl font-bold tracking-tight text-landing">Sumber Portal Lowongan</h1>
        </div>
        <a
          href="/scanner"
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 text-xs font-medium text-foreground transition-colors hover:border-brand/40 hover:text-brand-text"
        >
          ← Kembali ke Pusat Scan
        </a>
      </div>
      <p className="mt-2 max-w-xl text-sm text-muted">
        Daftar portal &amp; perusahaan yang dipantau <span className="font-medium text-foreground">dreamkur -job</span>. Jalankan cek kesehatan untuk mendeteksi tautan portal yang mati agar tidak terlewat saat scanning.
      </p>
      <p className="mt-1.5 text-xs text-faint">
        Bersumber dari <code className="text-muted">portals.yml</code>.
      </p>
      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-400">
          Could not read <code>portals.yml</code>: {error}
        </p>
      )}
      <div className="mt-6">
        <PortalsView watched={watched} portals={portals} missing={missing} target={target} />
      </div>
    </div>
  );
}

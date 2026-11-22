"use client";

import { cn } from "@/lib/cn";
import type { CatalogJob } from "@/lib/catalog-job";
import { buildJobTimestampChips } from "@/lib/catalog-ui.mjs";

type TimestampChip = {
  kind: "posted" | "scanned" | "rechecked" | "updated";
  label: string;
  value: string;
  relative: string | null;
};

export function JobTimestampChips({ job, nowMs }: { job: Partial<CatalogJob>; nowMs: number | null }) {
  const chips = buildJobTimestampChips(job, nowMs) as TimestampChip[];
  return (
    <>
      {chips.map((chip) => (
        <span
          key={`${chip.kind}-${chip.label}`}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]",
            chip.kind === "scanned"
              ? "border-sky-500/25 bg-sky-500/[0.06] text-muted"
              : chip.kind === "updated"
              ? "border-amber-500/25 bg-amber-500/[0.06] text-muted"
              : "border-border/75 bg-background/60 text-muted"
          )}
        >
          <span>{chip.label}:</span>
          <span className="font-medium text-foreground/90">{chip.value}</span>
          {chip.relative && (
            <span className={cn(chip.kind === "scanned" ? "text-sky-700 dark:text-sky-300" : "text-faint")}>
              ({chip.relative})
            </span>
          )}
        </span>
      ))}
    </>
  );
}

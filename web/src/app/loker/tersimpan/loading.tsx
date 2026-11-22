import { Skeleton } from "@/components/ui/skeleton";

export default function SavedJobsLoading() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8" aria-label="Loading saved jobs">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-10 w-44 rounded-xl" />
      </div>
      <div className="mt-6 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-surface p-5 space-y-2.5">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

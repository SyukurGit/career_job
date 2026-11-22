import { Skeleton } from "@/components/ui/skeleton";

export default function ScannerLoading() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8" aria-label="Loading scanner">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      <div className="mt-6 rounded-2xl border border-border bg-surface p-6 space-y-4">
        <Skeleton className="h-5 w-36" />
        <div className="flex flex-wrap gap-4">
          <Skeleton className="h-10 w-44 rounded-lg" />
          <Skeleton className="h-10 w-36 rounded-xl" />
        </div>
      </div>
      <div className="mt-6 rounded-2xl border border-border bg-surface p-6 space-y-3">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    </div>
  );
}

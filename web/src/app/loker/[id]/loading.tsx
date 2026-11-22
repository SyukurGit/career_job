import { Skeleton } from "@/components/ui/skeleton";

export default function LokerDetailLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6" aria-label="Loading loker detail">
      <Skeleton className="h-4 w-32" />
      <div className="mt-6 rounded-3xl border border-border bg-surface p-6 sm:p-8 space-y-4">
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-6 w-24 rounded-md" />
          <Skeleton className="h-6 w-44 rounded-full" />
        </div>
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-2xl border border-border bg-surface p-6 space-y-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/5" />
        </div>
        <div className="rounded-2xl border border-border bg-surface p-6 space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

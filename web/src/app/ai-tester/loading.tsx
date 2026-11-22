import { Skeleton } from "@/components/ui/skeleton";

export default function AiTesterLoading() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-8" aria-label="Loading AI tester">
      <Skeleton className="h-8 w-52" />
      <Skeleton className="mt-2 h-4 w-72 max-w-full" />
      <div className="mt-6 rounded-2xl border border-border bg-surface p-6 space-y-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-10 w-36 rounded-xl" />
      </div>
    </div>
  );
}

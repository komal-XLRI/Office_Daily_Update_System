import { Skeleton } from "@/components/ui/skeleton";

export default function VisitorsLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-8 w-32" />
      </div>
      <Skeleton className="h-36" />
      <p role="status" className="text-sm text-muted-foreground">
        Loading visitors...
      </p>
      <div className="space-y-2 rounded-xl border p-4">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-9" />
        ))}
      </div>
    </div>
  );
}

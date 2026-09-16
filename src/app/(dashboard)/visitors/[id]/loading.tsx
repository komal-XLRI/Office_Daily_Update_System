import { Skeleton } from "@/components/ui/skeleton";

export default function VisitorLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <Skeleton className="h-8 w-48" />
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        Loading visitor...
      </p>
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-72 lg:col-span-2" />
        <Skeleton className="h-44" />
      </div>
      <Skeleton className="h-40" />
    </div>
  );
}

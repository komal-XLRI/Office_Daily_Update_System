import { OfficeActivityTableSkeleton } from "@/components/dashboard/office-activity-table";
import { StatCardSkeleton } from "@/components/dashboard/stat-card";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <p className="sr-only" role="status">
        Loading dashboard...
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between" aria-hidden="true">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-8 w-full sm:w-80" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <StatCardSkeleton key={index} />
        ))}
      </div>
      <OfficeActivityTableSkeleton />
    </div>
  );
}

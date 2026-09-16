import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

export default function OfficesLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-8 w-28" />
      </div>

      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
          <div className="space-y-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-8 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-8 w-full" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-8 w-16" />
          </div>
        </CardContent>
      </Card>

      <div className="bg-card overflow-hidden rounded-xl border">
        <p role="status" className="text-muted-foreground flex items-center gap-2 border-b px-4 py-3 text-sm">
          <Spinner aria-hidden="true" role="presentation" />
          Loading offices...
        </p>
        <div className="divide-y">
          {Array.from({ length: 7 }, (_, index) => (
            <div key={index} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="hidden h-4 w-20 sm:block" />
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="ml-auto hidden h-4 w-32 md:block" />
              <Skeleton className="h-7 w-32" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

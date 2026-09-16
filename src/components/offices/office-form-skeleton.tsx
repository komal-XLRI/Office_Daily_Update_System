import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

/** Loading placeholder for the add/edit office pages. */
export function OfficeFormSkeleton({ label = "Loading office..." }: { label?: string }) {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <p role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
            <Spinner aria-hidden="true" role="presentation" />
            {label}
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {Array.from({ length: 2 }, (_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
          <Skeleton className="h-12 w-full" />
          <div className="flex justify-end gap-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-28" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

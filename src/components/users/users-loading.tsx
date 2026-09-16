import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

function LoadingMessage({ message }: { message: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner aria-hidden="true" />
      {message}
    </p>
  );
}

export function UsersListSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-8 w-24" />
      </div>
      <Skeleton className="h-36 w-full rounded-xl sm:h-24 lg:h-20" />
      <LoadingMessage message="Loading users..." />
      <div className="space-y-2 rounded-xl border p-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}

export function UserFormSkeleton({ message = "Loading user..." }: { message?: string }) {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <LoadingMessage message={message} />
      <div className="max-w-3xl space-y-5 rounded-xl border p-4">
        <div className="grid gap-5 md:grid-cols-2">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </div>
        <Skeleton className="h-10 w-full" />
        <div className="flex justify-end gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>
    </div>
  );
}

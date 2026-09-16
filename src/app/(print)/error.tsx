"use client";

import { TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

export default function PrintError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12">
      <EmptyState
        icon={TriangleAlertIcon}
        title="Something went wrong"
        description={
          <>
            This page could not be loaded. Please try again.
            {error.digest ? <span className="mt-1 block text-xs">Reference: {error.digest}</span> : null}
          </>
        }
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" onClick={() => retry()}>
              Try again
            </Button>
            <Button asChild variant="outline">
              <Link href="/reports">Back to reports</Link>
            </Button>
          </div>
        }
      />
    </div>
  );
}

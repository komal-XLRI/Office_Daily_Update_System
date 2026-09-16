"use client";

import { TriangleAlertIcon } from "lucide-react";
import { useEffect } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

export default function DashboardError({
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
    <EmptyState
      icon={TriangleAlertIcon}
      title="Something went wrong"
      level={1}
      description={
        <>
          This page could not be loaded. Please try again.
          {error.digest ? <span className="mt-1 block text-xs">Reference: {error.digest}</span> : null}
        </>
      }
      action={
        <Button type="button" onClick={() => retry()}>
          Try again
        </Button>
      }
    />
  );
}

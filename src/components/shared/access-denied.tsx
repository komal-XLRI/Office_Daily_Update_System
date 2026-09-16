import { ShieldAlertIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

import { EmptyState } from "./empty-state";

export function AccessDenied({
  message = "You do not have permission to view this page.",
}: {
  message?: string;
}) {
  return (
    <EmptyState
      icon={ShieldAlertIcon}
      title="Access denied"
      level={1}
      description={message}
      action={
        <Button asChild variant="outline">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      }
    />
  );
}

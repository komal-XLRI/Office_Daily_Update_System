import { SearchXIcon } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main-content" className="flex min-h-svh items-center justify-center p-4">
      <EmptyState
        icon={SearchXIcon}
        title="Not found"
        level={1}
        description="The page or record you are looking for does not exist or may have been removed."
        action={
          <Button asChild variant="outline">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        }
        className="max-w-md"
      />
    </main>
  );
}

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { buildHref } from "@/lib/utils/search-params";

interface PaginationNavProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  /** e.g. "/visitors" */
  pathname: string;
  /** Current filters to preserve (any `page` key is replaced). */
  params: Record<string, string | undefined>;
}

/** Link-based pagination for Server Component list pages. */
export function PaginationNav({ page, totalPages, total, pageSize, pathname, params }: PaginationNavProps) {
  if (total === 0) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const hrefFor = (target: number) => buildHref(pathname, { ...params, page: target === 1 ? undefined : target });

  return (
    <nav aria-label="Pagination" className="flex flex-col items-center justify-between gap-3 sm:flex-row">
      <p className="text-sm text-muted-foreground">
        Showing <span className="tabular-nums">{first}</span>–<span className="tabular-nums">{last}</span> of{" "}
        <span className="tabular-nums">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Button asChild variant="outline" size="sm">
            <Link href={hrefFor(page - 1)} rel="prev">
              <ChevronLeftIcon data-icon="inline-start" aria-hidden="true" />
              Previous
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            <ChevronLeftIcon data-icon="inline-start" aria-hidden="true" />
            Previous
          </Button>
        )}
        <span className="text-sm tabular-nums">
          Page {page} of {totalPages}
        </span>
        {page < totalPages ? (
          <Button asChild variant="outline" size="sm">
            <Link href={hrefFor(page + 1)} rel="next">
              Next
              <ChevronRightIcon data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Next
            <ChevronRightIcon data-icon="inline-end" aria-hidden="true" />
          </Button>
        )}
      </div>
    </nav>
  );
}

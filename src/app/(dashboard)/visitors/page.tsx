import { PlusIcon, UserCheckIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { DailyUpdatesViewTabs } from "@/components/daily-updates/view-tabs";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PaginationNav } from "@/components/shared/pagination-nav";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ALL_IMPORTANCE_VALUE, VisitorFilters } from "@/components/visitors/visitor-filters";
import { VisitorTable } from "@/components/visitors/visitor-table";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants";
import { renderPageError } from "@/lib/page-errors";
import { isAdmin, requirePageUser } from "@/lib/permissions";
import { listOfficeOptions } from "@/lib/services/office-options";
import { listVisitors } from "@/lib/services/visitors";
import { normalizeSearchParams, type RawSearchParams } from "@/lib/utils/search-params";
import { visitorListQuerySchema, type VisitorListQuery } from "@/lib/validation/visitor";
import type { OfficeOption, Paginated, VisitorDTO } from "@/types";

export const metadata: Metadata = {
  title: "Visitors",
};

export default async function VisitorsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await requirePageUser();
  const admin = isAdmin(user);

  const params = normalizeSearchParams(await searchParams);
  if (params.importance === ALL_IMPORTANCE_VALUE) delete params.importance;

  const parsed = visitorListQuerySchema.safeParse(params);
  const query: VisitorListQuery = parsed.success ? parsed.data : visitorListQuerySchema.parse({});
  const notices: string[] = [];
  if (!parsed.success) notices.push("Some filters were invalid and have been ignored.");
  if (!query.date && query.from && query.to && query.from > query.to) {
    notices.push("The To date cannot be before the From date. The date range has been ignored.");
    query.from = undefined;
    query.to = undefined;
  }

  let result: Paginated<VisitorDTO>;
  let offices: OfficeOption[] = [];
  try {
    [result, offices] = await Promise.all([
      listVisitors(user, query),
      admin ? listOfficeOptions({ includeInactive: true }) : Promise.resolve([]),
    ]);
  } catch (error) {
    return renderPageError(error);
  }

  const officeFilter = admin && query.officeId && query.officeId !== "all" ? query.officeId : undefined;
  const activeParams: Record<string, string | undefined> = {
    q: query.q,
    name: query.name,
    purpose: query.purpose,
    date: query.date,
    from: query.from,
    to: query.to,
    importance: query.importance,
    officeId: officeFilter,
    pageSize: query.pageSize === DEFAULT_PAGE_SIZE ? undefined : String(query.pageSize),
  };
  const hasFilters = Object.entries(activeParams).some(([key, value]) => key !== "pageSize" && Boolean(value));
  const filterValues = {
    q: query.q,
    name: query.name,
    purpose: query.purpose,
    date: query.date,
    from: query.from,
    to: query.to,
    importance: query.importance,
    officeId: admin ? (officeFilter ?? "all") : undefined,
  };

  return (
    <>
      <PageHeader
        title="Visitors"
        description={
          admin
            ? "Visitor records across all offices."
            : `Visitor records for ${user.officeName ?? "your office"}.`
        }
        actions={
          <Button asChild>
            <Link href="/visitors/new">
              <PlusIcon data-icon="inline-start" aria-hidden="true" />
              Add visitor
            </Link>
          </Button>
        }
      />

      <DailyUpdatesViewTabs
        view="visitors"
        filters={{ date: query.date, from: query.from, to: query.to, officeId: officeFilter, q: query.q }}
      />

      <VisitorFilters key={JSON.stringify(filterValues)} values={filterValues} offices={admin ? offices : undefined} />

      {notices.length > 0 ? (
        <Alert>
          <AlertDescription>
            {notices.map((notice) => (
              <p key={notice}>{notice}</p>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}

      {result.items.length === 0 ? (
        <EmptyState
          icon={UserCheckIcon}
          title="No visitors found."
          description={
            hasFilters || result.page > 1
              ? "Try changing or resetting the filters."
              : "Visitors you record will appear here."
          }
          action={
            hasFilters || result.page > 1 ? (
              <Button asChild variant="outline">
                <Link href="/visitors">Reset filters</Link>
              </Button>
            ) : (
              <Button asChild>
                <Link href="/visitors/new">
                  <PlusIcon data-icon="inline-start" aria-hidden="true" />
                  Add visitor
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <div className="space-y-4">
          <VisitorTable visitors={result.items} showOffice={admin} />
          <PaginationNav
            page={result.page}
            totalPages={result.totalPages}
            total={result.total}
            pageSize={result.pageSize}
            pathname="/visitors"
            params={activeParams}
          />
        </div>
      )}
    </>
  );
}

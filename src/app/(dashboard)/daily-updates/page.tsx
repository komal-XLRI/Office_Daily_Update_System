import { ClipboardListIcon, ListChecksIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { DailyRecordsTable } from "@/components/daily-updates/daily-records-table";
import { DailyUpdateFilters } from "@/components/daily-updates/daily-update-filters";
import { MilestonesTable } from "@/components/daily-updates/milestones-table";
import { DailyUpdatesViewTabs } from "@/components/daily-updates/view-tabs";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PaginationNav } from "@/components/shared/pagination-nav";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants";
import { ValidationError } from "@/lib/errors";
import { renderPageError } from "@/lib/page-errors";
import { isAdmin, requirePageUser } from "@/lib/permissions";
import { listDailyMilestones, listMilestones, type MilestoneListItem } from "@/lib/services/daily-milestones";
import { listOfficeOptions } from "@/lib/services/office-options";
import { formatBusinessDate } from "@/lib/utils/dates";
import { buildHref, normalizeSearchParams, type RawSearchParams } from "@/lib/utils/search-params";
import {
  dailyMilestoneListQuerySchema,
  type DailyMilestoneListQuery,
} from "@/lib/validation/daily-milestone";
import type { DailyMilestoneDTO, OfficeOption, Paginated } from "@/types";

export const metadata: Metadata = {
  title: "Daily Updates",
};

/** Parse list filters; invalid params are dropped individually instead of failing the page. */
function parseListQuery(params: Record<string, string>): {
  query: DailyMilestoneListQuery;
  ignored: boolean;
} {
  const result = dailyMilestoneListQuerySchema.safeParse(params);
  if (result.success) return { query: result.data, ignored: false };

  const invalidKeys = new Set(result.error.issues.map((issue) => String(issue.path[0] ?? "")));
  const cleaned = Object.fromEntries(Object.entries(params).filter(([key]) => !invalidKeys.has(key)));
  const retry = dailyMilestoneListQuerySchema.safeParse(cleaned);
  return { query: retry.success ? retry.data : dailyMilestoneListQuerySchema.parse({}), ignored: true };
}

export default async function DailyUpdatesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await requirePageUser();
  const admin = isAdmin(user);
  const { query, ignored } = parseListQuery(normalizeSearchParams(await searchParams));
  const view = query.view === "milestones" ? "milestones" : "records";

  let offices: OfficeOption[] | undefined;
  let records: Paginated<DailyMilestoneDTO> | null = null;
  let milestones: Paginated<MilestoneListItem> | null = null;
  let filterError: string | null = null;

  try {
    if (admin) offices = await listOfficeOptions({ includeInactive: true });
    if (view === "milestones") milestones = await listMilestones(user, query);
    else records = await listDailyMilestones(user, query);
  } catch (error) {
    if (!(error instanceof ValidationError)) return renderPageError(error);
    filterError = error.message;
  }

  const filters = {
    date: query.date,
    from: query.from,
    to: query.to,
    officeId: admin ? query.officeId : undefined,
    q: query.q,
  };
  const hasFilters = Boolean(
    filters.date ||
    filters.from ||
    filters.to ||
    filters.q ||
    (admin && filters.officeId && filters.officeId !== "all"),
  );
  const selectedOfficeId =
    admin && filters.officeId && filters.officeId !== "all" ? filters.officeId : undefined;
  const paginationParams = {
    ...filters,
    view: view === "milestones" ? "milestones" : undefined,
    pageSize: query.pageSize === DEFAULT_PAGE_SIZE ? undefined : String(query.pageSize),
  };
  const addHref = buildHref("/daily-updates/new", { officeId: selectedOfficeId });

  return (
    <>
      <PageHeader
        title="Daily Updates"
        description={
          admin
            ? "Daily records and milestones for all offices."
            : `Daily records and milestones for ${user.officeName ?? "your office"}.`
        }
        actions={
          <Button asChild>
            <Link href={addHref}>
              <PlusIcon data-icon="inline-start" aria-hidden="true" />
              Add daily update
            </Link>
          </Button>
        }
      />

      <DailyUpdatesViewTabs view={view} filters={filters} />

      <DailyUpdateFilters view={view} values={filters} offices={offices} />

      {ignored ? (
        <Alert>
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>Some filters were invalid and have been ignored.</AlertTitle>
        </Alert>
      ) : null}

      {filterError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>{filterError}</AlertTitle>
          <AlertDescription>Adjust the date range and apply the filters again.</AlertDescription>
        </Alert>
      ) : null}

      {records ? (
        records.total === 0 ? (
          query.date ? (
            <EmptyState
              icon={ClipboardListIcon}
              title="No daily update has been recorded for this date."
              description={formatBusinessDate(query.date, "long")}
              action={
                <Button asChild variant="outline">
                  <Link
                    href={buildHref("/daily-updates/new", { date: query.date, officeId: selectedOfficeId })}
                  >
                    <PlusIcon data-icon="inline-start" aria-hidden="true" />
                    Add daily update
                  </Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={ClipboardListIcon}
              title="No daily updates found."
              description={
                hasFilters
                  ? "Try changing or resetting the filters."
                  : "Daily updates will appear here once they are recorded."
              }
            />
          )
        ) : (
          <>
            <DailyRecordsTable records={records.items} showOffice={admin} />
            <PaginationNav
              page={records.page}
              totalPages={records.totalPages}
              total={records.total}
              pageSize={records.pageSize}
              pathname="/daily-updates"
              params={paginationParams}
            />
          </>
        )
      ) : null}

      {milestones ? (
        milestones.total === 0 ? (
          <EmptyState
            icon={ListChecksIcon}
            title="No milestones have been added yet."
            description={hasFilters ? "No milestones match the selected filters." : undefined}
          />
        ) : (
          <>
            <MilestonesTable milestones={milestones.items} showOffice={admin} />
            <PaginationNav
              page={milestones.page}
              totalPages={milestones.totalPages}
              total={milestones.total}
              pageSize={milestones.pageSize}
              pathname="/daily-updates"
              params={paginationParams}
            />
          </>
        )
      ) : null}
    </>
  );
}

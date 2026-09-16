import { Building2Icon, PencilIcon, PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { OfficeStatusToggle } from "@/components/offices/office-status-toggle";
import { AccessDenied } from "@/components/shared/access-denied";
import { StatusBadge } from "@/components/shared/badges";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PaginationNav } from "@/components/shared/pagination-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { renderPageError } from "@/lib/page-errors";
import { isAdmin, requirePageUser } from "@/lib/permissions";
import { listOffices, type OfficeListItem } from "@/lib/services/offices";
import { formatDateTime } from "@/lib/utils/dates";
import { normalizeSearchParams, type RawSearchParams } from "@/lib/utils/search-params";
import { officeListQuerySchema, type OfficeListQuery } from "@/lib/validation/office";
import type { Paginated } from "@/types";

export const metadata: Metadata = { title: "Offices" };

const ALL_STATUSES = "all";

/** Invalid filters fall back to the defaults instead of failing the page. */
function parseListQuery(params: Record<string, string>): OfficeListQuery {
  const candidate = { ...params, status: params.status === ALL_STATUSES ? undefined : params.status };
  const parsed = officeListQuerySchema.safeParse(candidate);
  return parsed.success ? parsed.data : officeListQuerySchema.parse({});
}

export default async function OfficesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await requirePageUser();
  if (!isAdmin(user)) return <AccessDenied message="Administrator access is required." />;

  const query = parseListQuery(normalizeSearchParams(await searchParams));

  let result: Paginated<OfficeListItem>;
  try {
    result = await listOffices(user, query);
  } catch (error) {
    return renderPageError(error);
  }

  const filters = { q: query.q, status: query.status };
  const hasFilters = Boolean(query.q || query.status);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Offices"
        description="Manage offices, their codes and whether they are active."
        actions={
          <Button asChild>
            <Link href="/offices/new">
              <PlusIcon data-icon="inline-start" aria-hidden="true" />
              Add office
            </Link>
          </Button>
        }
      />

      <Card>
        <CardContent>
          <form
            key={`${query.q ?? ""}|${query.status ?? ""}`}
            method="get"
            action="/offices"
            role="search"
            aria-label="Filter offices"
            className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="office-search">Search</Label>
              <Input
                id="office-search"
                name="q"
                type="search"
                defaultValue={query.q ?? ""}
                maxLength={100}
                placeholder="Office name or code"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="office-status">Status</Label>
              <Select name="status" defaultValue={query.status ?? ALL_STATUSES}>
                <SelectTrigger id="office-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_STATUSES}>All</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button type="submit">Apply</Button>
              <Button asChild variant="outline">
                <Link href="/offices">Reset</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {result.items.length === 0 ? (
        <EmptyState
          icon={Building2Icon}
          title="No offices found."
          description={
            hasFilters ? "Try a different search or status filter." : "Add an office to get started."
          }
          action={
            hasFilters ? (
              <Button asChild variant="outline">
                <Link href="/offices">Reset filters</Link>
              </Button>
            ) : (
              <Button asChild>
                <Link href="/offices/new">
                  <PlusIcon data-icon="inline-start" aria-hidden="true" />
                  Add office
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <div className="bg-card overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">Office Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Active users</TableHead>
                <TableHead>Last updated</TableHead>
                <TableHead className="px-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((office) => (
                <TableRow key={office.id}>
                  <TableCell className="px-4 font-medium">{office.name}</TableCell>
                  <TableCell className="font-mono text-xs">{office.code}</TableCell>
                  <TableCell>
                    <StatusBadge isActive={office.isActive} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{office.activeUserCount}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(office.updatedAt)}</TableCell>
                  <TableCell className="px-4">
                    <div className="flex items-center justify-end gap-2">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/offices/${office.id}/edit`} aria-label={`Edit ${office.name}`}>
                          <PencilIcon data-icon="inline-start" aria-hidden="true" />
                          Edit
                        </Link>
                      </Button>
                      <OfficeStatusToggle office={office} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <PaginationNav
        page={result.page}
        totalPages={result.totalPages}
        total={result.total}
        pageSize={result.pageSize}
        pathname="/offices"
        params={filters}
      />
    </div>
  );
}

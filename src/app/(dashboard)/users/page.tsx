import { PlusIcon, UsersIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AccessDenied } from "@/components/shared/access-denied";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PaginationNav } from "@/components/shared/pagination-nav";
import { Button } from "@/components/ui/button";
import { UserFilters, type UserFilterValues } from "@/components/users/user-filters";
import { UsersTable } from "@/components/users/users-table";
import { DEFAULT_PAGE_SIZE } from "@/lib/constants";
import { renderPageError } from "@/lib/page-errors";
import { isAdmin, requirePageUser } from "@/lib/permissions";
import { listOfficeOptions } from "@/lib/services/office-options";
import { listUsers } from "@/lib/services/users";
import { normalizeSearchParams, type RawSearchParams } from "@/lib/utils/search-params";
import { userListQuerySchema } from "@/lib/validation/user";
import type { OfficeOption, Paginated, UserDTO } from "@/types";

export const metadata: Metadata = {
  title: "Users",
};

/** "all" in a filter select means no filter. */
function filterValue(value: string | undefined): string | undefined {
  return value === "all" ? undefined : value;
}

export default async function UsersPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const currentUser = await requirePageUser();
  if (!isAdmin(currentUser)) return <AccessDenied message="Administrator access is required to manage users." />;

  const params = normalizeSearchParams(await searchParams);
  const parsed = userListQuerySchema.safeParse({
    q: params.q,
    role: filterValue(params.role),
    officeId: filterValue(params.officeId),
    status: filterValue(params.status),
    page: params.page,
    pageSize: params.pageSize,
  });
  const query = parsed.success ? parsed.data : userListQuerySchema.parse({});

  let result: Paginated<UserDTO>;
  let offices: OfficeOption[];
  try {
    [result, offices] = await Promise.all([
      listUsers(currentUser, query),
      listOfficeOptions({ includeInactive: true }),
    ]);
  } catch (error) {
    return renderPageError(error);
  }

  const filters: UserFilterValues = {
    q: query.q,
    role: query.role,
    officeId: query.officeId,
    status: query.status,
  };
  const hasFilters = Object.values(filters).some(Boolean);
  const inactiveOfficeIds = offices.filter((office) => !office.isActive).map((office) => office.id);

  return (
    <>
      <PageHeader
        title="Users"
        description="Manage user accounts, roles, designations and office assignments."
        actions={
          <Button asChild>
            <Link href="/users/new">
              <PlusIcon data-icon="inline-start" aria-hidden="true" />
              Add user
            </Link>
          </Button>
        }
      />

      <UserFilters key={JSON.stringify(filters)} offices={offices} values={filters} />

      {result.items.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title="No users found."
          description={
            hasFilters || result.page > 1
              ? "Try changing or resetting the filters."
              : "Add a user to give them access to the system."
          }
          action={
            hasFilters || result.page > 1 ? (
              <Button asChild variant="outline">
                <Link href="/users">Reset filters</Link>
              </Button>
            ) : (
              <Button asChild>
                <Link href="/users/new">
                  <PlusIcon data-icon="inline-start" aria-hidden="true" />
                  Add user
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <UsersTable users={result.items} currentUserId={currentUser.id} inactiveOfficeIds={inactiveOfficeIds} />
          <PaginationNav
            page={result.page}
            totalPages={result.totalPages}
            total={result.total}
            pageSize={result.pageSize}
            pathname="/users"
            params={{
              ...filters,
              pageSize: result.pageSize === DEFAULT_PAGE_SIZE ? undefined : String(result.pageSize),
            }}
          />
        </div>
      )}
    </>
  );
}

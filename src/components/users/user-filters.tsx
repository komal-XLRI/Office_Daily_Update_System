import Link from "next/link";

import { OfficeSelect } from "@/components/shared/office-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { OfficeOption, Role } from "@/types";

/** Filter value meaning "no filter" (same as ALL_OFFICES_VALUE; client-module constants are not plain values in Server Components). */
const ALL_VALUE = "all";

export interface UserFilterValues {
  q?: string;
  role?: Role;
  officeId?: string;
  status?: "active" | "inactive";
}

interface UserFiltersProps {
  offices: OfficeOption[];
  values: UserFilterValues;
}

/**
 * Native GET filter form for /users. Render it with a `key` derived from `values` so the uncontrolled
 * selects reset when the URL changes (e.g. after Reset).
 */
export function UserFilters({ offices, values }: UserFiltersProps) {
  return (
    <form
      method="get"
      action="/users"
      role="search"
      aria-label="Filter users"
      className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)_auto] lg:items-end"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="user-filter-q">Search</Label>
        <Input
          id="user-filter-q"
          name="q"
          type="search"
          defaultValue={values.q ?? ""}
          placeholder="Name or email"
          maxLength={100}
          autoComplete="off"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="user-filter-role">Role</Label>
        <Select name="role" defaultValue={values.role ?? ALL_VALUE}>
          <SelectTrigger id="user-filter-role" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>All</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="user">User</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="user-filter-office">Office</Label>
        <OfficeSelect
          id="user-filter-office"
          name="officeId"
          offices={offices}
          includeAll
          defaultValue={values.officeId ?? ALL_VALUE}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="user-filter-status">Status</Label>
        <Select name="status" defaultValue={values.status ?? ALL_VALUE}>
          <SelectTrigger id="user-filter-status" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
        <Button type="submit" className="flex-1 lg:flex-none">
          Apply
        </Button>
        <Button asChild variant="outline" className="flex-1 lg:flex-none">
          <Link href="/users">Reset</Link>
        </Button>
      </div>
    </form>
  );
}

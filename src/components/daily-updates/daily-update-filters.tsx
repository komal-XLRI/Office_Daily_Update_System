import { SearchIcon } from "lucide-react";
import Link from "next/link";

import { ALL_OFFICES_VALUE, OfficeSelect } from "@/components/shared/office-select";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { OfficeOption } from "@/types";

import type { DailyUpdatesView } from "./view-tabs";

export interface DailyUpdateFilterValues {
  date?: string;
  from?: string;
  to?: string;
  officeId?: string;
  q?: string;
}

interface DailyUpdateFiltersProps {
  view: DailyUpdatesView;
  values: DailyUpdateFilterValues;
  /** Admins only; omit to hide the office filter (normal users are always scoped to their office). */
  offices?: OfficeOption[];
}

/** Native GET filter form for /daily-updates (Date, From, To, Office, Keyword). */
export function DailyUpdateFilters({ view, values, offices }: DailyUpdateFiltersProps) {
  const resetHref = view === "milestones" ? "/daily-updates?view=milestones" : "/daily-updates";
  const keywordPlaceholder =
    view === "milestones" ? "Milestone title, description or remarks" : "Update or milestone text";

  return (
    <form
      // Remount when the filters change so uncontrolled inputs pick up the new defaults after navigation.
      key={JSON.stringify(values)}
      method="get"
      action="/daily-updates"
      role="search"
      aria-label="Filter daily updates"
      className="bg-card ring-foreground/10 flex flex-col gap-4 rounded-xl p-4 ring-1"
    >
      {view === "milestones" ? <input type="hidden" name="view" value="milestones" /> : null}
      <div
        className={
          offices ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-5" : "grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        }
      >
        <Field>
          <FieldLabel htmlFor="filter-date">Date</FieldLabel>
          <Input id="filter-date" name="date" type="date" defaultValue={values.date ?? ""} />
        </Field>
        <Field>
          <FieldLabel htmlFor="filter-from">From</FieldLabel>
          <Input id="filter-from" name="from" type="date" defaultValue={values.from ?? ""} />
        </Field>
        <Field>
          <FieldLabel htmlFor="filter-to">To</FieldLabel>
          <Input id="filter-to" name="to" type="date" defaultValue={values.to ?? ""} />
        </Field>
        {offices ? (
          <Field>
            <FieldLabel htmlFor="filter-office">Office</FieldLabel>
            <OfficeSelect
              id="filter-office"
              name="officeId"
              offices={offices}
              includeAll
              defaultValue={values.officeId ?? ALL_OFFICES_VALUE}
            />
          </Field>
        ) : null}
        <Field>
          <FieldLabel htmlFor="filter-q">Keyword</FieldLabel>
          <Input
            id="filter-q"
            name="q"
            type="search"
            maxLength={100}
            placeholder={keywordPlaceholder}
            defaultValue={values.q ?? ""}
          />
        </Field>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-xs">
          A single Date takes precedence over the From–To range.
        </p>
        <div className="flex gap-2">
          <Button asChild variant="outline" className="flex-1 sm:flex-none">
            <Link href={resetHref}>Reset</Link>
          </Button>
          <Button type="submit" className="flex-1 sm:flex-none">
            <SearchIcon data-icon="inline-start" aria-hidden="true" />
            Apply
          </Button>
        </div>
      </div>
    </form>
  );
}

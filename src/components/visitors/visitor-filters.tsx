import Form from "next/form";
import Link from "next/link";

import { IMPORTANCE_LABELS } from "@/components/shared/badges";
import { ALL_OFFICES_VALUE, OfficeSelect } from "@/components/shared/office-select";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { IMPORTANCE_LEVELS } from "@/lib/constants";
import type { OfficeOption } from "@/types";

/** Value of the "All" importance option; list pages drop it before validating the query. */
export const ALL_IMPORTANCE_VALUE = "all";

export interface VisitorFilterValues {
  q?: string;
  name?: string;
  purpose?: string;
  date?: string;
  from?: string;
  to?: string;
  importance?: string;
  officeId?: string;
}

interface VisitorFiltersProps {
  values: VisitorFilterValues;
  /** Admins only: renders the Office filter. */
  offices?: OfficeOption[];
}

/**
 * GET filter form for /visitors. Uncontrolled inputs: give the component a `key` derived from the
 * current filters so it remounts (and resets) when the URL changes.
 */
export function VisitorFilters({ values, offices }: VisitorFiltersProps) {
  return (
    <Form action="/visitors" role="search" aria-label="Filter visitors" className="rounded-xl border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="visitor-filter-q">Search</FieldLabel>
          <Input
            id="visitor-filter-q"
            name="q"
            type="search"
            placeholder="Visitor name or purpose"
            maxLength={100}
            defaultValue={values.q ?? ""}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="visitor-filter-name">Name</FieldLabel>
          <Input id="visitor-filter-name" name="name" maxLength={100} defaultValue={values.name ?? ""} />
        </Field>
        <Field>
          <FieldLabel htmlFor="visitor-filter-purpose">Purpose</FieldLabel>
          <Input id="visitor-filter-purpose" name="purpose" maxLength={100} defaultValue={values.purpose ?? ""} />
        </Field>
        <Field>
          <FieldLabel htmlFor="visitor-filter-date">Date</FieldLabel>
          <Input id="visitor-filter-date" name="date" type="date" defaultValue={values.date ?? ""} />
        </Field>
        <Field>
          <FieldLabel htmlFor="visitor-filter-importance">Importance</FieldLabel>
          <Select name="importance" defaultValue={values.importance ?? ALL_IMPORTANCE_VALUE}>
            <SelectTrigger id="visitor-filter-importance" className="w-full">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_IMPORTANCE_VALUE}>All</SelectItem>
              {IMPORTANCE_LEVELS.map((level) => (
                <SelectItem key={level} value={level}>
                  {IMPORTANCE_LABELS[level]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="visitor-filter-from">From</FieldLabel>
          <Input id="visitor-filter-from" name="from" type="date" defaultValue={values.from ?? ""} />
        </Field>
        <Field>
          <FieldLabel htmlFor="visitor-filter-to">To</FieldLabel>
          <Input id="visitor-filter-to" name="to" type="date" defaultValue={values.to ?? ""} />
        </Field>
        {offices ? (
          <Field>
            <FieldLabel htmlFor="visitor-filter-office">Office</FieldLabel>
            <OfficeSelect
              id="visitor-filter-office"
              name="officeId"
              offices={offices}
              includeAll
              defaultValue={values.officeId ?? ALL_OFFICES_VALUE}
            />
          </Field>
        ) : null}
        <div className="flex items-end gap-2">
          <Button type="submit">Apply</Button>
          <Button asChild variant="outline">
            <Link href="/visitors">Reset</Link>
          </Button>
        </div>
      </div>
    </Form>
  );
}

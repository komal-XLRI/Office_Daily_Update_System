"use client";

import { FileTextIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { OfficeSelect } from "@/components/shared/office-select";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { formatBusinessDate, isValidBusinessDate, weekRange } from "@/lib/utils/dates";
import { buildHref } from "@/lib/utils/search-params";
import { MAX_REPORT_RANGE_DAYS, reportQuerySchema } from "@/lib/validation/report";
import type { OfficeOption } from "@/types";

import {
  ALL_OFFICES,
  isReportType,
  REPORT_TYPE_OPTIONS,
  toReportParams,
  type ReportFormValues,
} from "./report-query";

type FieldName = keyof ReportFormValues;
type FormErrors = Partial<Record<FieldName | "_form", string>>;

const FIELD_ORDER: FieldName[] = ["type", "date", "month", "from", "to", "officeId"];

const FIELD_IDS: Record<FieldName, string> = {
  type: "report-type",
  date: "report-date",
  month: "report-month",
  from: "report-from",
  to: "report-to",
  officeId: "report-office",
};

function isFieldName(value: unknown): value is FieldName {
  return typeof value === "string" && (FIELD_ORDER as string[]).includes(value);
}

function describedBy(...ids: (string | false | undefined)[]): string | undefined {
  const value = ids.filter(Boolean).join(" ");
  return value || undefined;
}

function weekDescription(date: string): string {
  if (!isValidBusinessDate(date)) return "The Monday to Sunday week containing this date is used.";
  const week = weekRange(date);
  return `Covers Monday, ${formatBusinessDate(week.from)} to Sunday, ${formatBusinessDate(week.to)}.`;
}

interface DateFieldProps {
  name: "date" | "month" | "from" | "to";
  label: string;
  type: "date" | "month";
  value: string;
  error?: string;
  description?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

function DateField({ name, label, type, value, error, description, disabled, onChange }: DateFieldProps) {
  const id = FIELD_IDS[name];
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        name={name}
        type={type}
        value={value}
        placeholder={type === "month" ? "YYYY-MM" : undefined}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(description && `${id}-description`, error && `${id}-error`)}
      />
      {description ? <FieldDescription id={`${id}-description`}>{description}</FieldDescription> : null}
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </Field>
  );
}

export interface ReportFormProps {
  initialValues: ReportFormValues;
  /** Admins choose one office or all offices. Normal users see their own office read-only and never send one. */
  canSelectOffice: boolean;
  /** Office options for admins (ignored for normal users). */
  offices: OfficeOption[];
  /** The signed-in user's office name, shown read-only to normal users. */
  officeName: string | null;
}

/** Report options. Validates with reportQuerySchema, then navigates to /reports?<query>. */
export function ReportForm({ initialValues, canSelectOffice, offices, officeName }: ReportFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<ReportFormValues>(initialValues);
  const [errors, setErrors] = useState<FormErrors>({});
  const [pending, startTransition] = useTransition();

  function setValue<K extends FieldName>(key: K, value: ReportFormValues[K]) {
    setValues((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => {
      const related: (FieldName | "_form")[] =
        key === "from" || key === "to" ? ["from", "to", "_form"] : [key, "_form"];
      if (!related.some((name) => previous[name])) return previous;
      const next = { ...previous };
      for (const name of related) delete next[name];
      return next;
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Only the fields the selected type uses; officeId only for admins.
    const candidate = toReportParams(
      { ...values, officeId: values.officeId || undefined },
      { includeOffice: canSelectOffice },
    );
    const result = reportQuerySchema.safeParse(candidate);

    if (!result.success) {
      const nextErrors: FormErrors = {};
      for (const issue of result.error.issues) {
        const key = isFieldName(issue.path[0]) ? issue.path[0] : "_form";
        nextErrors[key] ??= issue.message;
      }
      setErrors(nextErrors);
      const firstInvalid = FIELD_ORDER.find((name) => nextErrors[name]);
      if (firstInvalid) document.getElementById(FIELD_IDS[firstInvalid])?.focus();
      return;
    }

    setErrors({});
    const href = buildHref("/reports", toReportParams(result.data, { includeOffice: canSelectOffice }));
    startTransition(() => router.push(href));
  }

  const officeErrorId = `${FIELD_IDS.officeId}-error`;
  const typeErrorId = `${FIELD_IDS.type}-error`;

  return (
    <form onSubmit={handleSubmit} noValidate aria-label="Report options" className="space-y-5">
      {errors._form ? (
        <p role="alert" className="text-sm text-destructive">
          {errors._form}
        </p>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field data-invalid={errors.type ? true : undefined}>
          <FieldLabel htmlFor={FIELD_IDS.type}>Report Type</FieldLabel>
          <Select
            value={values.type}
            onValueChange={(value) => {
              if (isReportType(value)) setValue("type", value);
            }}
            disabled={pending}
          >
            <SelectTrigger
              id={FIELD_IDS.type}
              className="w-full"
              aria-invalid={errors.type ? true : undefined}
              aria-describedby={describedBy(errors.type && typeErrorId)}
            >
              <SelectValue placeholder="Select a report type" />
            </SelectTrigger>
            <SelectContent>
              {REPORT_TYPE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError id={typeErrorId}>{errors.type}</FieldError>
        </Field>

        {values.type === "daily" ? (
          <DateField
            name="date"
            label="Date"
            type="date"
            value={values.date}
            error={errors.date}
            disabled={pending}
            onChange={(value) => setValue("date", value)}
          />
        ) : null}

        {values.type === "weekly" ? (
          <DateField
            name="date"
            label="Any date in the week"
            type="date"
            value={values.date}
            error={errors.date}
            description={weekDescription(values.date)}
            disabled={pending}
            onChange={(value) => setValue("date", value)}
          />
        ) : null}

        {values.type === "monthly" ? (
          <DateField
            name="month"
            label="Month"
            type="month"
            value={values.month}
            error={errors.month}
            disabled={pending}
            onChange={(value) => setValue("month", value)}
          />
        ) : null}

        {values.type === "custom" ? (
          <>
            <DateField
              name="from"
              label="From Date"
              type="date"
              value={values.from}
              error={errors.from}
              disabled={pending}
              onChange={(value) => setValue("from", value)}
            />
            <DateField
              name="to"
              label="To Date"
              type="date"
              value={values.to}
              error={errors.to}
              description={`Up to ${MAX_REPORT_RANGE_DAYS} days, inclusive.`}
              disabled={pending}
              onChange={(value) => setValue("to", value)}
            />
          </>
        ) : null}

        {canSelectOffice ? (
          <Field data-invalid={errors.officeId ? true : undefined}>
            <FieldLabel htmlFor={FIELD_IDS.officeId}>Office</FieldLabel>
            <OfficeSelect
              id={FIELD_IDS.officeId}
              offices={offices}
              includeAll
              value={values.officeId || ALL_OFFICES}
              onValueChange={(value) => setValue("officeId", value)}
              disabled={pending}
              aria-invalid={errors.officeId ? true : undefined}
              aria-describedby={describedBy(errors.officeId && officeErrorId)}
            />
            <FieldError id={officeErrorId}>{errors.officeId}</FieldError>
          </Field>
        ) : (
          <Field>
            <FieldLabel htmlFor={FIELD_IDS.officeId}>Office</FieldLabel>
            <Input
              id={FIELD_IDS.officeId}
              value={officeName ?? "Your assigned office"}
              readOnly
              aria-describedby={`${FIELD_IDS.officeId}-description`}
              className="bg-muted/50"
            />
            <FieldDescription id={`${FIELD_IDS.officeId}-description`}>
              Reports are limited to your assigned office.
            </FieldDescription>
          </Field>
        )}
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <FileTextIcon data-icon="inline-start" aria-hidden="true" />
          )}
          {pending ? "Generating report..." : "Generate report"}
        </Button>
      </div>
    </form>
  );
}

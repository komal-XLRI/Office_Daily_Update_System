"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { OfficeOption } from "@/types";

export const ALL_OFFICES_VALUE = "all";

interface OfficeSelectProps {
  offices: OfficeOption[];
  /** Controlled value: an office id (or "all" when includeAll). Use "" for no selection. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Adds an "All Offices" option whose value is "all". */
  includeAll?: boolean;
  /** Field name, for submission inside a native GET filter <form>. */
  name?: string;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "aria-invalid"?: boolean;
  "aria-label"?: string;
  "aria-describedby"?: string;
}

/** Office picker for forms (controlled) and GET filter forms (uncontrolled with `name`). */
export function OfficeSelect({
  offices,
  includeAll = false,
  placeholder = "Select office",
  className,
  id,
  "aria-invalid": ariaInvalid,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  ...selectProps
}: OfficeSelectProps) {
  return (
    <Select {...selectProps}>
      <SelectTrigger
        id={id}
        className={cn("w-full", className)}
        aria-invalid={ariaInvalid}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {includeAll ? <SelectItem value={ALL_OFFICES_VALUE}>All Offices</SelectItem> : null}
        {offices.map((office) => (
          <SelectItem key={office.id} value={office.id}>
            {office.name}
            {office.isActive ? "" : " (inactive)"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

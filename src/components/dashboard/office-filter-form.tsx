import { OfficeSelect } from "@/components/shared/office-select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { OfficeOption, OfficeRef } from "@/types";

// Same value as ALL_OFFICES_VALUE; constants cannot be read from a client module inside a Server Component.
const ALL_OFFICES = "all";

interface DashboardOfficeFilterProps {
  /** Active offices in seed order (listOfficeOptions()). */
  offices: OfficeOption[];
  selectedOffice: OfficeRef | null;
}

/** Admin-only GET form that reloads /dashboard for one office or All Offices. */
export function DashboardOfficeFilter({ offices, selectedOffice }: DashboardOfficeFilterProps) {
  // An inactive office opened by URL is not in the active list; keep it selectable so the control shows it.
  const options =
    selectedOffice && !offices.some((office) => office.id === selectedOffice.id)
      ? [...offices, { ...selectedOffice, isActive: false }]
      : offices;

  return (
    <form
      method="get"
      action="/dashboard"
      aria-label="Dashboard office filter"
      className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center"
    >
      <Label htmlFor="dashboard-office" className="shrink-0">
        Office
      </Label>
      <OfficeSelect
        id="dashboard-office"
        name="officeId"
        includeAll
        offices={options}
        defaultValue={selectedOffice?.id ?? ALL_OFFICES}
        className="sm:w-56"
      />
      <Button type="submit" variant="outline">
        Apply
      </Button>
    </form>
  );
}

import { Spinner } from "@/components/ui/spinner";

export default function PrintReportLoading() {
  return (
    <div className="flex min-h-[50svh] items-center justify-center p-4" aria-busy="true">
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner aria-hidden="true" />
        Generating report...
      </p>
    </div>
  );
}

"use client";

import { ArrowLeftIcon, PrinterIcon } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

interface PrintToolbarProps {
  /** Where "Back to reports" goes (normally /reports with the same query). */
  backHref: string;
  /** Show the Print button (only when a report was generated). */
  canPrint?: boolean;
  /** Open the browser print dialog once after the page and its fonts have loaded. */
  autoPrint?: boolean;
}

/** Screen-only actions for the print view. Hidden when printing. */
export function PrintToolbar({ backHref, canPrint = false, autoPrint = false }: PrintToolbarProps) {
  useEffect(() => {
    if (!autoPrint) return;
    let cancelled = false;
    let timer: number | undefined;
    void document.fonts.ready.then(() => {
      if (cancelled) return;
      timer = window.setTimeout(() => window.print(), 300);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [autoPrint]);

  return (
    <div className="sticky top-0 z-10 border-b bg-background print:hidden">
      <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8">
        <p className="text-sm font-medium">Print view</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link href={backHref}>
              <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
              Back to reports
            </Link>
          </Button>
          {canPrint ? (
            <Button type="button" onClick={() => window.print()}>
              <PrinterIcon data-icon="inline-start" aria-hidden="true" />
              Print
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

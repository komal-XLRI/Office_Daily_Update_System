import type { ReactNode } from "react";

/**
 * Minimal layout for print views: no sidebar or app header, white page.
 * Pages in this group still call requirePageUser() themselves.
 */
export default function PrintLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main-content" className="min-h-svh bg-white text-neutral-950 print:min-h-0">
      <style href="print-page-margins" precedence="default">
        {"@page { margin: 14mm; }"}
      </style>
      {children}
    </main>
  );
}

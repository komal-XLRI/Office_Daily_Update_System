import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main-content" className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      {children}
    </main>
  );
}

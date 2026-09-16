"use client";

import "./globals.css";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-svh items-center justify-center p-4 font-sans">
        <main className="max-w-md space-y-3 text-center">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            The application could not be loaded. Please try again.
            {error.digest ? <span className="mt-1 block text-xs">Reference: {error.digest}</span> : null}
          </p>
          <button
            type="button"
            onClick={() => retry()}
            className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}

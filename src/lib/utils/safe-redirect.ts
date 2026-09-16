const BASE = "http://internal.invalid";

/**
 * Only allow same-origin relative paths as post-login redirect targets (prevents open redirects).
 */
export function safeRedirectPath(value: string | null | undefined, fallback = "/dashboard"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  try {
    const url = new URL(value, BASE);
    if (url.origin !== BASE) return fallback;
    // Dot segments are normalised by URL(), so "/.//evil.example" becomes the protocol-relative "//evil.example".
    if (url.pathname.startsWith("//")) return fallback;
    if (url.pathname === "/login" || url.pathname.startsWith("/api/")) return fallback;
    return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
}

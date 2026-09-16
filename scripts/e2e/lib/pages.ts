import type { HttpResponse } from "./http";

/**
 * HTML inspection for server-rendered App Router pages. Server errors during streaming do not always
 * change the status code, so besides the status we look for the error boundary text, error digests in the
 * HTML / RSC payload, the not-found page and <AccessDenied />.
 */

export interface PageInspection {
  status: number;
  location: string | null;
  metaRefreshUrl: string | null;
  accessDenied: boolean;
  notFound: boolean;
  errorBoundary: boolean;
  /** Digests of server errors (not Next's internal redirect / not-found control-flow digests). */
  errorDigests: string[];
}

const ERROR_BOUNDARY_TEXT = ["Something went wrong", "This page could not be loaded", "Application error"];
const NOT_FOUND_TEXT = "The page or record you are looking for does not exist";

export function inspectPage(response: HttpResponse): PageInspection {
  const html = response.text;
  const digests = new Set<string>();
  for (const match of html.matchAll(/data-dgst="([^"]+)"/g)) digests.add(match[1]);
  for (const match of html.matchAll(/\\*"digest\\*":\s*\\*"([^"\\]+)/g)) digests.add(match[1]);
  const digestList = [...digests];

  const refresh = /<meta[^>]*http-equiv="refresh"[^>]*content="\d+;\s*url=([^"]+)"/i.exec(html);

  return {
    status: response.status,
    location: response.location,
    metaRefreshUrl: refresh ? refresh[1].replace(/&amp;/g, "&") : null,
    accessDenied: html.includes("Access denied"),
    notFound:
      response.status === 404 ||
      html.includes(NOT_FOUND_TEXT) ||
      digestList.some((digest) => digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")),
    errorBoundary: ERROR_BOUNDARY_TEXT.some((text) => html.includes(text)),
    errorDigests: digestList.filter((digest) => !digest.startsWith("NEXT_")),
  };
}

export function describeInspection(inspection: PageInspection): string {
  const flags = [
    `status ${inspection.status}`,
    inspection.location ? `Location ${inspection.location}` : "",
    inspection.metaRefreshUrl ? `meta-refresh ${inspection.metaRefreshUrl}` : "",
    inspection.accessDenied ? "Access denied" : "",
    inspection.notFound ? "not-found" : "",
    inspection.errorBoundary ? "ERROR BOUNDARY" : "",
    inspection.errorDigests.length ? `error digests ${inspection.errorDigests.join(",")}` : "",
  ].filter(Boolean);
  return flags.join(", ");
}

/** Where a 3xx or meta-refresh redirect points, as a URL relative to `base`. */
export function redirectTarget(inspection: PageInspection, base: string): URL | null {
  const target = inspection.location ?? inspection.metaRefreshUrl;
  return target ? new URL(target, base) : null;
}

/** The sanitized `nextPath` prop the login page passes to <LoginForm /> (read from the RSC payload). */
export function loginNextPath(html: string): string | null {
  const match = /\\*"nextPath\\*":\s*\\*"([^"\\]*)/.exec(html);
  return match ? match[1] : null;
}

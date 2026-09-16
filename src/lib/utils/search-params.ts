/** Shape of `await props.searchParams` in App Router pages. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/** Keep the first value of each param and drop missing ones. */
export function normalizeSearchParams(params: RawSearchParams): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string") result[key] = first;
  }
  return result;
}

/** URLSearchParams → plain object (first value wins). */
export function searchParamsToObject(params: URLSearchParams): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    if (!(key in result)) result[key] = value;
  }
  return result;
}

/** Build "/path?x=1" omitting null/undefined/empty values. */
export function buildHref(
  pathname: string,
  params: Record<string, string | number | null | undefined> = {},
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}

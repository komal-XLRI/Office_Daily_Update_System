export const UNKNOWN_CLIENT_IP = "unknown";

const IPV4_WITH_PORT_RE = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/;
const BRACKETED_IPV6_RE = /^\[([0-9a-f:.]+)\](?::\d{1,5})?$/i;
const IP_RE = /^[0-9a-f:.]{2,45}$/i;

function normalizeIp(value: string | null | undefined): string | null {
  if (!value) return null;
  let candidate = value.trim();
  const v4 = IPV4_WITH_PORT_RE.exec(candidate);
  if (v4) candidate = v4[1];
  const v6 = BRACKETED_IPV6_RE.exec(candidate);
  if (v6) candidate = v6[1];
  return IP_RE.test(candidate) ? candidate.toLowerCase() : null;
}

/**
 * Best-effort client IP for rate limiting: the first `x-forwarded-for` entry, then `x-real-ip`,
 * else "unknown". These headers are set by the hosting proxy; without one they can be spoofed,
 * so never use the result for authorization.
 */
export function getClientIp(request: Pick<Request, "headers">): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded ? forwarded.split(",")[0] : null;
  return normalizeIp(first) ?? normalizeIp(request.headers.get("x-real-ip")) ?? UNKNOWN_CLIENT_IP;
}

import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session-token";

/**
 * Optimistic route protection only: send visitors without a valid session token to /login.
 * Real authorization (active user, role, office scope) happens server-side in pages, services and APIs.
 * API routes are excluded here and return 401 JSON themselves.
 */
export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionToken(token);
  if (session) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  if (pathname !== "/" && pathname !== "/dashboard") {
    loginUrl.searchParams.set("next", `${pathname}${search}`);
  }

  const response = NextResponse.redirect(loginUrl);
  if (token) response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}

export const config = {
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|login|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)",
  ],
};

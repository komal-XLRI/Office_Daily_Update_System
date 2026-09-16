import type { NextRequest } from "next/server";

import { jsonOk, parseJsonBody, parseQuery, withApi } from "@/lib/api/handler";
import { requireAuth } from "@/lib/permissions";
import { createVisitor, listVisitors } from "@/lib/services/visitors";
import { visitorInputSchema, visitorListQuerySchema } from "@/lib/validation/visitor";

/** GET /api/visitors — paginated, filtered list scoped to the caller's office (admins: all offices). */
export const GET = withApi(async (request: NextRequest) => {
  const user = await requireAuth();
  const query = parseQuery(request, visitorListQuerySchema);
  const result = await listVisitors(user, query);
  return jsonOk(result);
});

/** POST /api/visitors — create a visitor (normal users: own office; admins: officeId required). */
export const POST = withApi(async (request: NextRequest) => {
  const user = await requireAuth();
  const input = await parseJsonBody(request, visitorInputSchema);
  const visitor = await createVisitor(user, input);
  return jsonOk(visitor, { status: 201 });
});

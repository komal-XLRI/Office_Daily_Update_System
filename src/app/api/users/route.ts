import { jsonOk, parseJsonBody, withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/permissions";
import { createUser, listUsers } from "@/lib/services/users";
import { searchParamsToObject } from "@/lib/utils/search-params";
import { userInputSchema } from "@/lib/validation/user";

/**
 * GET /api/users?q=&role=admin|user&officeId=&status=active|inactive&page=&pageSize= — admin only.
 * The service validates the query with userListQuerySchema ("all" in a filter means no filter).
 */
export const GET = withApi(async (request) => {
  const user = await requireAdmin();
  const result = await listUsers(user, searchParamsToObject(request.nextUrl.searchParams));
  return jsonOk(result);
});

/** POST /api/users { name, email, role, designation, officeId, isActive } — admin only. */
export const POST = withApi(async (request) => {
  const user = await requireAdmin();
  const input = await parseJsonBody(request, userInputSchema);
  const created = await createUser(user, input);
  return jsonOk(created, { status: 201 });
});

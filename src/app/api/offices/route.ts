import { jsonOk, parseJsonBody, parseQuery, withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/permissions";
import { createOffice, listOffices } from "@/lib/services/offices";
import { officeInputSchema, officeListQuerySchema } from "@/lib/validation/office";

/** GET /api/offices?q=&status=active|inactive&page=&pageSize= — admin only. */
export const GET = withApi(async (request) => {
  const user = await requireAdmin();
  const query = parseQuery(request, officeListQuerySchema);
  const result = await listOffices(user, query);
  return jsonOk(result);
});

/** POST /api/offices { name, code, isActive } — admin only. */
export const POST = withApi(async (request) => {
  const user = await requireAdmin();
  const input = await parseJsonBody(request, officeInputSchema);
  const office = await createOffice(user, input);
  return jsonOk(office, { status: 201 });
});

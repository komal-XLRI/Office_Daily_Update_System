import { jsonOk, withApi } from "@/lib/api/handler";
import { requireAuth } from "@/lib/permissions";

/** GET /api/auth/session — the signed-in user (fresh from the database), or 401. */
export const GET = withApi(async () => {
  const user = await requireAuth();
  return jsonOk({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    officeId: user.officeId,
    officeName: user.officeName,
  });
});

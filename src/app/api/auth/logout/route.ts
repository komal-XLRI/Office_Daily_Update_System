import { jsonOk, withApi } from "@/lib/api/handler";
import { deleteSession, getSession } from "@/lib/auth/session";
import { connectDB } from "@/lib/db/connect";
import { isObjectId } from "@/lib/validation/common";
import { User } from "@/models/User";

/**
 * POST /api/auth/logout — revoke the session and clear the cookie (safe to call when already signed out).
 * A valid session bumps users.sessionVersion so copies of the token stop working immediately.
 */
export const POST = withApi(async () => {
  const session = await getSession();
  if (session && isObjectId(session.userId)) {
    await connectDB();
    const version = session.sessionVersion ?? 0;
    // Only bump when the token is still current (a stale token cannot revoke newer sessions).
    await User.updateOne(
      {
        _id: session.userId,
        ...(version === 0
          ? { $or: [{ sessionVersion: 0 }, { sessionVersion: { $exists: false } }] }
          : { sessionVersion: version }),
      },
      { $inc: { sessionVersion: 1 } },
    );
  }
  await deleteSession();
  return jsonOk({ ok: true });
});

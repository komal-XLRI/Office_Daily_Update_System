import { jsonOk, parseJsonBody, withApi } from "@/lib/api/handler";
import { verifyOtp } from "@/lib/auth/otp";
import { checkIpRateLimit, envLimit } from "@/lib/auth/rate-limit";
import { createSession } from "@/lib/auth/session";
import { verifyOtpSchema } from "@/lib/validation/auth";

/** POST /api/auth/verify-otp — verify the code and start a session. */
export const POST = withApi(async (request) => {
  checkIpRateLimit(request, "auth:verify-otp", {
    limit: envLimit("AUTH_VERIFY_OTP_IP_LIMIT", 300),
    windowSeconds: 15 * 60,
  });

  const input = await parseJsonBody(request, verifyOtpSchema);
  const session = await verifyOtp({ email: input.email, otp: input.otp });
  await createSession(session);

  return jsonOk({ redirectTo: "/dashboard" });
});

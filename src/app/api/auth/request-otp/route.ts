import { jsonOk, parseJsonBody, withApi } from "@/lib/api/handler";
import { requestOtp } from "@/lib/auth/otp";
import { checkIpRateLimit, envLimit } from "@/lib/auth/rate-limit";
import { requestOtpSchema } from "@/lib/validation/auth";

/** POST /api/auth/request-otp — email a sign-in code. Never returns the code. */
export const POST = withApi(async (request) => {
  checkIpRateLimit(request, "auth:request-otp", {
    limit: envLimit("AUTH_REQUEST_OTP_IP_LIMIT", 100),
    windowSeconds: 15 * 60,
  });

  const { email } = await parseJsonBody(request, requestOtpSchema);
  const result = await requestOtp({ email });

  return jsonOk({
    message: "OTP sent to your email.",
    expiresInSeconds: result.expiresInSeconds,
    resendAvailableInSeconds: result.resendAvailableInSeconds,
  });
});

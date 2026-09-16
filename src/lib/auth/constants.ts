/** OTP policy (spec §10). Shared by the server OTP service and the login UI. */
export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
/** Per-email send limit within OTP_SEND_WINDOW_SECONDS. */
export const OTP_MAX_SENDS_PER_WINDOW = 5;
export const OTP_SEND_WINDOW_SECONDS = 60 * 60;

import "server-only";

import { createTransport, type Transporter } from "nodemailer";

import { OTP_TTL_SECONDS } from "@/lib/auth/constants";
import { APP_NAME } from "@/lib/constants";
import { getSmtpConfig, isProduction, type SmtpConfig } from "@/lib/env";
import { ServiceUnavailableError } from "@/lib/errors";

/**
 * OTP email delivery. The OTP code is passed in memory only: it is never logged, except for the single
 * clearly labelled development fallback line below (SMTP not configured and NODE_ENV !== "production").
 */

export interface OtpEmailMessage {
  to: string;
  name: string;
  otp: string;
}

export type OtpMailer = (message: OtpEmailMessage) => Promise<void>;

let testMailer: OtpMailer | null = null;

/**
 * Test seam: route OTP emails to `mailer` instead of SMTP (pass null to restore).
 * Refuses to run in production so a stray call can never divert real sign-in codes.
 */
export function setOtpMailerForTesting(mailer: OtpMailer | null): void {
  if (isProduction()) {
    throw new Error("setOtpMailerForTesting is not available in production.");
  }
  testMailer = mailer;
}

let cachedTransport: { key: string; transport: Transporter } | null = null;

function getTransport(config: SmtpConfig): Transporter {
  const key = [config.host, config.port, config.secure, config.user ?? ""].join("|");
  if (!cachedTransport || cachedTransport.key !== key) {
    cachedTransport?.transport.close();
    cachedTransport = {
      key,
      transport: createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.user ? { user: config.user, pass: config.password ?? "" } : undefined,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      }),
    };
  }
  return cachedTransport.transport;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildOtpEmail({ name, otp }: OtpEmailMessage) {
  const minutes = Math.round(OTP_TTL_SECONDS / 60);
  const expiry = `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const greetingName = name.trim() || "there";

  const subject = `Your sign-in code for ${APP_NAME}`;

  const text = [
    `Hello ${greetingName},`,
    "",
    `Your sign-in code is ${otp}. It expires in ${expiry}.`,
    "",
    "If you did not request this code, you can ignore this email.",
    "",
    APP_NAME,
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background-color:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;margin:0 auto;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:8px;">
      <tr>
        <td style="padding:24px;">
          <p style="margin:0 0 16px;font-size:14px;color:#52525b;">${escapeHtml(APP_NAME)}</p>
          <p style="margin:0 0 16px;font-size:16px;">Hello ${escapeHtml(greetingName)},</p>
          <p style="margin:0 0 12px;font-size:16px;">Your sign-in code is:</p>
          <p style="margin:0 0 16px;font-size:32px;font-weight:bold;letter-spacing:8px;font-family:'Courier New',Courier,monospace;">${escapeHtml(otp)}</p>
          <p style="margin:0 0 16px;font-size:14px;">It expires in ${expiry}.</p>
          <p style="margin:0;font-size:13px;color:#71717a;">If you did not request this code, you can ignore this email.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

/**
 * Email a sign-in code. Throws ServiceUnavailableError when SMTP is not configured in production;
 * SMTP transport errors propagate to the caller (the OTP service rolls back and reports a safe message).
 */
export async function sendOtpEmail(message: OtpEmailMessage): Promise<void> {
  if (testMailer) {
    await testMailer(message);
    return;
  }

  const config = getSmtpConfig();
  if (!config) {
    if (isProduction()) {
      throw new ServiceUnavailableError("Email service is not configured. Please contact the administrator.");
    }
    // Development-only fallback so local sign-in works without SMTP. Never reached in production.
    console.info(`[DEV ONLY - SMTP not configured] Sign-in OTP for ${message.to}: ${message.otp}`);
    return;
  }

  const { subject, text, html } = buildOtpEmail(message);
  await getTransport(config).sendMail({
    from: config.from,
    to: { name: message.name, address: message.to },
    subject,
    text,
    html,
  });
}

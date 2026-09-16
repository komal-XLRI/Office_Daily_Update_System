import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

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

/** Inline logo attachment: email clients cannot read local files, so it travels with the message. */
const LOGO_CID = "xlri-logo";
/** Retina-sized copy of the logo (264px wide) so every OTP email stays small. */
const LOGO_PATH = path.join(process.cwd(), "public", "xlri-logo-email.png");

let cachedLogo: Buffer | null | undefined;

/** Reads the logo once. Returns null (plain-text header) if it is missing or unreadable. */
async function readLogo(): Promise<Buffer | null> {
  if (cachedLogo === undefined) {
    try {
      cachedLogo = await readFile(LOGO_PATH);
    } catch {
      cachedLogo = null;
    }
  }
  return cachedLogo;
}

function buildOtpEmail({ name, otp }: OtpEmailMessage, withLogo: boolean) {
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

  // Table-based layout with inline styles: the only markup email clients render consistently.
  const header = withLogo
    ? `<img src="cid:${LOGO_CID}" width="132" height="57" alt="XLRI" style="display:block;border:0;outline:none;width:132px;height:57px;" />`
    : `<span style="font-size:18px;font-weight:bold;color:#18181b;">XLRI</span>`;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f4f5;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your sign-in code expires in ${expiry}.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f4f5;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:10px;">
            <tr>
              <td style="padding:24px 32px;border-bottom:1px solid #e4e4e7;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="vertical-align:middle;padding-right:14px;">${header}</td>
                    <td style="vertical-align:middle;border-left:1px solid #e4e4e7;padding-left:14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:16px;color:#52525b;">
                      ${escapeHtml(APP_NAME)}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
                <p style="margin:0 0 8px;font-size:16px;line-height:24px;">Hello ${escapeHtml(greetingName)},</p>
                <p style="margin:0 0 24px;font-size:14px;line-height:22px;color:#52525b;">Use the code below to sign in. Do not share it with anyone.</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f4f5;border:1px solid #e4e4e7;border-radius:8px;">
                  <tr>
                    <td align="center" style="padding:20px 16px;">
                      <div style="font-family:'Courier New',Courier,monospace;font-size:34px;font-weight:bold;letter-spacing:10px;line-height:40px;color:#18181b;">${escapeHtml(otp)}</div>
                      <div style="margin-top:8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#71717a;">Expires in ${expiry}</div>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0;font-size:13px;line-height:20px;color:#71717a;">If you did not request this code, you can safely ignore this email.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;border-top:1px solid #e4e4e7;background-color:#fafafa;border-radius:0 0 10px 10px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#71717a;">
                This is an automated message from ${escapeHtml(APP_NAME)}. Please do not reply.
              </td>
            </tr>
          </table>
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

  const logo = await readLogo();
  const { subject, text, html } = buildOtpEmail(message, logo !== null);
  await getTransport(config).sendMail({
    from: config.from,
    to: { name: message.name, address: message.to },
    subject,
    text,
    html,
    attachments: logo
      ? [{ filename: "xlri-logo.png", content: logo, cid: LOGO_CID, contentDisposition: "inline" }]
      : undefined,
  });
}

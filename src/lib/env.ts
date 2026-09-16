import { z } from "zod";

import { ConfigurationError } from "@/lib/errors";

/**
 * Server-side environment access. Values are parsed lazily so that `next build` and pages that do not
 * need a given integration keep working when it is not configured. Never import this from client code.
 */

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalTrimmed = z.preprocess(blankToUndefined, z.string().trim().optional());
const optionalSecret = z.preprocess(blankToUndefined, z.string().optional());

const serverEnvSchema = z.object({
  NODE_ENV: z.preprocess(
    blankToUndefined,
    z.enum(["development", "test", "production"]).default("development"),
  ),
  MONGODB_URI: optionalSecret,
  AUTH_SECRET: optionalSecret,
  SMTP_HOST: optionalTrimmed,
  SMTP_PORT: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(65535).default(587)),
  SMTP_USER: optionalTrimmed,
  SMTP_PASSWORD: optionalSecret,
  OTP_EMAIL_FROM: optionalTrimmed,
  CLOUDINARY_CLOUD_NAME: optionalTrimmed,
  CLOUDINARY_API_KEY: optionalTrimmed,
  CLOUDINARY_API_SECRET: optionalSecret,
  CLOUDINARY_UPLOAD_FOLDER: optionalTrimmed,
  MAX_FILE_SIZE_MB: z.preprocess(blankToUndefined, z.coerce.number().positive().max(100).default(10)),
  MASTER_OTP: optionalSecret,
  MASTER_OTP_ALLOW_IN_PRODUCTION: optionalTrimmed,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedEnv: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (!cachedEnv) {
    const result = serverEnvSchema.safeParse(process.env);
    if (!result.success) {
      const keys = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))].join(", ");
      throw new ConfigurationError(`Invalid environment variables: ${keys}`);
    }
    cachedEnv = result.data;
  }
  return cachedEnv;
}

/** Test helper: re-read process.env on next access. */
export function resetServerEnvCache(): void {
  cachedEnv = null;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function getMongoUri(): string {
  const uri = getServerEnv().MONGODB_URI;
  if (!uri) throw new ConfigurationError("MONGODB_URI is not configured.");
  return uri;
}

export const MIN_AUTH_SECRET_LENGTH = 32;

export function getAuthSecret(): string {
  const secret = getServerEnv().AUTH_SECRET;
  if (!secret || secret.length < MIN_AUTH_SECRET_LENGTH) {
    throw new ConfigurationError(
      `AUTH_SECRET must be configured with at least ${MIN_AUTH_SECRET_LENGTH} characters.`,
    );
  }
  return secret;
}

export function getAuthSecretKey(): Uint8Array {
  return new TextEncoder().encode(getAuthSecret());
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
}

/** Returns null when SMTP is not configured. */
export function getSmtpConfig(): SmtpConfig | null {
  const env = getServerEnv();
  if (!env.SMTP_HOST) return null;
  return {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    from: env.OTP_EMAIL_FROM ?? env.SMTP_USER ?? "no-reply@localhost",
  };
}

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

/** Returns null unless all three Cloudinary credentials are configured. */
export function getCloudinaryConfig(): CloudinaryConfig | null {
  const env = getServerEnv();
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) return null;
  return {
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    apiKey: env.CLOUDINARY_API_KEY,
    apiSecret: env.CLOUDINARY_API_SECRET,
  };
}

/**
 * Master OTP: a fixed 6-digit code accepted in place of the emailed OTP for registered, active users.
 * Disabled unless MASTER_OTP is exactly 6 digits, and disabled in production unless
 * MASTER_OTP_ALLOW_IN_PRODUCTION="true". Never log or return it.
 */
export function getMasterOtp(): string | null {
  const env = getServerEnv();
  const code = env.MASTER_OTP?.trim();
  if (!code || !/^\d{6}$/.test(code)) return null;
  if (isProduction() && env.MASTER_OTP_ALLOW_IN_PRODUCTION?.toLowerCase() !== "true") return null;
  return code;
}

export const DEFAULT_CLOUDINARY_UPLOAD_FOLDER = "office-daily-updates";

/**
 * Root Cloudinary folder for this app's uploads (CLOUDINARY_UPLOAD_FOLDER). Files are stored under
 * <folder>/<officeId>/<photos|documents>. Only this folder is accepted on records, so changing it means
 * previously uploaded files can no longer be attached to new records.
 */
export function getCloudinaryUploadFolder(): string {
  const configured = getServerEnv().CLOUDINARY_UPLOAD_FOLDER?.replace(/^\/+|\/+$/g, "");
  if (!configured || !/^[A-Za-z0-9._-]+$/.test(configured)) return DEFAULT_CLOUDINARY_UPLOAD_FOLDER;
  return configured;
}

export function getMaxFileSizeMb(): number {
  return getServerEnv().MAX_FILE_SIZE_MB;
}

export function getMaxFileSizeBytes(): number {
  return Math.floor(getMaxFileSizeMb() * 1024 * 1024);
}

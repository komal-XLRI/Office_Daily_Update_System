import mongoose, { Schema, type Model, type Types } from "mongoose";

import { ROLES } from "@/lib/constants";
import type { Role } from "@/types";

/**
 * Short-lived OTP login state. Authentication is OTP-only, so there is no password field.
 * This sub-document is hidden from every query by default (`select: false`) and must never be
 * serialized, returned from an API, or logged. Only src/lib/auth/otp.ts reads it (`.select("+otp")`).
 * Only an HMAC of the code is stored.
 */
export interface IUserOtp {
  codeHash: string | null;
  expiresAt: Date | null;
  attempts: number;
  lastSentAt: Date | null;
  sendWindowStartedAt: Date | null;
  sendCount: number;
}

export interface IUser {
  name: string;
  email: string;
  role: Role;
  designation: string;
  officeId: Types.ObjectId | null;
  isActive: boolean;
  /**
   * Session revocation counter, embedded in the session JWT and compared by getCurrentUser().
   * Incremented on logout, deactivation, role change and office change. Never include in DTOs.
   */
  sessionVersion: number;
  otp?: IUserOtp;
  createdAt: Date;
  updatedAt: Date;
}

const otpSchema = new Schema<IUserOtp>(
  {
    codeHash: { type: String, default: null },
    expiresAt: { type: Date, default: null },
    attempts: { type: Number, default: 0, min: 0 },
    lastSentAt: { type: Date, default: null },
    sendWindowStartedAt: { type: Date, default: null },
    sendCount: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

function stripOtp(_doc: unknown, ret: Record<string, unknown>) {
  delete ret.otp;
  return ret;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: [true, "Name is required"], trim: true, maxlength: 120 },
    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    role: { type: String, enum: ROLES, required: true, default: "user" },
    designation: { type: String, trim: true, maxlength: 120, default: "" },
    officeId: { type: Schema.Types.ObjectId, ref: "Office", default: null },
    isActive: { type: Boolean, default: true },
    sessionVersion: { type: Number, default: 0, min: 0 },
    otp: { type: otpSchema, select: false },
  },
  {
    timestamps: true,
    collection: "users",
    toJSON: { transform: stripOtp },
    toObject: { transform: stripOtp },
  },
);

userSchema.pre("validate", function () {
  if (this.role === "user" && !this.officeId) {
    this.invalidate("officeId", "Normal users must be assigned to an office");
  }
});

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ officeId: 1 });
userSchema.index({ role: 1 });
userSchema.index({ isActive: 1 });

export const User: Model<IUser> =
  (mongoose.models.User as Model<IUser> | undefined) ?? mongoose.model<IUser>("User", userSchema);

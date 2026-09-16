import mongoose, { Schema, type Model } from "mongoose";

export const OFFICE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]*$/;

export interface IOffice {
  name: string;
  code: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const officeSchema = new Schema<IOffice>(
  {
    name: { type: String, required: [true, "Office name is required"], trim: true, maxlength: 120 },
    code: {
      type: String,
      required: [true, "Office code is required"],
      trim: true,
      uppercase: true,
      maxlength: 30,
      match: [OFFICE_CODE_PATTERN, "Office code may contain only letters, numbers and hyphens"],
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "offices" },
);

officeSchema.index({ code: 1 }, { unique: true });

export const Office: Model<IOffice> =
  (mongoose.models.Office as Model<IOffice> | undefined) ?? mongoose.model<IOffice>("Office", officeSchema);

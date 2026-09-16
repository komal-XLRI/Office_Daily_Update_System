import mongoose, { Schema, type Model, type Types } from "mongoose";

import { MAX_MILESTONES_PER_RECORD } from "@/lib/constants";

import { attachmentsField, isUtcMidnight, type IAttachment } from "./attachment";

export interface IMilestone {
  title: string;
  description: string;
  remarks: string;
}

export interface IDailyUpdate {
  title: string;
  description: string;
}

/** One record per office per business date: the daily update plus its milestones and attachments. */
export interface IDailyMilestone {
  officeId: Types.ObjectId;
  /** Business date stored as UTC midnight. */
  date: Date;
  dailyUpdate: IDailyUpdate;
  milestones: IMilestone[];
  photos: IAttachment[];
  documents: IAttachment[];
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const milestoneSchema = new Schema<IMilestone>(
  {
    title: { type: String, required: [true, "Milestone title is required"], trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 5000, default: "" },
    remarks: { type: String, trim: true, maxlength: 2000, default: "" },
  },
  { _id: false },
);

const dailyUpdateSchema = new Schema<IDailyUpdate>(
  {
    title: { type: String, required: [true, "Daily update title is required"], trim: true, maxlength: 200 },
    description: {
      type: String,
      required: [true, "Daily update description is required"],
      trim: true,
      maxlength: 10000,
    },
  },
  { _id: false },
);

const dailyMilestoneSchema = new Schema<IDailyMilestone>(
  {
    officeId: { type: Schema.Types.ObjectId, ref: "Office", required: [true, "Office is required"] },
    date: { type: Date, required: [true, "Date is required"] },
    dailyUpdate: { type: dailyUpdateSchema, required: true },
    milestones: {
      type: [milestoneSchema],
      default: [],
      validate: {
        validator: (value: IMilestone[]) => value.length <= MAX_MILESTONES_PER_RECORD,
        message: `A maximum of ${MAX_MILESTONES_PER_RECORD} milestones is allowed`,
      },
    },
    photos: attachmentsField(),
    documents: attachmentsField(),
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, collection: "dailyMilestones" },
);

dailyMilestoneSchema.pre("validate", function () {
  if (this.date && !isUtcMidnight(this.date)) {
    this.invalidate("date", "Date must be a calendar day");
  }
});

// One record per office per business date.
dailyMilestoneSchema.index({ officeId: 1, date: 1 }, { unique: true });
// Admin all-office lists, dashboard counts and all-office reports filter by date without an office.
dailyMilestoneSchema.index({ date: -1, _id: -1 });

export const DailyMilestone: Model<IDailyMilestone> =
  (mongoose.models.DailyMilestone as Model<IDailyMilestone> | undefined) ??
  mongoose.model<IDailyMilestone>("DailyMilestone", dailyMilestoneSchema);

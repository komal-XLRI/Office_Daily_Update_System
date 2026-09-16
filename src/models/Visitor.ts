import mongoose, { Schema, type Model, type Types } from "mongoose";

import { IMPORTANCE_LEVELS } from "@/lib/constants";
import type { Importance } from "@/types";

import { attachmentsField, isUtcMidnight, type IAttachment } from "./attachment";

export interface IVisitor {
  officeId: Types.ObjectId;
  name: string;
  purpose: string;
  /** Business date stored as UTC midnight. */
  date: Date;
  /** Real instant (UTC). */
  timeArrived: Date;
  /** Real instant (UTC); null while the visitor has not departed. */
  timeDeparted: Date | null;
  importance: Importance;
  photos: IAttachment[];
  documents: IAttachment[];
  remarks: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const visitorSchema = new Schema<IVisitor>(
  {
    officeId: { type: Schema.Types.ObjectId, ref: "Office", required: [true, "Office is required"] },
    name: { type: String, required: [true, "Visitor name is required"], trim: true, maxlength: 120 },
    purpose: { type: String, required: [true, "Purpose is required"], trim: true, maxlength: 500 },
    date: { type: Date, required: [true, "Date is required"] },
    timeArrived: { type: Date, required: [true, "Arrival time is required"] },
    timeDeparted: { type: Date, default: null },
    importance: { type: String, enum: IMPORTANCE_LEVELS, required: true, default: "MEDIUM" },
    photos: attachmentsField(),
    documents: attachmentsField(),
    remarks: { type: String, trim: true, maxlength: 2000, default: "" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, collection: "visitors" },
);

visitorSchema.pre("validate", function () {
  if (this.date && !isUtcMidnight(this.date)) {
    this.invalidate("date", "Date must be a calendar day");
  }
  if (this.timeArrived && this.timeDeparted && this.timeDeparted < this.timeArrived) {
    this.invalidate("timeDeparted", "Departure time cannot be before arrival time");
  }
});

// Matches the list sort (date, timeArrived, _id — all descending) within an office.
visitorSchema.index({ officeId: 1, date: -1, timeArrived: -1, _id: -1 });
visitorSchema.index({ officeId: 1, name: 1 });
visitorSchema.index({ officeId: 1, importance: 1 });
// Admin all-office lists, dashboard counts and all-office reports filter by date without an office.
visitorSchema.index({ date: -1, timeArrived: -1, _id: -1 });

export const Visitor: Model<IVisitor> =
  (mongoose.models.Visitor as Model<IVisitor> | undefined) ?? mongoose.model<IVisitor>("Visitor", visitorSchema);

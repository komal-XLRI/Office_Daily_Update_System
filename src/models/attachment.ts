import { Schema } from "mongoose";

import { MAX_ATTACHMENTS_PER_FIELD } from "@/lib/constants";

/** Embedded file metadata (not a collection). Binary files are stored in Cloudinary. */
export interface IAttachment {
  fileName: string;
  fileUrl: string;
}

export const attachmentSchema = new Schema<IAttachment>(
  {
    fileName: { type: String, required: true, trim: true, maxlength: 255 },
    fileUrl: { type: String, required: true, trim: true, maxlength: 2048 },
  },
  { _id: false },
);

/** Field definition for a `photos` / `documents` array. Returns a fresh object per use. */
export function attachmentsField() {
  return {
    type: [attachmentSchema],
    default: [],
    validate: {
      validator: (value: IAttachment[]) => value.length <= MAX_ATTACHMENTS_PER_FIELD,
      message: `A maximum of ${MAX_ATTACHMENTS_PER_FIELD} files is allowed`,
    },
  };
}

const DAY_MS = 86_400_000;

/** Business dates are stored as UTC midnight of the calendar day. */
export function isUtcMidnight(value: Date | null | undefined): boolean {
  return value instanceof Date && !Number.isNaN(value.getTime()) && value.getTime() % DAY_MS === 0;
}

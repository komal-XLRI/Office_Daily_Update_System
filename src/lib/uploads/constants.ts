/** Upload rules shared by the uploader UI and the /api/uploads route (spec §9). */

export const UPLOAD_KINDS = ["photos", "documents"] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

export const MAX_FILES_PER_UPLOAD = 10;
export const DEFAULT_MAX_FILE_SIZE_MB = 10;

interface UploadRule {
  label: string;
  description: string;
  /** Allowed extension (lowercase, no dot) → allowed declared MIME types. */
  mimeTypesByExtension: Record<string, readonly string[]>;
}

export const UPLOAD_RULES: Record<UploadKind, UploadRule> = {
  photos: {
    label: "Photos",
    description: "JPG, JPEG, PNG or WEBP",
    mimeTypesByExtension: {
      jpg: ["image/jpeg"],
      jpeg: ["image/jpeg"],
      png: ["image/png"],
      webp: ["image/webp"],
    },
  },
  documents: {
    label: "Documents",
    description: "PDF, DOC, DOCX, XLS or XLSX",
    mimeTypesByExtension: {
      pdf: ["application/pdf"],
      doc: ["application/msword"],
      docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      xls: ["application/vnd.ms-excel"],
      xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    },
  },
};

export function getFileExtension(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index > 0 && index < fileName.length - 1 ? fileName.slice(index + 1).toLowerCase() : "";
}

/** Value for <input type="file" accept="...">. */
export function acceptAttribute(kind: UploadKind): string {
  const rule = UPLOAD_RULES[kind];
  const extensions = Object.keys(rule.mimeTypesByExtension).map((extension) => `.${extension}`);
  const mimeTypes = [...new Set(Object.values(rule.mimeTypesByExtension).flat())];
  return [...extensions, ...mimeTypes].join(",");
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

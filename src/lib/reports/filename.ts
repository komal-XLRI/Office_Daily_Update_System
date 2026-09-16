import type { ReportMeta } from "./types";

const MAX_SLUG_LENGTH = 60;

/** Lowercase ASCII slug: "Dean (Admin) & HR" → "dean-admin-hr". */
function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
}

function periodSlug(meta: ReportMeta): string {
  if (meta.type === "monthly") return meta.from.slice(0, 7);
  return meta.from === meta.to ? meta.from : `${meta.from}-to-${meta.to}`;
}

/**
 * Safe download file name (ASCII only, no quotes or path characters), e.g.
 * "report-daily-dean-admin-2026-09-08.pdf" or "report-monthly-all-offices-2026-09.xlsx".
 */
export function reportFileName(meta: ReportMeta, extension: string): string {
  const office = meta.officeId ? slugify(meta.officeLabel) || "office" : "all-offices";
  const ext = extension.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const period = periodSlug(meta).replace(/[^0-9a-z-]/g, "");
  return `report-${meta.type}-${office}-${period}.${ext}`;
}

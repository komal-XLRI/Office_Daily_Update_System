/** Shared enumerations. Import from here instead of re-declaring literal lists. */

export const APP_NAME = "Office Daily Update & Milestone Management System";
export const APP_SHORT_NAME = "Office Daily Updates";

/** Exactly two application roles (spec §3). Do not add more. */
export const ROLES = ["admin", "user"] as const;

export const IMPORTANCE_LEVELS = ["HIGH", "MEDIUM", "LOW"] as const;

export const REPORT_TYPES = ["daily", "weekly", "monthly", "custom"] as const;

export const REPORT_FORMATS = ["json", "pdf", "csv", "xlsx"] as const;

export const MAX_ATTACHMENTS_PER_FIELD = 20;

export const MAX_MILESTONES_PER_RECORD = 50;

export const DEFAULT_PAGE_SIZE = 20;

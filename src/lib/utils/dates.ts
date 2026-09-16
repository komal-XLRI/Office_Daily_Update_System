import { TZDate } from "@date-fns/tz";

/**
 * Date & time conventions (spec §36):
 *
 * - A *business date* is a calendar day in the institutional timezone, written "YYYY-MM-DD".
 *   It is stored in MongoDB as UTC midnight of that day (e.g. 2026-09-08 → 2026-09-08T00:00:00.000Z),
 *   so a record can never move to the previous/next day because of server or browser timezones.
 *   Always convert with businessDateToUtc()/utcToBusinessDate() — never `new Date("YYYY-MM-DD")` + local getters.
 * - Real instants (visitor arrival/departure, createdAt/updatedAt) are stored as UTC and displayed in APP_TIMEZONE.
 * - "Today" is always computed in APP_TIMEZONE via todayBusinessDate().
 * - Formatting is done manually (not Intl month names) so server and browser output is identical (no hydration drift).
 */

export const APP_TIMEZONE = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Kolkata";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 86_400_000;

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const pad = (value: number) => String(value).padStart(2, "0");

function parseDateParts(value: string): [number, number, number] | null {
  const match = DATE_RE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2999 || month < 1 || month > 12 || day < 1) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return [year, month, day];
}

export function isValidBusinessDate(value: unknown): value is string {
  return typeof value === "string" && parseDateParts(value) !== null;
}

export function isValidMonth(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = MONTH_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return year >= 1900 && year <= 2999 && month >= 1 && month <= 12;
}

export function isValidTime(value: unknown): value is string {
  return typeof value === "string" && TIME_RE.test(value);
}

/** "YYYY-MM-DD" → Date at UTC midnight. Throws RangeError for invalid input. */
export function businessDateToUtc(value: string): Date {
  const parts = parseDateParts(value);
  if (!parts) throw new RangeError(`Invalid business date "${value}"`);
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

/** Stored business date (UTC midnight) → "YYYY-MM-DD". */
export function utcToBusinessDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError("Invalid date value");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const zonedFormatters = new Map<string, Intl.DateTimeFormat>();

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  let formatter = zonedFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    zonedFormatters.set(timeZone, formatter);
  }
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) parts[part.type] = part.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

/** Today's business date in the institutional timezone. */
export function todayBusinessDate(now: Date = new Date(), timeZone: string = APP_TIMEZONE): string {
  const parts = zonedParts(now, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** Current month "YYYY-MM" in the institutional timezone. */
export function currentMonth(now: Date = new Date(), timeZone: string = APP_TIMEZONE): string {
  return todayBusinessDate(now, timeZone).slice(0, 7);
}

export function addDays(value: string, days: number): string {
  return utcToBusinessDate(new Date(businessDateToUtc(value).getTime() + days * DAY_MS));
}

/** Number of calendar days in [from, to], inclusive. */
export function daysInclusive(from: string, to: string): number {
  return Math.round((businessDateToUtc(to).getTime() - businessDateToUtc(from).getTime()) / DAY_MS) + 1;
}

export interface BusinessDateRange {
  from: string;
  to: string;
}

/** Monday–Sunday week containing `value`. */
export function weekRange(value: string): BusinessDateRange {
  const weekday = businessDateToUtc(value).getUTCDay();
  const from = addDays(value, -((weekday + 6) % 7));
  return { from, to: addDays(from, 6) };
}

/** First and last day of a "YYYY-MM" month. */
export function monthRange(month: string): BusinessDateRange {
  if (!isValidMonth(month)) throw new RangeError(`Invalid month "${month}"`);
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(lastDay)}` };
}

/** MongoDB filter for a stored business-date field covering [from, to] inclusive. */
export function businessDateRangeFilter(from: string, to: string): { $gte: Date; $lt: Date } {
  // Computed from the UTC instant so the exclusive upper bound works at the accepted year limit (2999-12-31).
  return { $gte: businessDateToUtc(from), $lt: new Date(businessDateToUtc(to).getTime() + DAY_MS) };
}

/** MongoDB filter matching a single stored business date. */
export function businessDateFilter(date: string): { $gte: Date; $lt: Date } {
  return businessDateRangeFilter(date, date);
}

/** Business date + "HH:mm" wall-clock time in the institutional timezone → UTC instant. */
export function combineDateAndTime(date: string, time: string, timeZone: string = APP_TIMEZONE): Date {
  const parts = parseDateParts(date);
  const timeMatch = TIME_RE.exec(time);
  if (!parts || !timeMatch) throw new RangeError("Invalid date or time");
  const zoned = new TZDate(
    parts[0],
    parts[1] - 1,
    parts[2],
    Number(timeMatch[1]),
    Number(timeMatch[2]),
    0,
    0,
    timeZone,
  );
  return new Date(zoned.getTime());
}

/** UTC instant → "HH:mm" in the institutional timezone (for <input type="time">). */
export function toTimeInputValue(
  value: Date | string | null | undefined,
  timeZone: string = APP_TIMEZONE,
): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = zonedParts(date, timeZone);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

function toBusinessDateParts(value: Date | string): [number, number, number] | null {
  if (typeof value === "string" && DATE_RE.test(value)) return parseDateParts(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
}

/** Business date → "08 Sep 2026" (or "Tuesday, 08 September 2026" with style "long"). */
export function formatBusinessDate(value: Date | string, style: "medium" | "long" = "medium"): string {
  const parts = toBusinessDateParts(value);
  if (!parts) return "—";
  const [year, month, day] = parts;
  if (style === "long") {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return `${WEEKDAYS_LONG[weekday]}, ${pad(day)} ${MONTHS_LONG[month - 1]} ${year}`;
  }
  return `${pad(day)} ${MONTHS_SHORT[month - 1]} ${year}`;
}

export function formatBusinessDateRange(from: string, to: string): string {
  return from === to ? formatBusinessDate(from) : `${formatBusinessDate(from)} – ${formatBusinessDate(to)}`;
}

/** "YYYY-MM" → "September 2026". */
export function formatMonth(month: string): string {
  if (!isValidMonth(month)) return "—";
  const [year, monthNumber] = month.split("-").map(Number);
  return `${MONTHS_LONG[monthNumber - 1]} ${year}`;
}

function formatClock(hour: number, minute: number): string {
  return `${pad(hour % 12 || 12)}:${pad(minute)} ${hour < 12 ? "AM" : "PM"}`;
}

/** UTC instant → "09:05 AM" in the institutional timezone. */
export function formatTime(value: Date | string | null | undefined, timeZone: string = APP_TIMEZONE): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = zonedParts(date, timeZone);
  return formatClock(parts.hour, parts.minute);
}

/** UTC instant → "15 Sep 2026, 09:05 AM" in the institutional timezone. */
export function formatDateTime(
  value: Date | string | null | undefined,
  timeZone: string = APP_TIMEZONE,
): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = zonedParts(date, timeZone);
  return `${pad(parts.day)} ${MONTHS_SHORT[parts.month - 1]} ${parts.year}, ${formatClock(parts.hour, parts.minute)}`;
}

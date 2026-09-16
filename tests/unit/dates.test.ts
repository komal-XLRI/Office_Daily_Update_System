import { describe, expect, it } from "vitest";

import {
  addDays,
  APP_TIMEZONE,
  businessDateFilter,
  businessDateRangeFilter,
  businessDateToUtc,
  combineDateAndTime,
  currentMonth,
  daysInclusive,
  formatBusinessDate,
  formatBusinessDateRange,
  formatDateTime,
  formatMonth,
  formatTime,
  isValidBusinessDate,
  isValidMonth,
  isValidTime,
  monthRange,
  todayBusinessDate,
  toTimeInputValue,
  utcToBusinessDate,
  weekRange,
} from "@/lib/utils/dates";

// vitest.config.mts runs these tests with TZ=America/Los_Angeles, so any accidental use of the server's
// local timezone would shift days and fail. Business dates must follow Asia/Kolkata (spec §36).

describe("configuration", () => {
  it("uses the institutional timezone", () => {
    expect(APP_TIMEZONE).toBe("Asia/Kolkata");
  });
});

describe("business date conversion", () => {
  it("stores a business date as UTC midnight", () => {
    expect(businessDateToUtc("2026-09-08").toISOString()).toBe("2026-09-08T00:00:00.000Z");
  });

  it.each([
    "2026-09-08",
    "2024-02-29",
    "2000-02-29",
    "2026-01-01",
    "2026-12-31",
    "2027-01-01",
    "1900-01-01",
    "2999-12-31",
  ])("round-trips %s", (value) => {
    expect(isValidBusinessDate(value)).toBe(true);
    expect(utcToBusinessDate(businessDateToUtc(value))).toBe(value);
  });

  it("reads stored Date and ISO string values without shifting the day", () => {
    expect(utcToBusinessDate("2026-09-08T00:00:00.000Z")).toBe("2026-09-08");
    expect(utcToBusinessDate(new Date("2026-09-08T00:00:00.000Z"))).toBe("2026-09-08");
    expect(utcToBusinessDate(new Date("2026-09-08T23:59:59.999Z"))).toBe("2026-09-08");
  });

  it.each([
    "2026-02-30",
    "2025-02-29",
    "1900-02-29",
    "2026-9-1",
    "2026-09-1",
    "2026-13-01",
    "2026-00-10",
    "2026-09-00",
    "2026-09-31",
    "26-09-08",
    "2026/09/08",
    "08-09-2026",
    "2026-09-08T00:00:00Z",
    " 2026-09-08",
    "1899-12-31",
    "3000-01-01",
    "",
  ])("rejects invalid business date %j", (value) => {
    expect(isValidBusinessDate(value)).toBe(false);
    expect(() => businessDateToUtc(value)).toThrow(RangeError);
  });

  it("rejects non-string business dates", () => {
    expect(isValidBusinessDate(undefined)).toBe(false);
    expect(isValidBusinessDate(null)).toBe(false);
    expect(isValidBusinessDate(20260908)).toBe(false);
    expect(isValidBusinessDate(new Date("2026-09-08T00:00:00.000Z"))).toBe(false);
  });

  it("throws for unparseable stored values", () => {
    expect(() => utcToBusinessDate("not a date")).toThrow(RangeError);
    expect(() => utcToBusinessDate(new Date(Number.NaN))).toThrow(RangeError);
  });

  it("validates months and times", () => {
    expect(isValidMonth("2026-09")).toBe(true);
    expect(isValidMonth("2026-9")).toBe(false);
    expect(isValidMonth("2026-13")).toBe(false);
    expect(isValidMonth("2026-00")).toBe(false);
    expect(isValidTime("00:00")).toBe(true);
    expect(isValidTime("23:59")).toBe(true);
    expect(isValidTime("24:00")).toBe(false);
    expect(isValidTime("9:05")).toBe(false);
    expect(isValidTime("09:60")).toBe(false);
  });
});

describe("todayBusinessDate", () => {
  it("switches to the next day exactly at midnight IST", () => {
    expect(todayBusinessDate(new Date("2026-09-14T18:29:59Z"))).toBe("2026-09-14");
    expect(todayBusinessDate(new Date("2026-09-14T18:30:00Z"))).toBe("2026-09-15");
  });

  it("handles month and year boundaries", () => {
    expect(todayBusinessDate(new Date("2026-09-30T18:30:00Z"))).toBe("2026-10-01");
    expect(todayBusinessDate(new Date("2026-12-31T18:29:59Z"))).toBe("2026-12-31");
    expect(todayBusinessDate(new Date("2026-12-31T18:30:00Z"))).toBe("2027-01-01");
    expect(currentMonth(new Date("2026-09-30T18:30:00Z"))).toBe("2026-10");
  });

  it("accepts an explicit timezone", () => {
    expect(todayBusinessDate(new Date("2026-09-14T18:30:00Z"), "UTC")).toBe("2026-09-14");
  });
});

describe("visitor times", () => {
  it("combines a business date and IST wall-clock time into a UTC instant", () => {
    expect(combineDateAndTime("2026-09-08", "09:05").toISOString()).toBe("2026-09-08T03:35:00.000Z");
    expect(combineDateAndTime("2026-09-08", "23:59").toISOString()).toBe("2026-09-08T18:29:00.000Z");
    // Just after midnight IST is still the previous day in UTC.
    expect(combineDateAndTime("2026-09-08", "00:15").toISOString()).toBe("2026-09-07T18:45:00.000Z");
    expect(combineDateAndTime("2026-09-08", "09:05", "UTC").toISOString()).toBe("2026-09-08T09:05:00.000Z");
  });

  it("keeps early-morning arrivals on their business date", () => {
    const arrival = combineDateAndTime("2026-09-08", "00:15");
    expect(todayBusinessDate(arrival)).toBe("2026-09-08");
    expect(formatDateTime(arrival)).toBe("08 Sep 2026, 12:15 AM");
  });

  it.each([
    ["2026-09-08", "24:00"],
    ["2026-09-08", "9:05"],
    ["2026-09-08", ""],
    ["2026-02-30", "09:00"],
    ["2026-9-8", "09:00"],
  ])("rejects invalid date/time %s %s", (date, time) => {
    expect(() => combineDateAndTime(date, time)).toThrow(RangeError);
  });

  it.each(["00:00", "00:15", "09:05", "12:00", "18:30", "23:59"])(
    "round-trips %s through toTimeInputValue",
    (time) => {
      expect(toTimeInputValue(combineDateAndTime("2026-09-08", time))).toBe(time);
    },
  );

  it("formats time input values from Date and ISO strings", () => {
    expect(toTimeInputValue(new Date("2026-09-08T03:35:00.000Z"))).toBe("09:05");
    expect(toTimeInputValue("2026-09-08T03:35:00.000Z")).toBe("09:05");
    expect(toTimeInputValue(null)).toBe("");
    expect(toTimeInputValue(undefined)).toBe("");
    expect(toTimeInputValue("")).toBe("");
    expect(toTimeInputValue("garbage")).toBe("");
  });

  it("formats times as 12-hour IST clock values", () => {
    expect(formatTime(combineDateAndTime("2026-09-08", "09:05"))).toBe("09:05 AM");
    expect(formatTime(combineDateAndTime("2026-09-08", "12:00"))).toBe("12:00 PM");
    expect(formatTime(combineDateAndTime("2026-09-08", "00:15"))).toBe("12:15 AM");
    expect(formatTime("2026-09-08T18:29:00.000Z")).toBe("11:59 PM");
    expect(formatTime(null)).toBe("—");
    expect(formatTime("garbage")).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
  });
});

describe("weekRange", () => {
  it.each(["2026-09-07", "2026-09-08", "2026-09-10", "2026-09-13"])(
    "uses the Monday–Sunday week for %s",
    (day) => {
      expect(weekRange(day)).toEqual({ from: "2026-09-07", to: "2026-09-13" });
    },
  );

  it("crosses month boundaries", () => {
    expect(weekRange("2026-10-01")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(weekRange("2026-08-31")).toEqual({ from: "2026-08-31", to: "2026-09-06" });
  });

  it("crosses year boundaries", () => {
    expect(weekRange("2027-01-01")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
    expect(weekRange("2026-12-28")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
  });

  it("handles leap February", () => {
    expect(weekRange("2024-02-29")).toEqual({ from: "2024-02-26", to: "2024-03-03" });
  });
});

describe("monthRange", () => {
  it.each([
    ["2026-09", "2026-09-01", "2026-09-30"],
    ["2026-12", "2026-12-01", "2026-12-31"],
    ["2026-02", "2026-02-01", "2026-02-28"],
    ["2024-02", "2024-02-01", "2024-02-29"],
    ["2000-02", "2000-02-01", "2000-02-29"],
    ["2100-02", "2100-02-01", "2100-02-28"],
  ])("%s → %s … %s", (month, from, to) => {
    expect(monthRange(month)).toEqual({ from, to });
  });

  it("rejects invalid months", () => {
    expect(() => monthRange("2026-13")).toThrow(RangeError);
    expect(() => monthRange("2026-9")).toThrow(RangeError);
  });
});

describe("date arithmetic", () => {
  it("adds days across month, year and leap boundaries", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("counts days inclusively", () => {
    expect(daysInclusive("2026-09-08", "2026-09-08")).toBe(1);
    expect(daysInclusive("2026-01-01", "2026-12-31")).toBe(365);
    expect(daysInclusive("2024-01-01", "2024-12-31")).toBe(366);
  });
});

describe("businessDateRangeFilter", () => {
  it("covers [from, to] inclusively with an exclusive upper bound", () => {
    const filter = businessDateRangeFilter("2026-09-01", "2026-09-30");
    expect(filter.$gte.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(filter.$lt.toISOString()).toBe("2026-10-01T00:00:00.000Z");

    const matches = (day: string) => {
      const stored = businessDateToUtc(day);
      return stored >= filter.$gte && stored < filter.$lt;
    };
    expect(matches("2026-09-01")).toBe(true);
    expect(matches("2026-09-30")).toBe(true);
    expect(matches("2026-08-31")).toBe(false);
    expect(matches("2026-10-01")).toBe(false);
  });

  it("matches a single business date across a year boundary", () => {
    const filter = businessDateFilter("2026-12-31");
    expect(filter.$gte.toISOString()).toBe("2026-12-31T00:00:00.000Z");
    expect(filter.$lt.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("rejects invalid bounds", () => {
    expect(() => businessDateRangeFilter("2026-09-01", "2026-09-31")).toThrow(RangeError);
  });
});

describe("formatting", () => {
  it("formats business dates as DD Mon YYYY", () => {
    expect(formatBusinessDate("2026-09-08")).toBe("08 Sep 2026");
    expect(formatBusinessDate(businessDateToUtc("2026-09-08"))).toBe("08 Sep 2026");
    expect(formatBusinessDate("2026-09-08T00:00:00.000Z")).toBe("08 Sep 2026");
    expect(formatBusinessDate("2026-01-01")).toBe("01 Jan 2026");
  });

  it("formats the long style with the weekday", () => {
    expect(formatBusinessDate("2026-09-08", "long")).toBe("Tuesday, 08 September 2026");
  });

  it("returns a dash for invalid dates", () => {
    expect(formatBusinessDate("2026-02-30")).toBe("—");
    expect(formatBusinessDate("garbage")).toBe("—");
  });

  it("formats ranges and months", () => {
    expect(formatBusinessDateRange("2026-09-08", "2026-09-08")).toBe("08 Sep 2026");
    expect(formatBusinessDateRange("2026-09-07", "2026-09-13")).toBe("07 Sep 2026 – 13 Sep 2026");
    expect(formatMonth("2026-09")).toBe("September 2026");
    expect(formatMonth("2026-13")).toBe("—");
  });
});

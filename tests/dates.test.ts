import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  utcToZonedLocal,
  zonedLocalToUtc,
} from "@/lib/dates";

describe("zonedLocalToUtc", () => {
  it("reads a datetime-local value as wall-clock time in the user's zone", () => {
    // 9:30pm in New York on Oct 31 (EDT, UTC-4) is 01:30 UTC on Nov 1.
    expect(zonedLocalToUtc("2026-10-31T21:30", "America/New_York")?.toISOString()).toBe(
      "2026-11-01T01:30:00.000Z",
    );
    // Same wall-clock in Tokyo (UTC+9) is the previous UTC day's noon.
    expect(zonedLocalToUtc("2026-10-31T21:30", "Asia/Tokyo")?.toISOString()).toBe(
      "2026-10-31T12:30:00.000Z",
    );
  });

  it("handles both sides of a DST change", () => {
    // Jan: EST, UTC-5.
    expect(zonedLocalToUtc("2026-01-15T09:00", "America/New_York")?.toISOString()).toBe(
      "2026-01-15T14:00:00.000Z",
    );
    // Jul: EDT, UTC-4.
    expect(zonedLocalToUtc("2026-07-15T09:00", "America/New_York")?.toISOString()).toBe(
      "2026-07-15T13:00:00.000Z",
    );
  });

  it("passes through input that already carries a zone, rejects garbage", () => {
    expect(zonedLocalToUtc("2026-10-31T21:30:00Z", "America/New_York")?.toISOString()).toBe(
      "2026-10-31T21:30:00.000Z",
    );
    expect(zonedLocalToUtc("not a date", "America/New_York")).toBeNull();
  });
});

describe("utcToZonedLocal", () => {
  it("is the inverse of zonedLocalToUtc", () => {
    const tz = "America/Los_Angeles";
    for (const local of ["2026-03-08T01:59", "2026-03-08T03:00", "2026-11-01T01:30", "2026-12-25T17:45"]) {
      expect(utcToZonedLocal(zonedLocalToUtc(local, tz)!, tz)).toBe(local);
    }
  });

  it("renders midnight as 00, never 24", () => {
    expect(utcToZonedLocal(new Date("2026-06-01T04:00:00Z"), "America/New_York")).toBe(
      "2026-06-01T00:00",
    );
  });
});

describe("formatDate / formatDateTime", () => {
  it("shows the calendar day in the user's zone, not the server's", () => {
    const instant = "2026-11-01T01:30:00Z"; // still Oct 31 in New York
    expect(formatDate(instant, "America/New_York")).toBe("10/31/2026");
    expect(formatDate(instant, "UTC")).toBe("11/1/2026");
    expect(formatDateTime(instant, "America/New_York")).toBe("10/31/26, 9:30 PM");
  });
});

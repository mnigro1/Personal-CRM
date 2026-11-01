import { describe, expect, it } from "vitest";
import { monthKeysBack } from "@/db/repo-intros";

describe("monthKeysBack", () => {
  it("walks back calendar months, newest first, with no repeats", () => {
    expect(monthKeysBack("2026-10", 3)).toEqual(["2026-10", "2026-09", "2026-08"]);
  });

  it("crosses a year boundary", () => {
    expect(monthKeysBack("2026-02", 4)).toEqual([
      "2026-02",
      "2026-01",
      "2025-12",
      "2025-11",
    ]);
  });

  it("never duplicates a month, however the clock and timezone line up", () => {
    // The regression: 8pm on Oct 31 in New York is already Nov 1 in UTC.
    // Stepping a Date back by UTC months while labelling in local time gave
    // "2026-10" twice and doubled every count in it.
    const keys = monthKeysBack("2026-10", 12);
    expect(new Set(keys).size).toBe(12);
    expect(keys[0]).toBe("2026-10");
    expect(keys[11]).toBe("2025-11");
  });
});

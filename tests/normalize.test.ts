import { describe, expect, it } from "vitest";
import { normalizeDate, normalizeTagName, sourceHash } from "@/lib/normalize";
import { proposalSchema } from "@/lib/proposal";

describe("normalizeTagName", () => {
  it("lowercases, trims, collapses whitespace, strips punctuation", () => {
    expect(normalizeTagName("  Health-Care   Entrepreneurship!  ")).toBe(
      "healthcare entrepreneurship",
    );
    expect(normalizeTagName("HBS")).toBe("hbs");
    expect(normalizeTagName("V.C.")).toBe("vc");
  });

  it("keeps unicode letters and numbers", () => {
    expect(normalizeTagName("Café 2024")).toBe("café 2024");
  });

  it("returns empty string for punctuation-only input", () => {
    expect(normalizeTagName("!!!")).toBe("");
  });
});

describe("sourceHash", () => {
  it("is stable under whitespace differences", () => {
    expect(sourceHash("Had coffee  with\nSarah.")).toBe(
      sourceHash("Had coffee with Sarah."),
    );
  });

  it("differs for different content", () => {
    expect(sourceHash("Had coffee with Sarah")).not.toBe(
      sourceHash("Had coffee with Mike"),
    );
  });

  it("is a hex sha-256", () => {
    expect(sourceHash("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("normalizeDate", () => {
  it("expands the partial forms the extractor actually emits", () => {
    // The reported crash: precision "year" invites a bare year, and Postgres
    // rejects it with 'invalid input syntax for type date'.
    expect(normalizeDate("2023")).toBe("2023-01-01");
    expect(normalizeDate("2023-06")).toBe("2023-06-01");
    expect(normalizeDate("2023-6")).toBe("2023-06-01");
    expect(normalizeDate("2023-Q3")).toBe("2023-07-01");
    expect(normalizeDate("2023 q1")).toBe("2023-01-01");
    expect(normalizeDate("2023-Q4")).toBe("2023-10-01");
  });

  it("leaves a real ISO date alone", () => {
    expect(normalizeDate("2026-02-20")).toBe("2026-02-20");
    expect(normalizeDate("  2026-02-20  ")).toBe("2026-02-20");
  });

  it("drops what it cannot parse rather than passing poison to Postgres", () => {
    for (const bad of ["", "   ", "next spring", "2023-13", "2023-02-30", "20230101", "not a date"]) {
      expect(normalizeDate(bad), `expected ${JSON.stringify(bad)} to drop`).toBeNull();
    }
    expect(normalizeDate(null)).toBeNull();
    expect(normalizeDate(undefined)).toBeNull();
  });
});

describe("proposal date normalization", () => {
  it("normalizes event_date and due_date at the schema boundary", () => {
    const parsed = proposalSchema.parse({
      new_memories: [
        { contact: "Dhruv", text: "Married in Italy", category: "family", event_date: "2023", event_date_precision: "year" },
      ],
      follow_ups: [
        { contact: "Dhruv", description: "Check in", reason: "overdue", due_date: "2026-03" },
      ],
    });
    expect(parsed.new_memories[0].event_date).toBe("2023-01-01");
    // Precision is what records the vagueness; the column just needs a day.
    expect(parsed.new_memories[0].event_date_precision).toBe("year");
    expect(parsed.follow_ups[0].due_date).toBe("2026-03-01");
  });

  it("keeps the memory when its date is unsalvageable", () => {
    const parsed = proposalSchema.parse({
      new_memories: [
        { contact: "X", text: "Something true", event_date: "sometime in the spring" },
      ],
    });
    expect(parsed.new_memories[0].text).toBe("Something true");
    expect(parsed.new_memories[0].event_date).toBeNull();
  });
});

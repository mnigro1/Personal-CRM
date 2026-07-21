import { describe, expect, it } from "vitest";
import { normalizeTagName, sourceHash } from "@/lib/normalize";

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

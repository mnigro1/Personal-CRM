import { describe, expect, it } from "vitest";
import { normalizeEmail, safeHttpUrl } from "@/lib/normalize";

describe("safeHttpUrl", () => {
  it("keeps real http(s) links as written", () => {
    expect(safeHttpUrl("https://www.linkedin.com/in/someone")).toBe(
      "https://www.linkedin.com/in/someone",
    );
    expect(safeHttpUrl("http://example.com/a?b=c")).toBe("http://example.com/a?b=c");
  });

  it("adds https:// to a bare domain so people can paste what they see", () => {
    expect(safeHttpUrl("linkedin.com/in/someone")).toBe("https://linkedin.com/in/someone");
    expect(safeHttpUrl("  example.org  ")).toBe("https://example.org");
  });

  it("drops anything that could run or exfiltrate when clicked", () => {
    expect(safeHttpUrl("javascript:alert(document.cookie)")).toBeNull();
    expect(safeHttpUrl("JAVASCRIPT:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html;base64,PHNjcmlwdD4=")).toBeNull();
    expect(safeHttpUrl("vbscript:msgbox")).toBeNull();
    expect(safeHttpUrl("file:///etc/passwd")).toBeNull();
  });

  it("drops empties, typos and oversized input", () => {
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl("")).toBeNull();
    expect(safeHttpUrl("   ")).toBeNull();
    expect(safeHttpUrl("notes")).toBeNull();
    expect(safeHttpUrl("https://" + "a".repeat(3000) + ".com")).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Julie@Gmail.com ")).toBe("julie@gmail.com");
  });

  it("rejects things that are not one address", () => {
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("nope")).toBeNull();
    expect(normalizeEmail("a@b")).toBeNull();
    expect(normalizeEmail("two@a.com, three@b.com")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
});

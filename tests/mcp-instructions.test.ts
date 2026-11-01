import { describe, expect, it } from "vitest";
import { buildServerInstructions } from "@/lib/mcp-tools";
import { extractionSettingsFor, timezoneConfirmed } from "@/lib/user-settings";

describe("timezoneConfirmed", () => {
  it("is false until the flag is explicitly set", () => {
    expect(timezoneConfirmed(null)).toBe(false);
    expect(timezoneConfirmed({})).toBe(false);
    expect(timezoneConfirmed({ timezoneConfirmed: "yes" })).toBe(false);
    expect(timezoneConfirmed({ timezoneConfirmed: true })).toBe(true);
    expect(timezoneConfirmed({ goals: { introsPerMonth: 2 }, timezoneConfirmed: true })).toBe(true);
  });
});

describe("extractionSettingsFor", () => {
  it("defaults to auto-apply and reads an explicit off", () => {
    expect(extractionSettingsFor(null).autoApply).toBe(true);
    expect(extractionSettingsFor({}).autoApply).toBe(true);
    expect(extractionSettingsFor({ extraction: {} }).autoApply).toBe(true);
    expect(extractionSettingsFor({ extraction: { autoApply: false } }).autoApply).toBe(false);
    expect(extractionSettingsFor({ extraction: { autoApply: true } }).autoApply).toBe(true);
    // Other settings in the blob are left alone and don't confuse it.
    expect(
      extractionSettingsFor({ goals: { introsPerMonth: 3 }, drafting: { emoji: "never" } })
        .autoApply,
    ).toBe(true);
  });
});

describe("buildServerInstructions", () => {
  it("tells an auto-apply user's AI to apply without pausing", () => {
    const text = buildServerInstructions({ timezone: "America/New_York", autoApply: true });
    expect(text).toContain("timezone is America/New_York");
    expect(text).toContain("chosen to auto-apply");
    expect(text).not.toContain("Never call apply_extraction unprompted");
  });

  it("tells a hold-for-review user's AI to stop after staging", () => {
    const text = buildServerInstructions({ timezone: "UTC", autoApply: false });
    expect(text).toContain("STOP");
    expect(text).toContain("Never call apply_extraction unprompted");
    expect(text).not.toContain("chosen to auto-apply");
    // The rules that don't depend on the setting are still there.
    expect(text).toContain("PROACTIVELY PROCESS CAPTURES");
    expect(text).toContain("DUPLICATE CONTACTS");
    expect(text).toContain("Never guess between two similar people");
  });

  it("defaults to auto-apply when the option is omitted", () => {
    expect(buildServerInstructions({ timezone: "UTC" })).toContain("chosen to auto-apply");
  });
});

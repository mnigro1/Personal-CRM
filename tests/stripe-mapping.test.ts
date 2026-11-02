import { describe, expect, it } from "vitest";
import { idOf, subscriptionStateFrom } from "@/lib/stripe";

describe("subscriptionStateFrom", () => {
  it("takes status and the latest item period end (seconds → Date)", () => {
    const state = subscriptionStateFrom({
      id: "sub_123",
      status: "active",
      items: { data: [{ current_period_end: 1_800_000_000 }, { current_period_end: 1_799_000_000 }] },
    });
    expect(state).toEqual({
      subscriptionId: "sub_123",
      status: "active",
      currentPeriodEnd: new Date(1_800_000_000 * 1000),
    });
  });

  it("handles a subscription with no items", () => {
    expect(
      subscriptionStateFrom({ id: "sub_x", status: "canceled", items: { data: [] } }),
    ).toEqual({ subscriptionId: "sub_x", status: "canceled", currentPeriodEnd: null });
  });
});

describe("idOf", () => {
  it("accepts an id or an expanded object", () => {
    expect(idOf("cus_1")).toBe("cus_1");
    expect(idOf({ id: "cus_2" })).toBe("cus_2");
    expect(idOf(null)).toBeNull();
    expect(idOf(undefined)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  CONNECTOR_TRIAL_DAYS,
  connectorAccess,
  foundingEmails,
  trialEndsAt,
  type BillingFields,
} from "@/lib/entitlement";

const NOW = new Date("2026-11-02T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
const daysAhead = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

const user = (over: Partial<BillingFields> = {}): BillingFields => ({
  email: "someone@example.com",
  subscriptionStatus: null,
  currentPeriodEnd: null,
  connectorTrialStartedAt: null,
  ...over,
});

const on = { billingEnabled: true, founding: new Set<string>() };

describe("connectorAccess", () => {
  it("lets everyone through when billing is switched off (dev, tests)", () => {
    const a = connectorAccess(user({ connectorTrialStartedAt: daysAgo(400) }), NOW, {
      billingEnabled: false,
    });
    expect(a).toMatchObject({ allowed: true, reason: "billing_disabled" });
  });

  it("founding users never pay, whatever their trial or subscription says", () => {
    const a = connectorAccess(
      user({ email: "Matt@Example.com", connectorTrialStartedAt: daysAgo(400), subscriptionStatus: "canceled" }),
      NOW,
      { billingEnabled: true, founding: new Set(["matt@example.com"]) },
    );
    expect(a).toMatchObject({ allowed: true, reason: "founding" });
  });

  it("a live subscription is served regardless of the trial", () => {
    for (const status of ["active", "trialing"]) {
      const a = connectorAccess(
        user({ subscriptionStatus: status, connectorTrialStartedAt: daysAgo(400) }),
        NOW,
        on,
      );
      expect(a).toMatchObject({ allowed: true, reason: "subscribed" });
    }
  });

  it("past_due is served until the paid-for period ends, then not", () => {
    const paidThrough = connectorAccess(
      user({ subscriptionStatus: "past_due", currentPeriodEnd: daysAhead(3), connectorTrialStartedAt: daysAgo(400) }),
      NOW,
      on,
    );
    expect(paidThrough).toMatchObject({ allowed: true, reason: "subscribed" });
    const periodOver = connectorAccess(
      user({ subscriptionStatus: "past_due", currentPeriodEnd: daysAgo(1), connectorTrialStartedAt: daysAgo(400) }),
      NOW,
      on,
    );
    expect(periodOver).toMatchObject({ allowed: false, reason: "lapsed" });
  });

  it("a canceled subscription falls back to the trial, and is 'lapsed' once that is over", () => {
    const a = connectorAccess(
      user({ subscriptionStatus: "canceled", connectorTrialStartedAt: daysAgo(400) }),
      NOW,
      on,
    );
    expect(a).toMatchObject({ allowed: false, reason: "lapsed", daysLeft: 0 });
  });

  it("before any connector URL exists the trial hasn't started, so access is open", () => {
    const a = connectorAccess(user(), NOW, on);
    expect(a).toMatchObject({ allowed: true, reason: "trial", trialEndsAt: null, daysLeft: CONNECTOR_TRIAL_DAYS });
  });

  it("counts the trial down from the first connector URL and ends it on day 14", () => {
    const day1 = connectorAccess(user({ connectorTrialStartedAt: daysAgo(0.5) }), NOW, on);
    expect(day1).toMatchObject({ allowed: true, reason: "trial", daysLeft: 14 });

    const day13 = connectorAccess(user({ connectorTrialStartedAt: daysAgo(13.5) }), NOW, on);
    expect(day13).toMatchObject({ allowed: true, reason: "trial", daysLeft: 1 });

    const day14 = connectorAccess(user({ connectorTrialStartedAt: daysAgo(14) }), NOW, on);
    expect(day14).toMatchObject({ allowed: false, reason: "trial_expired", daysLeft: 0 });
    expect(day14.trialEndsAt).toEqual(trialEndsAt(user({ connectorTrialStartedAt: daysAgo(14) })));
  });
});

describe("foundingEmails", () => {
  it("parses a comma list case-insensitively and ignores blanks", () => {
    const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;
    const set = foundingEmails(env({ FOUNDING_EMAILS: " A@x.com, b@Y.com ,, " }));
    expect([...set]).toEqual(["a@x.com", "b@y.com"]);
    expect(foundingEmails(env({})).size).toBe(0);
  });
});

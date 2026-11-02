/**
 * Who gets to use the AI connector.
 *
 * The web app is free for everyone. The connector — the MCP endpoint that
 * lets Claude/ChatGPT read and write a workspace — is the paid part, with a
 * free trial that starts the moment someone creates their first connector
 * URL (so the trial measures the feature, not the sign-up). This is the ONE
 * place that rule lives; the gates (creating a connector URL, every MCP
 * request, the Settings and /connect screens) all call connectorAccess.
 *
 * Precedence: billing switched off (no Stripe key: dev, tests) → founding
 * users → a live Stripe subscription → the trial → blocked.
 */

export const CONNECTOR_TRIAL_DAYS = 14;

/** Shown on the landing page and Settings; the Stripe prices must match. */
export const PRICES = { monthly: 10, annual: 79 } as const;

/** The subset of the users row that entitlement reads. */
export type BillingFields = {
  email: string;
  subscriptionStatus: string | null;
  currentPeriodEnd: Date | null;
  connectorTrialStartedAt: Date | null;
};

export type ConnectorAccess =
  | {
      allowed: true;
      reason: "billing_disabled" | "founding" | "subscribed" | "trial";
      /** When the trial ends (trial only); null when no trial has started. */
      trialEndsAt: Date | null;
      /** Whole days of trial left (trial only). */
      daysLeft: number | null;
    }
  | {
      allowed: false;
      reason: "trial_expired" | "lapsed";
      trialEndsAt: Date | null;
      daysLeft: 0;
    };

/** Stripe statuses under which the customer is still being served. */
const SERVED_STATUSES = new Set(["active", "trialing", "past_due"]);

const DAY_MS = 24 * 60 * 60 * 1000;

/** Billing is on only when a Stripe key is configured. */
export function billingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

/**
 * Accounts that never pay: the owner and the people who used the product
 * before it had a price. A comma-separated env list, not a column, so no
 * production write is needed to grant it.
 */
export function foundingEmails(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env.FOUNDING_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function trialEndsAt(user: Pick<BillingFields, "connectorTrialStartedAt">): Date | null {
  return user.connectorTrialStartedAt
    ? new Date(user.connectorTrialStartedAt.getTime() + CONNECTOR_TRIAL_DAYS * DAY_MS)
    : null;
}

export function connectorAccess(
  user: BillingFields,
  now: Date = new Date(),
  opts: { billingEnabled?: boolean; founding?: Set<string> } = {},
): ConnectorAccess {
  const enabled = opts.billingEnabled ?? billingEnabled();
  if (!enabled) {
    return { allowed: true, reason: "billing_disabled", trialEndsAt: null, daysLeft: null };
  }
  const founding = opts.founding ?? foundingEmails();
  if (founding.has(user.email.toLowerCase())) {
    return { allowed: true, reason: "founding", trialEndsAt: null, daysLeft: null };
  }

  if (user.subscriptionStatus && SERVED_STATUSES.has(user.subscriptionStatus)) {
    // past_due: Stripe keeps retrying the card for a while. Keep serving
    // until the period they already paid for is actually over.
    const stillPaidFor =
      user.subscriptionStatus !== "past_due" ||
      !user.currentPeriodEnd ||
      user.currentPeriodEnd.getTime() > now.getTime();
    if (stillPaidFor) {
      return { allowed: true, reason: "subscribed", trialEndsAt: null, daysLeft: null };
    }
  }

  const ends = trialEndsAt(user);
  if (!ends) {
    // No connector URL yet, so no trial yet; creating one starts the clock.
    return { allowed: true, reason: "trial", trialEndsAt: null, daysLeft: CONNECTOR_TRIAL_DAYS };
  }
  if (ends.getTime() > now.getTime()) {
    return {
      allowed: true,
      reason: "trial",
      trialEndsAt: ends,
      daysLeft: Math.ceil((ends.getTime() - now.getTime()) / DAY_MS),
    };
  }
  return {
    allowed: false,
    reason: user.subscriptionStatus ? "lapsed" : "trial_expired",
    trialEndsAt: ends,
    daysLeft: 0,
  };
}

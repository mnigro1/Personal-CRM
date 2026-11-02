import Stripe from "stripe";
import type { SubscriptionState } from "@/db/billing";

/**
 * Stripe client and the one mapping from Stripe's objects to the columns we
 * keep. Null when no key is configured, so billing is simply off in dev and
 * tests (see lib/entitlement.ts billingEnabled).
 */

let client: Stripe | null | undefined;

export function stripeClient(): Stripe | null {
  if (client !== undefined) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  client = key
    ? new Stripe(key, { appInfo: { name: "Personal CRM" } })
    : null;
  return client;
}

export type Plan = "monthly" | "annual";

export function priceIdFor(plan: Plan): string | null {
  const id =
    plan === "annual"
      ? process.env.STRIPE_PRICE_ANNUAL
      : process.env.STRIPE_PRICE_MONTHLY;
  return id || null;
}

/**
 * What we store from a subscription. In the current API the period end
 * lives on the subscription items (all items share one on a plain
 * subscription), not on the subscription itself.
 */
export function subscriptionStateFrom(
  sub: Pick<Stripe.Subscription, "id" | "status"> & {
    items: { data: { current_period_end: number }[] };
  },
): SubscriptionState {
  const periodEnd = sub.items.data.reduce<number | null>(
    (latest, item) =>
      latest === null ? item.current_period_end : Math.max(latest, item.current_period_end),
    null,
  );
  return {
    subscriptionId: sub.id,
    status: sub.status,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
  };
}

/** Stripe hands back ids or expanded objects depending on the call. */
export function idOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

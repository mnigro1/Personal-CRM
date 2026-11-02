import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

/**
 * The webhook's copy of Stripe's subscription state, and the trial clock.
 * User-level like db/users.ts: billing belongs to the person, not to a
 * workspace. Stripe stays the source of truth; nothing here decides
 * entitlement — that is lib/entitlement.ts reading these columns.
 */

/** Start the connector trial if it hasn't started. Returns the start time. */
export async function startConnectorTrial(userId: string): Promise<Date> {
  const [updated] = await db
    .update(users)
    .set({ connectorTrialStartedAt: sql`now()` })
    .where(and(eq(users.id, userId), isNull(users.connectorTrialStartedAt)))
    .returning({ startedAt: users.connectorTrialStartedAt });
  if (updated?.startedAt) return updated.startedAt;
  const [existing] = await db
    .select({ startedAt: users.connectorTrialStartedAt })
    .from(users)
    .where(eq(users.id, userId));
  return existing?.startedAt ?? new Date();
}

export async function setStripeCustomer(userId: string, customerId: string) {
  await db
    .update(users)
    .set({ stripeCustomerId: customerId })
    .where(eq(users.id, userId));
}

export type SubscriptionState = {
  subscriptionId: string | null;
  status: string | null;
  currentPeriodEnd: Date | null;
};

/**
 * Record what Stripe says about a customer's subscription. Keyed by the
 * Stripe customer id, which is what every webhook event carries. Returns
 * false when no user owns that customer (an event for a customer created
 * outside the app, or a replay after account deletion) so the caller can
 * acknowledge it without pretending it did something.
 */
export async function applySubscriptionState(
  customerId: string,
  state: SubscriptionState,
): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({
      stripeSubscriptionId: state.subscriptionId,
      subscriptionStatus: state.status,
      currentPeriodEnd: state.currentPeriodEnd,
    })
    .where(eq(users.stripeCustomerId, customerId))
    .returning({ id: users.id });
  return rows.length > 0;
}

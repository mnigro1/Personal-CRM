/**
 * The billing columns: trial start is write-once, subscription state is
 * keyed by Stripe customer. Skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("billing columns (integration)", async () => {
  const { db } = await import("@/db");
  const { users } = await import("@/db/schema");
  const { applySubscriptionState, setStripeCustomer, startConnectorTrial } =
    await import("@/db/billing");

  const run = Date.now();
  let userId: string;

  beforeAll(async () => {
    const [u] = await db
      .insert(users)
      .values({ email: `billing-${run}@example.test` })
      .returning();
    userId = u.id;
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, userId));
  });

  it("starts the trial once and keeps the original start on later calls", async () => {
    const first = await startConnectorTrial(userId);
    await new Promise((r) => setTimeout(r, 20));
    const second = await startConnectorTrial(userId);
    expect(second.getTime()).toBe(first.getTime());
  });

  it("records subscription state by customer, and reports unknown customers", async () => {
    expect(
      await applySubscriptionState(`cus_unknown_${run}`, {
        subscriptionId: "sub_x",
        status: "active",
        currentPeriodEnd: null,
      }),
    ).toBe(false);

    await setStripeCustomer(userId, `cus_test_${run}`);
    const end = new Date("2027-01-01T00:00:00Z");
    expect(
      await applySubscriptionState(`cus_test_${run}`, {
        subscriptionId: `sub_test_${run}`,
        status: "active",
        currentPeriodEnd: end,
      }),
    ).toBe(true);

    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row.stripeSubscriptionId).toBe(`sub_test_${run}`);
    expect(row.subscriptionStatus).toBe("active");
    expect(row.currentPeriodEnd?.toISOString()).toBe(end.toISOString());
  });
});

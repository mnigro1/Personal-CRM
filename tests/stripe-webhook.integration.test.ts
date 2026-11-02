/**
 * The Stripe webhook: signature enforced, subscription events reduced to
 * one write keyed by customer, everything else acknowledged. Uses a dummy
 * key only to produce signatures — no network. Skipped without DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("stripe webhook (integration)", async () => {
  // Must be set before the route (and its cached Stripe client) is loaded.
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy_for_signatures_only";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_dummy";

  const { db } = await import("@/db");
  const { users } = await import("@/db/schema");
  const { setStripeCustomer } = await import("@/db/billing");
  const { POST } = await import("@/app/api/stripe/webhook/route");
  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const run = Date.now();
  const customerId = `cus_webhook_${run}`;
  let userId: string;

  const signedRequest = (payload: string, secret = process.env.STRIPE_WEBHOOK_SECRET!) =>
    new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": stripe.webhooks.generateTestHeaderString({ payload, secret }),
      },
      body: payload,
    });

  const subscriptionEvent = (status: string, periodEnd: number) =>
    JSON.stringify({
      id: `evt_${run}_${status}`,
      object: "event",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: `sub_${run}`,
          object: "subscription",
          customer: customerId,
          status,
          items: { data: [{ current_period_end: periodEnd }] },
        },
      },
    });

  beforeAll(async () => {
    const [u] = await db
      .insert(users)
      .values({ email: `webhook-${run}@example.test` })
      .returning();
    userId = u.id;
    await setStripeCustomer(userId, customerId);
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, userId));
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  it("rejects a bad signature and a missing one", async () => {
    const payload = subscriptionEvent("active", 1_800_000_000);
    expect((await POST(signedRequest(payload, "whsec_wrong"))).status).toBe(400);
    const unsigned = new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      body: payload,
    });
    expect((await POST(unsigned)).status).toBe(400);
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row.subscriptionStatus).toBeNull();
  });

  it("mirrors a subscription event onto the customer's user", async () => {
    const res = await POST(signedRequest(subscriptionEvent("active", 1_800_000_000)));
    expect(res.status).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    expect(row.subscriptionStatus).toBe("active");
    expect(row.stripeSubscriptionId).toBe(`sub_${run}`);
    expect(row.currentPeriodEnd?.toISOString()).toBe(new Date(1_800_000_000 * 1000).toISOString());

    // A later cancellation replaces it; the write is idempotent.
    await POST(signedRequest(subscriptionEvent("canceled", 1_800_000_000)));
    await POST(signedRequest(subscriptionEvent("canceled", 1_800_000_000)));
    const [after] = await db.select().from(users).where(eq(users.id, userId));
    expect(after.subscriptionStatus).toBe("canceled");
  });

  it("acknowledges events it doesn't handle and unknown customers", async () => {
    const other = JSON.stringify({ id: "evt_x", object: "event", type: "invoice.paid", data: { object: {} } });
    expect((await POST(signedRequest(other))).status).toBe(200);
    const unknown = JSON.stringify({
      id: "evt_y",
      object: "event",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_zzz", object: "subscription", customer: "cus_nobody", status: "canceled", items: { data: [] } } },
    });
    expect((await POST(signedRequest(unknown))).status).toBe(200);
  });
});

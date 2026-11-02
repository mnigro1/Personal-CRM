import type Stripe from "stripe";
import { applySubscriptionState } from "@/db/billing";
import { idOf, stripeClient, subscriptionStateFrom } from "@/lib/stripe";

/**
 * Stripe → us. Every event is signature-checked against the raw body, then
 * reduced to one write: "this customer's subscription is now in this
 * state". Handlers are idempotent, so Stripe's retries and out-of-order
 * delivery are harmless, and an event for a customer we don't know is
 * acknowledged rather than retried forever.
 */

export const maxDuration = 30;

export async function POST(req: Request) {
  const stripe = stripeClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    return Response.json({ error: "Billing is not configured" }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    // The raw text, not parsed JSON: the signature covers the exact bytes.
    event = await stripe.webhooks.constructEventAsync(await req.text(), signature, secret);
  } catch (err) {
    console.error("stripe webhook signature failed", err);
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const customerId = idOf(session.customer);
      const subscriptionId = idOf(session.subscription);
      if (customerId && subscriptionId) {
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        await applySubscriptionState(customerId, subscriptionStateFrom(sub));
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const customerId = idOf(sub.customer);
      if (customerId) {
        const known = await applySubscriptionState(customerId, subscriptionStateFrom(sub));
        if (!known) console.warn("stripe webhook for unknown customer", customerId);
      }
      break;
    }
    default:
      // Not subscribed to anything else; acknowledge so Stripe stops sending.
      break;
  }

  return Response.json({ received: true });
}

import { headers } from "next/headers";
import { prisma } from "@fantasy/db";
import { getStripe } from "@/lib/stripe";
import type Stripe from "stripe";
import { log } from "@fantasy/logging";

export const dynamic = "force-dynamic";

async function syncFromStripeSubscription(
  userId: string,
  customerId: string,
  sub: Stripe.Subscription,
): Promise<void> {
  await prisma.billingSubscription.upsert({
    where: { userId },
    create: {
      userId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      status: sub.status,
      currentPeriodEnd: sub.current_period_end
        ? new Date(sub.current_period_end * 1000)
        : null,
      cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
    },
    update: {
      stripeSubscriptionId: sub.id,
      status: sub.status,
      currentPeriodEnd: sub.current_period_end
        ? new Date(sub.current_period_end * 1000)
        : null,
      cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
    },
  });
}

export async function POST(req: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return new Response("STRIPE_WEBHOOK_SECRET not set", { status: 500 });
  }

  const body = await req.text();
  const headerList = await headers();
  const sig = headerList.get("stripe-signature");
  if (!sig) {
    return new Response("Missing stripe-signature", { status: 400 });
  }

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  const already = await prisma.stripeEventLog.findUnique({ where: { eventId: event.id } });
  if (already) {
    log.info("stripe_webhook_duplicate", { eventId: event.id, type: event.type });
    return new Response("duplicate", { status: 200 });
  }
  try {
    await prisma.stripeEventLog.create({ data: { eventId: event.id } });
  } catch {
    log.info("stripe_webhook_duplicate_race", { eventId: event.id, type: event.type });
    return new Response("duplicate", { status: 200 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const s = event.data.object as Stripe.Checkout.Session;
      const userId = s.metadata?.userId ?? s.client_reference_id;
      if (userId && s.customer && s.subscription) {
        const sub = await stripe.subscriptions.retrieve(s.subscription as string);
        await syncFromStripeSubscription(userId, s.customer as string, sub);
      } else {
        log.warn("stripe_checkout_missing_mapping", {
          eventId: event.id,
          hasUserId: Boolean(userId),
          hasCustomer: Boolean(s.customer),
          hasSubscription: Boolean(s.subscription),
        });
      }
    }

    if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = sub.customer as string;
      const row = await prisma.billingSubscription.findUnique({
        where: { stripeCustomerId: customerId },
      });
      if (row) {
        await prisma.billingSubscription.update({
          where: { id: row.id },
          data: {
            stripeSubscriptionId: sub.id,
            status: sub.status,
            currentPeriodEnd: sub.current_period_end
              ? new Date(sub.current_period_end * 1000)
              : null,
            cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
          },
        });
      } else {
        log.warn("stripe_subscription_missing_customer_mapping", {
          eventId: event.id,
          customerId,
          type: event.type,
        });
      }
    }
  } catch (e) {
    log.error("stripe_webhook_handler_failed", {
      eventId: event.id,
      type: event.type,
      err: e instanceof Error ? e.message : String(e),
    });
    return new Response("handler error", { status: 500 });
  }

  log.info("stripe_webhook_processed", { eventId: event.id, type: event.type });
  return new Response("ok", { status: 200 });
}

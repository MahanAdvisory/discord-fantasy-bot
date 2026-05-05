import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { prisma } from "@fantasy/db";
import { getStripe } from "@/lib/stripe";

export async function POST() {
  const session = await getServerSession(authOptions);
  const discordId = session?.user && "discordId" in session.user ? session.user.discordId : undefined;
  if (!discordId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { discordUserId: discordId } });
  if (!user) {
    return Response.json({ error: "User not found" }, { status: 400 });
  }

  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    return Response.json({ error: "STRIPE_PRICE_ID is not configured" }, { status: 500 });
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const stripe = getStripe();

  const checkout = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${base}/?subscription=success`,
    cancel_url: `${base}/?subscription=cancel`,
    metadata: { userId: user.id },
    client_reference_id: user.id,
  });

  return Response.json({ url: checkout.url });
}

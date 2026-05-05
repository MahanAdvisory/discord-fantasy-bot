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

  const user = await prisma.user.findUnique({
    where: { discordUserId: discordId },
    include: { billingSubscription: true },
  });

  if (!user?.billingSubscription) {
    return Response.json({ error: "No billing profile yet" }, { status: 400 });
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const stripe = getStripe();
  const portal = await stripe.billingPortal.sessions.create({
    customer: user.billingSubscription.stripeCustomerId,
    return_url: `${base}/`,
  });

  return Response.json({ url: portal.url });
}

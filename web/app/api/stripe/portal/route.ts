import { prisma } from "@fantasy/db";
import { getStripe } from "@/lib/stripe";
import { requireSessionUser } from "@/lib/sessionUser";

export async function POST() {
  const { user: sessionUser } = await requireSessionUser();
  if (!sessionUser) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
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

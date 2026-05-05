import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { prisma } from "@fantasy/db";

export async function GET() {
  const session = await getServerSession(authOptions);
  const discordId = session?.user && "discordId" in session.user ? session.user.discordId : undefined;
  if (!discordId) {
    return Response.json({ authenticated: false }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { discordUserId: discordId },
    include: { billingSubscription: true },
  });

  const sub = user?.billingSubscription;
  const active = sub ? ["active", "trialing"].includes(sub.status) : false;

  return Response.json({
    authenticated: true,
    subscription: sub
      ? {
          status: sub.status,
          currentPeriodEnd: sub.currentPeriodEnd,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        }
      : null,
    entitlements: { active },
  });
}

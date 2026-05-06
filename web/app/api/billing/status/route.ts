import { prisma } from "@fantasy/db";
import { requireSessionUser } from "@/lib/sessionUser";

export async function GET() {
  const { user: sessionUser } = await requireSessionUser();
  if (!sessionUser) {
    return Response.json({ authenticated: false }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    include: { billingSubscription: true },
  });

  const sub = user?.billingSubscription;
  const active = sub ? ["active", "trialing"].includes(sub.status) : false;
  const now = Date.now();
  const inGrace =
    Boolean(sub?.currentPeriodEnd) &&
    Boolean(sub?.cancelAtPeriodEnd) &&
    (sub?.currentPeriodEnd?.getTime() ?? 0) > now;

  return Response.json({
    authenticated: true,
    linkedMethods: {
      email: Boolean(user?.email),
      discord: Boolean(user?.discordUserId),
      google: Boolean(user?.googleUserId),
      sleeper: Boolean(user?.sleeperUserId),
    },
    subscription: sub
      ? {
          status: sub.status,
          currentPeriodEnd: sub.currentPeriodEnd,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          inGracePeriod: inGrace,
        }
      : null,
    entitlements: { active },
  });
}

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { buildSleeperDashboardSnapshot } from "@fantasy/services/dashboardSnapshot";
import { prisma } from "@fantasy/db";

export async function GET() {
  const session = await getServerSession(authOptions);
  const discordId = session?.user && "discordId" in session.user ? session.user.discordId : undefined;
  if (!discordId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { discordUserId: discordId },
  });

  if (!user?.sleeperUserId) {
    return Response.json(
      {
        error: "no_sleeper",
        message:
          "Link your Sleeper account with **/link** in Discord first (same Discord login). Then refresh this page.",
      },
      { status: 400 },
    );
  }

  const snapshot = await buildSleeperDashboardSnapshot(user.sleeperUserId, user.sleeperUsername);
  return Response.json(snapshot);
}

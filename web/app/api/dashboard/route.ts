import { buildSleeperDashboardSnapshot } from "@fantasy/services/dashboardSnapshot";
import { requireSessionUser } from "@/lib/sessionUser";

export async function GET() {
  const { user } = await requireSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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

import { buildSleeperDashboardSnapshot } from "@fantasy/services/dashboardSnapshot";
import {
  appendEspnLeaguesToDashboardSnapshot,
  buildEspnOnlyDashboardSnapshot,
} from "@fantasy/services/espnDashboard";
import { espnLeagueIdsFromJson } from "@fantasy/espn/linkedLeagues";
import { requireSessionUser } from "@/lib/sessionUser";

export async function GET() {
  const { user } = await requireSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const espnIds = espnLeagueIdsFromJson(user.espnLeagueIds);

  if (!user.sleeperUserId) {
    if (!espnIds.length) {
      return Response.json(
        {
          error: "no_sleeper",
          message:
            "Link your Sleeper account from the web Help page (or /link in Discord), or add at least one ESPN league on the Help page, then refresh.",
        },
        { status: 400 },
      );
    }
    const snapshot = await buildEspnOnlyDashboardSnapshot(user);
    return Response.json(snapshot);
  }

  const snapshot = await buildSleeperDashboardSnapshot(user.sleeperUserId, user.sleeperUsername);
  await appendEspnLeaguesToDashboardSnapshot(snapshot, user);
  return Response.json(snapshot);
}

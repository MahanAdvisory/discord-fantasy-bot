import { runLineupCheckAcrossLeagues } from "@fantasy/services/lineupCheck";
import { getNflState, getUserLeagues } from "@fantasy/sleeper/client";
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
          "Link your Sleeper account with /link in Discord first (same Discord login). Then refresh this page.",
      },
      { status: 400 },
    );
  }

  const nfl = await getNflState();
  const season = nfl.league_season ?? nfl.season;
  const leagues = await getUserLeagues(user.sleeperUserId, season);
  const report = await runLineupCheckAcrossLeagues(
    user.sleeperUserId,
    leagues.map((l) => l.league_id),
  );

  return Response.json({
    evaluated: report.evaluated,
    noIssues: report.noIssues,
    issues: report.issueEntries.filter((e) => e.kind !== "upgrade").map((e) => e.text),
    upgrades: report.upgrades,
  });
}

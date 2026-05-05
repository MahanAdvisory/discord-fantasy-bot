import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { prisma } from "@fantasy/db";
import { runLineupCheckAcrossLeagues } from "@fantasy/services/lineupCheck";
import { getNflState, getUserLeagues } from "@fantasy/sleeper/client";

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
    issues: report.issueEntries.map((e) => e.text),
  });
}

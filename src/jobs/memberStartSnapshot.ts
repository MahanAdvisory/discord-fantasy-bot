import { prisma } from "../db.js";
import { log } from "../logging.js";
import { getLeagueRosters, getNflState, getUserLeagues } from "../sleeper/client.js";
import { ALL_LEAGUES_SCOPE } from "../domain/notifications.js";
import { snapshotMemberLeagueStarters } from "../services/stats/vorp.js";

/**
 * Snapshot starters/rostered players across member-universe Sleeper leagues
 * (subscription scopes + linked sleeper users) for VORP start-rate.
 */
export async function runMemberStartSnapshot(): Promise<{ leagues: number; rows: number }> {
  const nfl = await getNflState();
  const season = String(nfl.season);
  const week = Number(nfl.week);
  if (!Number.isFinite(week) || week < 1) {
    log.info("member_start_snapshot_skip", { reason: "invalid_week", week: nfl.week });
    return { leagues: 0, rows: 0 };
  }

  const leagueIds = new Set<string>();

  const subs = await prisma.notificationSubscription.findMany({
    where: { provider: "sleeper" },
    select: { sleeperLeagueScope: true, userId: true },
  });
  const usersNeedingAll = new Set<string>();
  for (const s of subs) {
    if (s.sleeperLeagueScope === ALL_LEAGUES_SCOPE) {
      usersNeedingAll.add(s.userId);
    } else if (s.sleeperLeagueScope && s.sleeperLeagueScope !== "espn") {
      leagueIds.add(s.sleeperLeagueScope);
    }
  }

  if (usersNeedingAll.size) {
    const users = await prisma.user.findMany({
      where: { id: { in: [...usersNeedingAll] }, sleeperUserId: { not: null } },
      select: { sleeperUserId: true },
    });
    for (const u of users) {
      if (!u.sleeperUserId) continue;
      const leagues = await getUserLeagues(u.sleeperUserId, season).catch(() => []);
      for (const l of leagues) leagueIds.add(l.league_id);
    }
  }

  const linked = await prisma.user.findMany({
    where: { sleeperUserId: { not: null } },
    select: { sleeperUserId: true },
  });
  for (const u of linked) {
    if (!u.sleeperUserId) continue;
    const leagues = await getUserLeagues(u.sleeperUserId, season).catch(() => []);
    for (const l of leagues) leagueIds.add(l.league_id);
  }

  let rows = 0;
  let leagues = 0;
  for (const leagueId of leagueIds) {
    const rosters = await getLeagueRosters(leagueId).catch(() => []);
    if (!rosters.length) continue;
    const n = await snapshotMemberLeagueStarters({
      leagueId,
      season,
      week,
      rosters: rosters.map((r) => ({
        roster_id: r.roster_id,
        starters: r.starters,
        players: r.players,
      })),
    });
    rows += n;
    leagues += 1;
  }

  log.info("member_start_snapshot_done", { season, week, leagues, rows });
  return { leagues, rows };
}

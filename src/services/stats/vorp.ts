import { prisma } from "../../db.js";

const MEMBER_LEAGUE_THRESHOLD = 50;

export async function computeStartRates(args: {
  season: string;
  week: number;
}): Promise<Map<string, { startRate: number; source: "member" | "fantasypros_fallback"; started: number; rostered: number }>> {
  const distinctLeagues = await prisma.sleeperPlayerWeekStart.findMany({
    where: { season: args.season, week: args.week },
    distinct: ["leagueId"],
    select: { leagueId: true },
  });
  const out = new Map<
    string,
    { startRate: number; source: "member" | "fantasypros_fallback"; started: number; rostered: number }
  >();

  if (distinctLeagues.length >= MEMBER_LEAGUE_THRESHOLD) {
    const rostered = await prisma.sleeperPlayerWeekStart.groupBy({
      by: ["sleeperPlayerId"],
      where: { season: args.season, week: args.week, wasRostered: true },
      _count: { _all: true },
    });
    const started = await prisma.sleeperPlayerWeekStart.groupBy({
      by: ["sleeperPlayerId"],
      where: { season: args.season, week: args.week, wasStarted: true },
      _count: { _all: true },
    });
    const startedMap = new Map(started.map((r) => [r.sleeperPlayerId, r._count._all]));
    for (const r of rostered) {
      const s = startedMap.get(r.sleeperPlayerId) ?? 0;
      const tot = r._count._all;
      out.set(r.sleeperPlayerId, {
        startRate: tot > 0 ? s / tot : 0,
        source: "member",
        started: s,
        rostered: tot,
      });
    }
    return out;
  }

  const stats = await prisma.nflPlayerWeekStat.findMany({
    where: {
      season: Number(args.season),
      week: args.week,
      grain: "week",
      fantasyProsRosterPct: { not: null },
      sleeperPlayerId: { not: null },
    },
    select: { sleeperPlayerId: true, fantasyProsRosterPct: true },
  });
  for (const s of stats) {
    if (!s.sleeperPlayerId || s.fantasyProsRosterPct == null) continue;
    out.set(s.sleeperPlayerId, {
      startRate: Math.min(1, Math.max(0, s.fantasyProsRosterPct / 100)),
      source: "fantasypros_fallback",
      started: 0,
      rostered: 0,
    });
  }
  return out;
}

export function replacementFloorIndex(startCount: number, teams = 12): number {
  return Math.max(0, startCount * teams - 1);
}

export function pickReplacementPoints(
  sortedDesc: Array<{ sleeperPlayerId: string | null; fpts: number; startRate: number }>,
  opts: { startCount: number; teams?: number; minRate?: number; maxRate?: number },
): number {
  const minRate = opts.minRate ?? 0.3;
  const maxRate = opts.maxRate ?? 0.8;
  const floorIdx = replacementFloorIndex(opts.startCount, opts.teams ?? 12);
  const floorPts = sortedDesc[floorIdx]?.fpts ?? sortedDesc[sortedDesc.length - 1]?.fpts ?? 0;
  const pool = sortedDesc.filter((p) => p.startRate > minRate && p.startRate < maxRate && p.fpts < floorPts);
  if (!pool.length) {
    return sortedDesc[floorIdx + 1]?.fpts ?? floorPts * 0.85;
  }
  return Math.max(...pool.map((p) => p.fpts));
}

export async function snapshotMemberLeagueStarters(args: {
  leagueId: string;
  season: string;
  week: number;
  rosters: Array<{
    roster_id: number;
    starters?: string[] | null;
    players?: string[] | null;
  }>;
  playerPositions?: Map<string, string>;
}): Promise<number> {
  let n = 0;
  for (const r of args.rosters) {
    const starters = new Set((r.starters ?? []).filter((id) => id && id !== "0"));
    const players = new Set((r.players ?? []).filter((id) => id && id !== "0"));
    for (const playerId of players) {
      await prisma.sleeperPlayerWeekStart.upsert({
        where: {
          leagueId_season_week_sleeperPlayerId: {
            leagueId: args.leagueId,
            season: args.season,
            week: args.week,
            sleeperPlayerId: playerId,
          },
        },
        create: {
          leagueId: args.leagueId,
          season: args.season,
          week: args.week,
          sleeperPlayerId: playerId,
          rosterId: r.roster_id,
          wasStarted: starters.has(playerId),
          wasRostered: true,
          position: args.playerPositions?.get(playerId) ?? null,
        },
        update: {
          wasStarted: starters.has(playerId),
          wasRostered: true,
          rosterId: r.roster_id,
          position: args.playerPositions?.get(playerId) ?? null,
        },
      });
      n++;
    }
  }
  return n;
}

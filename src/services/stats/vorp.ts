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

export type ReplacementLevel = {
  /** Season (or period) FPTS for the replacement-level player. */
  fpts: number;
  /** Games that FPTS spans (for prorating VORP to a player's active weeks). */
  games: number;
  fptsPerGame: number;
};

/**
 * Pick a replacement FPTS level from start-rate pool below the starter cutoff.
 * Callers should prorate with `fptsPerGame * playerGames` so injured / inactive weeks
 * don't charge a full-season replacement cost.
 */
export function pickReplacementLevel(
  sortedDesc: Array<{ sleeperPlayerId: string | null; fpts: number; games: number; startRate: number }>,
  opts: { startCount: number; teams?: number; minRate?: number; maxRate?: number },
): ReplacementLevel {
  const minRate = opts.minRate ?? 0.3;
  const maxRate = opts.maxRate ?? 0.8;
  const floorIdx = replacementFloorIndex(opts.startCount, opts.teams ?? 12);
  const floor = sortedDesc[floorIdx] ?? sortedDesc[sortedDesc.length - 1];
  const floorPts = floor?.fpts ?? 0;
  const pool = sortedDesc.filter((p) => p.startRate > minRate && p.startRate < maxRate && p.fpts < floorPts);
  const pick =
    pool.length > 0
      ? pool.reduce((best, p) => (p.fpts > best.fpts ? p : best))
      : sortedDesc[floorIdx + 1] ?? {
          sleeperPlayerId: null,
          fpts: floorPts * 0.85,
          games: floor?.games ?? 1,
          startRate: 0,
        };
  const games = Math.max(1, pick.games || floor?.games || 1);
  const fpts = pick.fpts;
  return { fpts, games, fptsPerGame: fpts / games };
}

/** @deprecated prefer pickReplacementLevel */
export function pickReplacementPoints(
  sortedDesc: Array<{ sleeperPlayerId: string | null; fpts: number; startRate: number }>,
  opts: { startCount: number; teams?: number; minRate?: number; maxRate?: number },
): number {
  return pickReplacementLevel(
    sortedDesc.map((p) => ({ ...p, games: 1 })),
    opts,
  ).fpts;
}

/** VORP = player FPTS − (replacement FPTS/G × player active games). */
export function vorpOverActiveGames(playerFpts: number, playerGames: number, replacement: ReplacementLevel): number {
  const g = Math.max(0, playerGames);
  return playerFpts - replacement.fptsPerGame * g;
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

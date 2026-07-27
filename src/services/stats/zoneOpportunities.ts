import { prisma } from "../../db.js";

export const ZONE_RED_MAX = 20;
export const ZONE_GREEN_MAX = 10;

export type ZoneOpportunityPlayer = {
  playerKey: string;
  playerName: string | null;
  peakSeason: number;
  peakTeam: string | null;
  peakPosition: string | null;
  peakGames: number;
  peakOppsG: number;
  peakCarriesG: number;
  peakTargetsG: number;
  peakRzG: number;
  peakGzG: number;
  peakRzCarriesG: number;
  peakRzTargetsG: number;
  peakGzCarriesG: number;
  peakGzTargetsG: number;
  avgOppsG: number;
  avgCarriesG: number;
  avgTargetsG: number;
  avgRzG: number;
  avgGzG: number;
  avgRzCarriesG: number;
  avgRzTargetsG: number;
  avgGzCarriesG: number;
  avgGzTargetsG: number;
  windowGames: number;
  windowOpps: number;
};

type SeasonRow = {
  playerKey: string;
  playerName: string | null;
  team: string | null;
  position: string | null;
  season: number;
  games: number;
  carries: number;
  targets: number;
  rzCarries: number;
  rzTargets: number;
  gzCarries: number;
  gzTargets: number;
};

function perGame(total: number, games: number): number {
  if (games <= 0) return 0;
  return Math.round((total / games) * 100) / 100;
}

/**
 * Peak season vs multi-season average opportunity rates for skill players.
 * Uses season-grain nfl_player_week_stats (including PBP-derived RZ/GZ columns).
 */
export async function queryZoneOpportunityExploration(args: {
  endSeason: number;
  years?: number;
  position?: string;
  minWindowOpps?: number;
  minGamesPeak?: number;
  q?: string | null;
  limit?: number;
  sort?: string;
  dir?: "asc" | "desc";
}): Promise<{
  players: ZoneOpportunityPlayer[];
  total: number;
  seasons: number[];
  definitions: {
    opportunities: string;
    redZone: string;
    greenZone: string;
    peakSeason: string;
    avgWindow: string;
  };
}> {
  const years = Math.min(5, Math.max(1, args.years ?? 3));
  const endSeason = args.endSeason;
  const seasons = Array.from({ length: years }, (_, i) => endSeason - years + i + 1);
  const position = (args.position ?? "RB").toUpperCase();
  const minWindowOpps = args.minWindowOpps ?? 80;
  const minGamesPeak = args.minGamesPeak ?? 8;
  const limit = Math.min(300, Math.max(1, args.limit ?? 100));
  const q = args.q?.trim() ?? "";
  const sort = (args.sort ?? "peak_opps_g").toLowerCase();
  const dirMul = args.dir === "asc" ? 1 : -1;

  const positionFilter =
    position === "FLEX"
      ? { position: { in: ["RB", "WR", "TE"] } }
      : position === "ALL" || position === "SUPERFLEX"
        ? { position: { in: ["QB", "RB", "WR", "TE"] } }
        : { position };

  const rows = await prisma.nflPlayerWeekStat.findMany({
    where: {
      season: { in: seasons },
      grain: "season",
      week: -1,
      seasonType: { in: ["REG", "reg", "REG+POST"] },
      ...positionFilter,
      ...(q
        ? {
            OR: [
              { playerName: { contains: q, mode: "insensitive" as const } },
              { team: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    select: {
      playerKey: true,
      playerName: true,
      team: true,
      position: true,
      season: true,
      gamesPlayed: true,
      carries: true,
      targets: true,
      redZoneCarries: true,
      redZoneTargets: true,
      greenZoneCarries: true,
      greenZoneTargets: true,
    },
  });

  const byPlayer = new Map<string, SeasonRow[]>();
  for (const row of rows) {
    const seasonRow: SeasonRow = {
      playerKey: row.playerKey,
      playerName: row.playerName,
      team: row.team,
      position: row.position,
      season: row.season,
      games: Math.max(0, row.gamesPlayed || 0),
      carries: row.carries ?? 0,
      targets: row.targets ?? 0,
      rzCarries: row.redZoneCarries ?? 0,
      rzTargets: row.redZoneTargets ?? 0,
      gzCarries: row.greenZoneCarries ?? 0,
      gzTargets: row.greenZoneTargets ?? 0,
    };
    const list = byPlayer.get(row.playerKey) ?? [];
    list.push(seasonRow);
    byPlayer.set(row.playerKey, list);
  }

  const players: ZoneOpportunityPlayer[] = [];
  for (const [, group] of byPlayer) {
    const windowGames = group.reduce((sum, r) => sum + r.games, 0);
    const windowOpps = group.reduce((sum, r) => sum + r.carries + r.targets, 0);
    if (windowGames <= 0 || windowOpps < minWindowOpps) continue;

    const withRates = group.map((r) => {
      const opps = r.carries + r.targets;
      const games = Math.max(1, r.games);
      return {
        ...r,
        opps,
        oppsG: opps / games,
      };
    });

    const eligible = withRates.filter((r) => r.games >= minGamesPeak);
    const peakSrc = eligible.length ? eligible : withRates;
    const peak = [...peakSrc].sort((a, b) => b.oppsG - a.oppsG)[0]!;

    const sum = (pick: (r: SeasonRow) => number) => group.reduce((s, r) => s + pick(r), 0);

    players.push({
      playerKey: peak.playerKey,
      playerName: peak.playerName,
      peakSeason: peak.season,
      peakTeam: peak.team,
      peakPosition: peak.position,
      peakGames: peak.games,
      peakOppsG: perGame(peak.carries + peak.targets, peak.games),
      peakCarriesG: perGame(peak.carries, peak.games),
      peakTargetsG: perGame(peak.targets, peak.games),
      peakRzG: perGame(peak.rzCarries + peak.rzTargets, peak.games),
      peakGzG: perGame(peak.gzCarries + peak.gzTargets, peak.games),
      peakRzCarriesG: perGame(peak.rzCarries, peak.games),
      peakRzTargetsG: perGame(peak.rzTargets, peak.games),
      peakGzCarriesG: perGame(peak.gzCarries, peak.games),
      peakGzTargetsG: perGame(peak.gzTargets, peak.games),
      avgOppsG: perGame(windowOpps, windowGames),
      avgCarriesG: perGame(sum((r) => r.carries), windowGames),
      avgTargetsG: perGame(sum((r) => r.targets), windowGames),
      avgRzG: perGame(sum((r) => r.rzCarries + r.rzTargets), windowGames),
      avgGzG: perGame(sum((r) => r.gzCarries + r.gzTargets), windowGames),
      avgRzCarriesG: perGame(sum((r) => r.rzCarries), windowGames),
      avgRzTargetsG: perGame(sum((r) => r.rzTargets), windowGames),
      avgGzCarriesG: perGame(sum((r) => r.gzCarries), windowGames),
      avgGzTargetsG: perGame(sum((r) => r.gzTargets), windowGames),
      windowGames,
      windowOpps,
    });
  }

  const sortValue = (p: ZoneOpportunityPlayer): number => {
    switch (sort) {
      case "avg_opps_g":
        return p.avgOppsG;
      case "peak_carries_g":
        return p.peakCarriesG;
      case "avg_carries_g":
        return p.avgCarriesG;
      case "peak_targets_g":
        return p.peakTargetsG;
      case "avg_targets_g":
        return p.avgTargetsG;
      case "peak_rz_g":
        return p.peakRzG;
      case "avg_rz_g":
        return p.avgRzG;
      case "peak_gz_g":
        return p.peakGzG;
      case "avg_gz_g":
        return p.avgGzG;
      case "peak_opps_g":
      default:
        return p.peakOppsG;
    }
  };

  players.sort((a, b) => {
    const diff = (sortValue(a) - sortValue(b)) * dirMul;
    if (diff !== 0) return diff;
    return b.avgOppsG - a.avgOppsG;
  });

  return {
    players: players.slice(0, limit),
    total: players.length,
    seasons,
    definitions: {
      opportunities: "carries + targets",
      redZone: `yardline_100 <= ${ZONE_RED_MAX}`,
      greenZone: `yardline_100 <= ${ZONE_GREEN_MAX}`,
      peakSeason: `highest opps/game season with >= ${minGamesPeak} games (else best available)`,
      avgWindow: `total opps / total games across ${seasons[0]}-${seasons[seasons.length - 1]}`,
    },
  };
}

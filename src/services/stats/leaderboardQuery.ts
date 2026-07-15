import { prisma } from "../../db.js";
import {
  DEFAULT_SCORING,
  scoreBox,
  scoreExpected,
  type ScoringPreset,
  type ReceptionScoring,
} from "../../domain/fantasyScoring.js";
import {
  buildWeeklyReplacementMap,
  computeStartRates,
  pickReplacementLevel,
  pickReplacementPoints,
  vorpFromWeeklyScores,
} from "./vorp.js";
import type { Prisma } from "@prisma/client";

export const POS_START_COUNT: Record<string, number> = {
  QB: 1,
  RB: 2,
  WR: 3,
  TE: 1,
  FLEX: 3,
  SUPERFLEX: 1,
};

const SKILL_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
const FLEX_POSITIONS = ["RB", "WR", "TE"] as const;

export type LeaderboardSortKey =
  | "fpts"
  | "fpts_g"
  | "xfp"
  | "fpoe"
  | "vorp"
  | "g"
  | "tgt"
  | "rec"
  | "rec_yds"
  | "rec_td"
  | "att"
  | "rush_yds"
  | "rush_td"
  | "pass_yds"
  | "pass_td"
  | "int"
  | "cmp"
  | "tgt_pct"
  | "tprr"
  | "yprr"
  | "routes"
  | "route_pct"
  | "snap_pct"
  | "snaps"
  | "catch_pct"
  | "adot"
  | "air_yds"
  | "yac"
  | "racr"
  | "wopr"
  | "rush_epa"
  | "rec_epa"
  | "start_pct"
  | "pos"
  | "player"
  | "team";

export type StatsPlayerRow = {
  rank: number;
  playerKey: string;
  sleeperPlayerId: string | null;
  playerName: string | null;
  team: string | null;
  position: string | null;
  games: number;
  fpts: number;
  fptsPerGame: number;
  xfp: number | null;
  fpoe: number | null;
  targetShare: number | null;
  targetsPerRoute: number | null;
  yprr: number | null;
  offenseSnapPct: number | null;
  offenseSnaps: number | null;
  routesRun: number | null;
  routePct: number | null;
  catchRate: number | null;
  catchRateExp: number | null;
  adot: number | null;
  airYards: number | null;
  yac: number | null;
  racr: number | null;
  wopr: number | null;
  rushingEpa: number | null;
  receivingEpa: number | null;
  startRate: number | null;
  startRateSource: string | null;
  rosterPct: number | null;
  vorp: number | null;
  box: {
    completions: number | null;
    attempts: number | null;
    passingYards: number | null;
    passingTds: number | null;
    interceptions: number | null;
    carries: number | null;
    rushingYards: number | null;
    rushingTds: number | null;
    targets: number | null;
    receptions: number | null;
    receivingYards: number | null;
    receivingTds: number | null;
  };
};

export function positionFilter(position: string): Prisma.NflPlayerWeekStatWhereInput {
  const p = position.toUpperCase();
  if (p === "FLEX") return { position: { in: [...FLEX_POSITIONS] } };
  if (p === "SUPERFLEX" || p === "ALL") return { position: { in: [...SKILL_POSITIONS] } };
  return { position: p };
}

export function scoringFromOptions(opts: {
  scoring?: string | null;
  passTd?: number | null;
  tePremium?: boolean | number | null;
}): ScoringPreset {
  const receptionsRaw = (opts.scoring ?? "ppr").toLowerCase();
  const receptions: ReceptionScoring =
    receptionsRaw === "standard" || receptionsRaw === "std"
      ? "standard"
      : receptionsRaw === "half" || receptionsRaw === "half_ppr"
        ? "half_ppr"
        : "ppr";
  const passTd: 4 | 6 = Number(opts.passTd) === 6 ? 6 : 4;
  const tePrem = opts.tePremium;
  const tePremium = tePrem === true || tePrem === 1 || tePrem === 0.5 ? 0.5 : typeof tePrem === "number" ? tePrem : 0;
  return { ...DEFAULT_SCORING, receptions, passTd, tePremium };
}

function sortValue(row: StatsPlayerRow, sort: string): number | string {
  switch (sort) {
    case "fpts_g":
      return row.fptsPerGame;
    case "g":
      return row.games;
    case "tgt_pct":
      return row.targetShare ?? -Infinity;
    case "tprr":
      return row.targetsPerRoute ?? -Infinity;
    case "yprr":
      return row.yprr ?? -Infinity;
    case "routes":
      return row.routesRun ?? -Infinity;
    case "route_pct":
      return row.routePct ?? -Infinity;
    case "snap_pct":
      return row.offenseSnapPct ?? -Infinity;
    case "snaps":
      return row.offenseSnaps ?? -Infinity;
    case "air_yds":
      return row.airYards ?? -Infinity;
    case "catch_pct":
      return row.catchRate ?? -Infinity;
    case "start_pct":
      return row.startRate ?? -Infinity;
    case "rush_epa":
      return row.rushingEpa ?? -Infinity;
    case "rec_epa":
      return row.receivingEpa ?? -Infinity;
    case "pos":
      return row.position ?? "";
    case "player":
      return (row.playerName ?? "").toLowerCase();
    case "team":
      return row.team ?? "";
    case "tgt":
      return row.box.targets ?? -Infinity;
    case "rec":
      return row.box.receptions ?? -Infinity;
    case "rec_yds":
      return row.box.receivingYards ?? -Infinity;
    case "rec_td":
      return row.box.receivingTds ?? -Infinity;
    case "att":
      return row.box.carries ?? -Infinity;
    case "rush_yds":
      return row.box.rushingYards ?? -Infinity;
    case "rush_td":
      return row.box.rushingTds ?? -Infinity;
    case "pass_yds":
      return row.box.passingYards ?? -Infinity;
    case "pass_td":
      return row.box.passingTds ?? -Infinity;
    case "int":
      return row.box.interceptions ?? -Infinity;
    case "cmp":
      return row.box.completions ?? -Infinity;
    case "xfp":
      return row.xfp ?? -Infinity;
    case "fpoe":
      return row.fpoe ?? -Infinity;
    case "vorp":
      return row.vorp ?? -Infinity;
    case "fpts":
    default:
      return row.fpts;
  }
}

function enrichRow(
  r: {
    playerKey: string;
    sleeperPlayerId: string | null;
    playerName: string | null;
    team: string | null;
    position: string | null;
    gamesPlayed: number;
    receptionsExp: number | null;
    receivingYardsExp: number | null;
    rushingYardsExp: number | null;
    passingYardsExp: number | null;
    totalFantasyPointsExp: number | null;
    totalFantasyPointsDiff: number | null;
    targets: number | null;
    receptions: number | null;
    receivingYards: number | null;
    receivingAirYards: number | null;
    routesRun: number | null;
    offenseSnaps: number | null;
    offenseSnapPct: number | null;
    targetShare: number | null;
    targetsPerRoute: number | null;
    receivingYac: number | null;
    racr: number | null;
    wopr: number | null;
    rushingEpa: number | null;
    receivingEpa: number | null;
    fantasyProsRosterPct: number | null;
    completions: number | null;
    attempts: number | null;
    passingYards: number | null;
    passingTds: number | null;
    interceptions: number | null;
    carries: number | null;
    rushingYards: number | null;
    rushingTds: number | null;
    receivingTds: number | null;
    rushingFumblesLost: number | null;
    receivingFumblesLost: number | null;
  },
  preset: ScoringPreset,
  startRates: Map<string, { startRate: number; source: string }>,
): StatsPlayerRow {
  const fpts = scoreBox(r, preset);
  const games = Math.max(1, r.gamesPlayed || 1);
  const xfp =
    r.receptionsExp != null || r.receivingYardsExp != null || r.rushingYardsExp != null || r.passingYardsExp != null
      ? scoreExpected(r, r.position, preset)
      : r.totalFantasyPointsExp;
  const fpoe = xfp != null ? fpts - xfp : r.totalFantasyPointsDiff;
  const targets = r.targets ?? 0;
  const receptions = r.receptions ?? 0;
  const catchRate = targets > 0 ? receptions / targets : null;
  const catchRateExp = r.receptionsExp != null && targets > 0 ? r.receptionsExp / targets : null;
  const adot = r.receivingAirYards != null && targets > 0 ? r.receivingAirYards / targets : null;
  const routesRun = r.routesRun;
  const offenseSnaps = r.offenseSnaps;
  const yprr =
    routesRun != null && routesRun > 0 && r.receivingYards != null
      ? Math.round((r.receivingYards / routesRun) * 100) / 100
      : null;
  const routePct =
    offenseSnaps != null && offenseSnaps > 0 && routesRun != null
      ? Math.round((routesRun / offenseSnaps) * 1000) / 1000
      : null;
  const sr = r.sleeperPlayerId ? startRates.get(r.sleeperPlayerId) : undefined;
  return {
    rank: 0,
    playerKey: r.playerKey,
    sleeperPlayerId: r.sleeperPlayerId,
    playerName: r.playerName,
    team: r.team,
    position: r.position,
    games: r.gamesPlayed,
    fpts: Math.round(fpts * 10) / 10,
    fptsPerGame: Math.round((fpts / games) * 10) / 10,
    xfp: xfp != null ? Math.round(xfp * 10) / 10 : null,
    fpoe: fpoe != null ? Math.round(fpoe * 10) / 10 : null,
    targetShare: r.targetShare,
    targetsPerRoute: r.targetsPerRoute,
    yprr,
    offenseSnapPct: r.offenseSnapPct,
    offenseSnaps: offenseSnaps ?? null,
    routesRun,
    routePct,
    catchRate,
    catchRateExp,
    adot,
    airYards: r.receivingAirYards ?? null,
    yac: r.receivingYac,
    racr: r.racr,
    wopr: r.wopr,
    rushingEpa: r.rushingEpa,
    receivingEpa: r.receivingEpa ?? null,
    startRate: sr?.startRate ?? (r.fantasyProsRosterPct != null ? r.fantasyProsRosterPct / 100 : null),
    startRateSource: sr?.source ?? (r.fantasyProsRosterPct != null ? "fantasypros_fallback" : null),
    rosterPct: r.fantasyProsRosterPct,
    vorp: null,
    box: {
      completions: r.completions,
      attempts: r.attempts,
      passingYards: r.passingYards,
      passingTds: r.passingTds,
      interceptions: r.interceptions,
      carries: r.carries,
      rushingYards: r.rushingYards,
      rushingTds: r.rushingTds,
      targets: r.targets,
      receptions: r.receptions,
      receivingYards: r.receivingYards,
      receivingTds: r.receivingTds,
    },
  };
}

export async function queryLeaderboard(args: {
  season: number;
  week: number | null;
  position: string;
  sort?: string;
  dir?: "asc" | "desc";
  q?: string;
  limit?: number;
  scoring?: ScoringPreset;
}): Promise<{
  players: StatsPlayerRow[];
  total: number;
  scoring: ScoringPreset;
  replacementPoints: number;
  replacementPerGame: number;
}> {
  const position = args.position.toUpperCase();
  const sort = (args.sort ?? "fpts").toLowerCase();
  const sortDir = args.dir === "asc" ? "asc" : "desc";
  const grain = args.week == null ? "season" : "week";
  const preset = args.scoring ?? DEFAULT_SCORING;
  const defaultLimit = position === "SUPERFLEX" || position === "FLEX" ? 200 : 100;
  const limit = Math.min(400, Math.max(1, args.limit ?? defaultLimit));
  const q = args.q?.trim() ?? "";

  const rows = await prisma.nflPlayerWeekStat.findMany({
    where: {
      season: args.season,
      grain,
      ...(args.week == null ? { week: -1 } : { week: args.week }),
      ...positionFilter(position),
      seasonType: { in: ["REG", "reg", "REG+POST"] },
      ...(q
        ? {
            OR: [
              { playerName: { contains: q, mode: "insensitive" as const } },
              { team: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    take: 2000,
  });

  const startRates =
    args.week != null
      ? await computeStartRates({ season: String(args.season), week: args.week })
      : new Map<string, { startRate: number; source: string }>();

  const scored = rows.map((r) => enrichRow(r, preset, startRates));
  scored.sort((a, b) => b.fpts - a.fpts);
  const startCount = POS_START_COUNT[position] ?? 2;

  const seasonStartByKey = new Map<string, number>();
  for (const r of scored) {
    if (r.startRate != null) seasonStartByKey.set(r.playerKey, r.startRate);
    if (r.sleeperPlayerId && r.startRate != null) seasonStartByKey.set(r.sleeperPlayerId, r.startRate);
  }

  let replacementSummary = pickReplacementLevel(
    scored.map((r) => ({
      sleeperPlayerId: r.sleeperPlayerId,
      fpts: r.fpts,
      games: Math.max(1, r.games || 1),
      startRate: r.startRate ?? 0,
    })),
    { startCount },
  );

  if (grain === "week") {
    const replacement = pickReplacementPoints(
      scored.map((r) => ({
        sleeperPlayerId: r.sleeperPlayerId,
        fpts: r.fpts,
        startRate: r.startRate ?? 0,
      })),
      { startCount },
    );
    replacementSummary = { fpts: replacement, games: 1, fptsPerGame: replacement };
    for (const r of scored) r.vorp = Math.round((r.fpts - replacement) * 10) / 10;
  } else {
    const weeklyRows = await prisma.nflPlayerWeekStat.findMany({
      where: {
        season: args.season,
        grain: "week",
        week: { gt: 0 },
        ...positionFilter(position),
        seasonType: { in: ["REG", "reg", "REG+POST"] },
      },
      take: 8000,
    });

    const byWeek = new Map<number, Array<{ sleeperPlayerId: string | null; fpts: number; startRate: number }>>();
    const playerWeeks = new Map<string, Array<{ week: number; fpts: number }>>();

    for (const wr of weeklyRows) {
      const fpts = scoreBox(wr, preset);
      const startRate =
        (wr.sleeperPlayerId ? seasonStartByKey.get(wr.sleeperPlayerId) : undefined) ??
        seasonStartByKey.get(wr.playerKey) ??
        (wr.fantasyProsRosterPct != null ? Math.min(1, Math.max(0, wr.fantasyProsRosterPct / 100)) : 0);
      const bucket = byWeek.get(wr.week) ?? [];
      bucket.push({ sleeperPlayerId: wr.sleeperPlayerId, fpts, startRate });
      byWeek.set(wr.week, bucket);
      const pw = playerWeeks.get(wr.playerKey) ?? [];
      pw.push({ week: wr.week, fpts });
      playerWeeks.set(wr.playerKey, pw);
    }

    const replacementByWeek = buildWeeklyReplacementMap(byWeek, { startCount });
    let repSum = 0;
    let repWeeks = 0;
    for (const v of replacementByWeek.values()) {
      repSum += v;
      repWeeks += 1;
    }
    replacementSummary = {
      fpts: repWeeks > 0 ? repSum : replacementSummary.fpts,
      games: Math.max(1, repWeeks),
      fptsPerGame: repWeeks > 0 ? repSum / repWeeks : replacementSummary.fptsPerGame,
    };
    for (const r of scored) {
      r.vorp = Math.round(vorpFromWeeklyScores(playerWeeks.get(r.playerKey) ?? [], replacementByWeek) * 10) / 10;
    }
  }

  const dirMul = sortDir === "asc" ? 1 : -1;
  scored.sort((a, b) => {
    const av = sortValue(a, sort);
    const bv = sortValue(b, sort);
    if (typeof av === "string" || typeof bv === "string") {
      return String(av).localeCompare(String(bv)) * (sortDir === "asc" ? 1 : -1);
    }
    const an = typeof av === "number" && Number.isFinite(av) ? av : -Infinity;
    const bn = typeof bv === "number" && Number.isFinite(bv) ? bv : -Infinity;
    if (bn === an) return b.fpts - a.fpts;
    return (an - bn) * dirMul;
  });

  const page = scored.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));
  return {
    players: page,
    total: scored.length,
    scoring: preset,
    replacementPoints: Math.round(replacementSummary.fpts * 10) / 10,
    replacementPerGame: Math.round(replacementSummary.fptsPerGame * 10) / 10,
  };
}

export async function findPlayerStats(args: {
  playerQuery: string;
  season: number;
  week?: number | null;
  scoring?: ScoringPreset;
}): Promise<{ player: StatsPlayerRow; matches: Array<{ name: string; team: string | null; position: string | null }> } | null> {
  const q = args.playerQuery.trim();
  if (!q) return null;
  const week = args.week ?? null;
  const grain = week == null ? "season" : "week";
  const preset = args.scoring ?? DEFAULT_SCORING;

  const candidates = await prisma.nflPlayerWeekStat.findMany({
    where: {
      season: args.season,
      grain,
      ...(week == null ? { week: -1 } : { week }),
      seasonType: { in: ["REG", "reg", "REG+POST"] },
      playerName: { contains: q, mode: "insensitive" },
      position: { in: [...SKILL_POSITIONS] },
    },
    orderBy: [{ fantasyPointsPpr: "desc" }, { playerName: "asc" }],
    take: 15,
  });
  if (!candidates.length) return null;

  const exact = candidates.filter((c) => (c.playerName ?? "").toLowerCase() === q.toLowerCase());
  const pick = exact[0] ?? candidates[0]!;
  const position = (pick.position ?? "FLEX").toUpperCase();
  const board = await queryLeaderboard({
    season: args.season,
    week,
    position: position === "QB" || position === "RB" || position === "WR" || position === "TE" ? position : "FLEX",
    sort: "fpts",
    limit: 400,
    scoring: preset,
  });
  const player =
    board.players.find((p) => p.playerKey === pick.playerKey) ??
    enrichRow(pick, preset, new Map());

  return {
    player,
    matches: candidates.map((c) => ({
      name: c.playerName ?? "?",
      team: c.team,
      position: c.position,
    })),
  };
}

export async function autocompletePlayerNames(args: {
  season: number;
  query: string;
  limit?: number;
}): Promise<Array<{ name: string; value: string }>> {
  const q = args.query.trim();
  if (q.length < 2) return [];
  const rows = await prisma.nflPlayerWeekStat.findMany({
    where: {
      season: args.season,
      grain: "season",
      week: -1,
      playerName: { contains: q, mode: "insensitive" },
      position: { in: [...SKILL_POSITIONS] },
    },
    distinct: ["playerName"],
    select: { playerName: true, team: true, position: true },
    take: args.limit ?? 25,
    orderBy: { playerName: "asc" },
  });
  return rows
    .filter((r) => r.playerName)
    .map((r) => ({
      name: `${r.playerName}${r.team ? ` (${r.team}${r.position ? ` ${r.position}` : ""})` : ""}`.slice(0, 100),
      value: (r.playerName ?? "").slice(0, 100),
    }));
}

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

const NFL_TEAM_ALIASES: Record<string, string> = {
  ARI: "ARI",
  ATL: "ATL",
  BAL: "BAL",
  BUF: "BUF",
  CAR: "CAR",
  CHI: "CHI",
  CIN: "CIN",
  CLE: "CLE",
  DAL: "DAL",
  DEN: "DEN",
  DET: "DET",
  GB: "GB",
  HOU: "HOU",
  IND: "IND",
  JAX: "JAX",
  JAC: "JAX",
  KC: "KC",
  KCC: "KC",
  LV: "LV",
  LVR: "LV",
  OAK: "LV",
  LAC: "LAC",
  SD: "LAC",
  LAR: "LA",
  LA: "LA",
  STL: "LA",
  MIA: "MIA",
  MIN: "MIN",
  NE: "NE",
  NWE: "NE",
  NO: "NO",
  NYG: "NYG",
  NYJ: "NYJ",
  PHI: "PHI",
  PIT: "PIT",
  SEA: "SEA",
  SF: "SF",
  SFO: "SF",
  TB: "TB",
  TAM: "TB",
  TEN: "TEN",
  WAS: "WAS",
  WSH: "WAS",
};

export function normalizeNflTeam(value: string): string | null {
  return NFL_TEAM_ALIASES[value.trim().toUpperCase()] ?? null;
}

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
  | "fd"
  | "rush_fd"
  | "rec_fd"
  | "fd_carry"
  | "ypc"
  | "fd_rr"
  | "pass_yds"
  | "pass_att"
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

export type LeaderboardMinimumVolume = {
  value: number;
  unit: "carries" | "routes" | "targets" | "snaps";
  isDefault: boolean;
};

const ROUTE_RATE_METRICS = new Set(["tgt_pct", "tprr", "yprr", "route_pct", "racr", "wopr", "fd_rr"]);
const CARRY_RATE_METRICS = new Set(["fd_carry", "ypc"]);
const TARGET_RATE_METRICS = new Set(["catch_pct", "adot"]);
const SNAP_RATE_METRICS = new Set(["snap_pct"]);

function defaultMinimumVolume(sort: string, week: number | null): Omit<LeaderboardMinimumVolume, "isDefault"> | null {
  if (CARRY_RATE_METRICS.has(sort)) return { value: week == null ? 50 : 8, unit: "carries" };
  if (ROUTE_RATE_METRICS.has(sort)) return { value: week == null ? 50 : 8, unit: "routes" };
  if (TARGET_RATE_METRICS.has(sort)) return { value: week == null ? 10 : 2, unit: "targets" };
  if (SNAP_RATE_METRICS.has(sort)) return { value: week == null ? 100 : 10, unit: "snaps" };
  return null;
}

function volumeFor(row: StatsPlayerRow, unit: LeaderboardMinimumVolume["unit"]): number {
  if (unit === "carries") return row.box.carries ?? 0;
  if (unit === "routes") return row.routesRun ?? 0;
  if (unit === "targets") return row.box.targets ?? 0;
  return row.offenseSnaps ?? 0;
}

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
  firstDowns: number | null;
  firstDownsPerCarry: number | null;
  yardsPerCarry: number | null;
  firstDownsPerRoute: number | null;
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
    rushingFirstDowns: number | null;
    targets: number | null;
    receptions: number | null;
    receivingYards: number | null;
    receivingTds: number | null;
    receivingFirstDowns: number | null;
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

/**
 * Season target share as player targets ÷ team targets in games the player appeared.
 * nflverse season rollups can use full-season team targets (including missed games);
 * this recomputes from weekly rows so Tgt% reflects opportunity while the player played.
 */
export function targetShareFromWeeklyTargets(
  weeks: Array<{ playerKey: string; team: string | null; week: number; targets: number | null }>,
): Map<string, number> {
  const teamWeekTargets = new Map<string, number>();
  for (const row of weeks) {
    if (!row.team) continue;
    const key = `${row.team}|${row.week}`;
    teamWeekTargets.set(key, (teamWeekTargets.get(key) ?? 0) + (row.targets ?? 0));
  }

  const agg = new Map<string, { targets: number; available: number }>();
  for (const row of weeks) {
    if (!row.team) continue;
    const available = teamWeekTargets.get(`${row.team}|${row.week}`) ?? 0;
    if (available <= 0) continue;
    const cur = agg.get(row.playerKey) ?? { targets: 0, available: 0 };
    cur.targets += row.targets ?? 0;
    cur.available += available;
    agg.set(row.playerKey, cur);
  }

  const out = new Map<string, number>();
  for (const [playerKey, { targets, available }] of agg) {
    if (available > 0) out.set(playerKey, Math.round((targets / available) * 1000) / 1000);
  }
  return out;
}

export async function seasonTargetShareByPlayerKey(season: number): Promise<Map<string, number>> {
  const weeks = await prisma.nflPlayerWeekStat.findMany({
    where: {
      season,
      grain: "week",
      week: { gt: 0 },
      seasonType: { in: ["REG", "reg", "REG+POST"] },
    },
    select: { playerKey: true, team: true, week: true, targets: true },
  });
  return targetShareFromWeeklyTargets(weeks);
}

function applySeasonTargetShares<T extends { playerKey: string; targetShare: number | null }>(
  rows: T[],
  shares: Map<string, number>,
): void {
  for (const row of rows) {
    const share = shares.get(row.playerKey);
    if (share != null) row.targetShare = share;
  }
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
    case "fd":
      return row.firstDowns ?? -Infinity;
    case "rush_fd":
      return row.box.rushingFirstDowns ?? -Infinity;
    case "rec_fd":
      return row.box.receivingFirstDowns ?? -Infinity;
    case "fd_carry":
      return row.firstDownsPerCarry ?? -Infinity;
    case "ypc":
      return row.yardsPerCarry ?? -Infinity;
    case "fd_rr":
      return row.firstDownsPerRoute ?? -Infinity;
    case "pass_yds":
      return row.box.passingYards ?? -Infinity;
    case "pass_att":
      return row.box.attempts ?? -Infinity;
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
    rushingFirstDowns: number | null;
    receivingTds: number | null;
    receivingFirstDowns: number | null;
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
  const rushingFirstDowns = r.rushingFirstDowns ?? 0;
  const receivingFirstDowns = r.receivingFirstDowns ?? 0;
  const firstDowns = r.rushingFirstDowns != null || r.receivingFirstDowns != null ? rushingFirstDowns + receivingFirstDowns : null;
  const firstDownsPerCarry =
    r.carries != null && r.carries > 0 && r.rushingFirstDowns != null ? Math.round((r.rushingFirstDowns / r.carries) * 100) / 100 : null;
  const yardsPerCarry =
    r.carries != null && r.carries > 0 && r.rushingYards != null ? Math.round((r.rushingYards / r.carries) * 100) / 100 : null;
  const firstDownsPerRoute =
    routesRun != null && routesRun > 0 && r.receivingFirstDowns != null
      ? Math.round((r.receivingFirstDowns / routesRun) * 100) / 100
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
    firstDowns,
    firstDownsPerCarry,
    yardsPerCarry,
    firstDownsPerRoute,
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
      rushingFirstDowns: r.rushingFirstDowns,
      targets: r.targets,
      receptions: r.receptions,
      receivingYards: r.receivingYards,
      receivingTds: r.receivingTds,
      receivingFirstDowns: r.receivingFirstDowns,
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
  team?: string | null;
  limit?: number;
  scoring?: ScoringPreset;
  /** Overrides the metric's default minimum routes, targets, or snaps. Zero disables it. */
  minVolume?: number | null;
  /** Reuses an already-resolved volume filter when querying a related cohort. */
  minimumVolumeFilter?: LeaderboardMinimumVolume | null;
}): Promise<{
  players: StatsPlayerRow[];
  total: number;
  scoring: ScoringPreset;
  replacementPoints: number;
  replacementPerGame: number;
  minimumVolume: LeaderboardMinimumVolume | null;
}> {
  const position = args.position.toUpperCase();
  const sort = (args.sort ?? "fpts").toLowerCase();
  const sortDir = args.dir === "asc" ? "asc" : "desc";
  const grain = args.week == null ? "season" : "week";
  const preset = args.scoring ?? DEFAULT_SCORING;
  const defaultLimit = position === "SUPERFLEX" || position === "FLEX" ? 200 : 100;
  const limit = Math.min(400, Math.max(1, args.limit ?? defaultLimit));
  const q = args.q?.trim() ?? "";
  const team = args.team ? normalizeNflTeam(args.team) : null;
  const defaultMinimum = defaultMinimumVolume(sort, args.week);
  const suppliedMinimum =
    args.minVolume != null && Number.isFinite(args.minVolume) ? Math.min(1_000, Math.max(0, Math.floor(args.minVolume))) : null;
  const minimumVolume =
    args.minimumVolumeFilter !== undefined
      ? args.minimumVolumeFilter
      : defaultMinimum == null
      ? null
      : {
          ...defaultMinimum,
          value: suppliedMinimum ?? defaultMinimum.value,
          isDefault: suppliedMinimum == null,
        };

  const rows = await prisma.nflPlayerWeekStat.findMany({
    where: {
      season: args.season,
      grain,
      ...(args.week == null ? { week: -1 } : { week: args.week }),
      ...positionFilter(position),
      seasonType: { in: ["REG", "reg", "REG+POST"] },
      ...(team ? { team } : {}),
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
  if (grain === "season") {
    applySeasonTargetShares(scored, await seasonTargetShareByPlayerKey(args.season));
  }
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

  const eligible =
    minimumVolume != null && minimumVolume.value > 0
      ? scored.filter((row) => volumeFor(row, minimumVolume.unit) >= minimumVolume.value)
      : scored;
  const dirMul = sortDir === "asc" ? 1 : -1;
  eligible.sort((a, b) => {
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

  const page = eligible.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));
  return {
    players: page,
    total: eligible.length,
    scoring: preset,
    replacementPoints: Math.round(replacementSummary.fpts * 10) / 10,
    replacementPerGame: Math.round(replacementSummary.fptsPerGame * 10) / 10,
    minimumVolume,
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

export async function findPlayerStatsWindow(args: {
  playerQuery: string;
  endSeason: number;
  years: 3 | 5;
  scoring?: ScoringPreset;
}): Promise<{
  playerName: string;
  playerTeam: string | null;
  playerPosition: string | null;
  seasons: Array<{ season: number; player: StatsPlayerRow | null }>;
  matches: Array<{ name: string; team: string | null; position: string | null }>;
} | null> {
  const base = await findPlayerStats({ playerQuery: args.playerQuery, season: args.endSeason, scoring: args.scoring });
  if (!base) return null;
  const seasons = Array.from({ length: args.years }, (_, index) => args.endSeason - args.years + index + 1);
  const position = (base.player.position ?? "FLEX").toUpperCase();
  const boardPosition = position === "QB" || position === "RB" || position === "WR" || position === "TE" ? position : "FLEX";
  const results = await Promise.all(
    seasons.map(async (season) => {
      if (season === args.endSeason) return { season, player: base.player };
      const record = await prisma.nflPlayerWeekStat.findFirst({
        where: {
          season,
          grain: "season",
          week: -1,
          seasonType: { in: ["REG", "reg", "REG+POST"] },
          playerKey: base.player.playerKey,
        },
      });
      if (!record) return { season, player: null };
      const board = await queryLeaderboard({
        season,
        week: null,
        position: boardPosition,
        sort: "fpts",
        limit: 400,
        scoring: args.scoring,
      });
      return { season, player: board.players.find((player) => player.playerKey === base.player.playerKey) ?? enrichRow(record, args.scoring ?? DEFAULT_SCORING, new Map()) };
    }),
  );
  return {
    playerName: base.player.playerName ?? args.playerQuery,
    playerTeam: base.player.team,
    playerPosition: base.player.position,
    seasons: results,
    matches: base.matches,
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

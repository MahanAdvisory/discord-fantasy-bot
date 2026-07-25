import { requireSessionUser } from "@/lib/sessionUser";
import { prisma } from "@fantasy/db";
import { parseScoringQuery, scoreBox, scoreExpected } from "@fantasy/domain/fantasyScoring";
import {
  buildWeeklyReplacementMap,
  computeStartRates,
  pickReplacementLevel,
  pickReplacementPoints,
  vorpFromWeeklyScores,
} from "@fantasy/services/stats/vorp";
import { seasonTargetShareByPlayerKey } from "@fantasy/services/stats/leaderboardQuery";
import type { Prisma } from "@prisma/client";

const POS_START_COUNT: Record<string, number> = {
  QB: 1,
  RB: 2,
  WR: 3,
  TE: 1,
  FLEX: 3,
  SUPERFLEX: 1,
};

const SKILL_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
const FLEX_POSITIONS = ["RB", "WR", "TE"] as const;

const SORT_FIELDS = new Set([
  "fpts",
  "fpts_g",
  "xfp",
  "fpoe",
  "vorp",
  "games",
  "g",
  "tgt",
  "rec",
  "rec_yds",
  "rec_td",
  "att",
  "rush_yds",
  "rush_td",
  "fd",
  "rush_fd",
  "rec_fd",
  "fd_carry",
  "ypc",
  "fd_rr",
  "pass_yds",
  "pass_td",
  "int",
  "cmp",
  "tgt_pct",
  "tprr",
  "yprr",
  "routes",
  "route_pct",
  "snap_pct",
  "snaps",
  "catch_pct",
  "adot",
  "air_yds",
  "yac",
  "racr",
  "wopr",
  "rush_epa",
  "rec_epa",
  "start_pct",
  "pos",
  "player",
]);

const ROUTE_RATE_METRICS = new Set(["tgt_pct", "tprr", "yprr", "route_pct", "racr", "wopr", "fd_rr"]);
const CARRY_RATE_METRICS = new Set(["fd_carry", "ypc"]);

function defaultMinimumVolume(sort: string, week: number | null): { value: number; unit: "carries" | "routes" } | null {
  if (CARRY_RATE_METRICS.has(sort)) return { value: week == null ? 50 : 8, unit: "carries" };
  if (ROUTE_RATE_METRICS.has(sort)) return { value: week == null ? 50 : 8, unit: "routes" };
  return null;
}

function positionFilter(position: string): Prisma.NflPlayerWeekStatWhereInput {
  if (position === "FLEX") return { position: { in: [...FLEX_POSITIONS] } };
  if (position === "SUPERFLEX" || position === "ALL") return { position: { in: [...SKILL_POSITIONS] } };
  return { position };
}

function sortValue(row: Record<string, unknown>, sort: string): number | string {
  switch (sort) {
    case "fpts_g":
      return typeof row.fptsPerGame === "number" ? row.fptsPerGame : -Infinity;
    case "g":
      return typeof row.games === "number" ? row.games : -Infinity;
    case "tgt_pct":
      return typeof row.targetShare === "number" ? row.targetShare : -Infinity;
    case "tprr":
      return typeof row.targetsPerRoute === "number" ? row.targetsPerRoute : -Infinity;
    case "yprr":
      return typeof row.yprr === "number" ? row.yprr : -Infinity;
    case "routes":
      return typeof row.routesRun === "number" ? row.routesRun : -Infinity;
    case "route_pct":
      return typeof row.routePct === "number" ? row.routePct : -Infinity;
    case "snap_pct":
      return typeof row.offenseSnapPct === "number" ? row.offenseSnapPct : -Infinity;
    case "snaps":
      return typeof row.offenseSnaps === "number" ? row.offenseSnaps : -Infinity;
    case "air_yds":
      return typeof row.airYards === "number" ? row.airYards : -Infinity;
    case "catch_pct":
      return typeof row.catchRate === "number" ? row.catchRate : -Infinity;
    case "start_pct":
      return typeof row.startRate === "number" ? row.startRate : -Infinity;
    case "rush_epa":
      return typeof row.rushingEpa === "number" ? row.rushingEpa : -Infinity;
    case "rec_epa":
      return typeof row.receivingEpa === "number" ? row.receivingEpa : -Infinity;
    case "pos":
      return typeof row.position === "string" ? row.position : "";
    case "player":
      return typeof row.playerName === "string" ? row.playerName.toLowerCase() : "";
    case "team":
      return typeof row.team === "string" ? row.team : "";
    case "tgt":
      return Number((row.box as Record<string, number | null> | undefined)?.targets) || -Infinity;
    case "rec":
      return Number((row.box as Record<string, number | null> | undefined)?.receptions) || -Infinity;
    case "rec_yds":
      return Number((row.box as Record<string, number | null> | undefined)?.receivingYards) || -Infinity;
    case "rec_td":
      return Number((row.box as Record<string, number | null> | undefined)?.receivingTds) || -Infinity;
    case "att":
      return Number((row.box as Record<string, number | null> | undefined)?.carries) || -Infinity;
    case "rush_yds":
      return Number((row.box as Record<string, number | null> | undefined)?.rushingYards) || -Infinity;
    case "rush_td":
      return Number((row.box as Record<string, number | null> | undefined)?.rushingTds) || -Infinity;
    case "fd":
    case "fd_carry":
    case "ypc":
    case "fd_rr":
      return typeof row[sort === "fd" ? "firstDowns" : sort === "fd_carry" ? "firstDownsPerCarry" : sort === "ypc" ? "yardsPerCarry" : "firstDownsPerRoute"] === "number"
        ? (row[sort === "fd" ? "firstDowns" : sort === "fd_carry" ? "firstDownsPerCarry" : sort === "ypc" ? "yardsPerCarry" : "firstDownsPerRoute"] as number)
        : -Infinity;
    case "rush_fd":
      return Number((row.box as Record<string, number | null> | undefined)?.rushingFirstDowns) || -Infinity;
    case "rec_fd":
      return Number((row.box as Record<string, number | null> | undefined)?.receivingFirstDowns) || -Infinity;
    case "pass_yds":
      return Number((row.box as Record<string, number | null> | undefined)?.passingYards) || -Infinity;
    case "pass_td":
      return Number((row.box as Record<string, number | null> | undefined)?.passingTds) || -Infinity;
    case "int":
      return Number((row.box as Record<string, number | null> | undefined)?.interceptions) || -Infinity;
    case "cmp":
      return Number((row.box as Record<string, number | null> | undefined)?.completions) || -Infinity;
    default: {
      const v = row[sort];
      return typeof v === "number" ? v : typeof v === "string" ? v : -Infinity;
    }
  }
}

export async function GET(req: Request) {
  const { user } = await requireSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const u = new URL(req.url);
  const season = Number(u.searchParams.get("season") ?? new Date().getFullYear());
  const weekRaw = u.searchParams.get("week");
  const week = weekRaw === "season" || weekRaw === "-1" || !weekRaw ? null : Number(weekRaw);
  const position = (u.searchParams.get("position") ?? "RB").toUpperCase();
  const sortRaw = (u.searchParams.get("sort") ?? "fpts").toLowerCase();
  const sort = SORT_FIELDS.has(sortRaw) ? sortRaw : "fpts";
  const sortDir = (u.searchParams.get("dir") ?? "desc").toLowerCase() === "asc" ? "asc" : "desc";
  const q = (u.searchParams.get("q") ?? "").trim();
  const defaultLimit = position === "SUPERFLEX" || position === "FLEX" ? 200 : 100;
  const limit = Math.min(400, Math.max(1, Number(u.searchParams.get("limit") ?? String(defaultLimit)) || defaultLimit));
  const preset = parseScoringQuery(u.searchParams);
  const grain = week == null ? "season" : "week";

  const rows = await prisma.nflPlayerWeekStat.findMany({
    where: {
      season,
      grain,
      ...(week == null ? { week: -1 } : { week }),
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
    week != null
      ? await computeStartRates({ season: String(season), week })
      : new Map<string, { startRate: number; source: "member" | "fantasypros_fallback"; started: number; rostered: number }>();

  type RowOut = {
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
    firstDownsPerRoute: number | null;
    rushingYardsExp: number | null;
    startRate: number | null;
    startRateSource: string | null;
    rosterPct: number | null;
    vorp: number | null;
    box: Record<string, number | null>;
  };

  const scored: RowOut[] = rows.map((r) => {
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
    const receivingYards = r.receivingYards;
    const yprr =
      routesRun != null && routesRun > 0 && receivingYards != null
        ? Math.round((receivingYards / routesRun) * 100) / 100
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
      rushingYardsExp: r.rushingYardsExp,
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
  });

  if (grain === "season") {
    const shares = await seasonTargetShareByPlayerKey(season);
    for (const row of scored) {
      const share = shares.get(row.playerKey);
      if (share != null) row.targetShare = share;
    }
  }

  // Rank by FPTS first; VORP uses per-week replacement for weeks the player was active.
  scored.sort((a, b) => b.fpts - a.fpts);
  const startCount = POS_START_COUNT[position] ?? 2;

  // Season-level start rates / roster% for filtering replacement pool each week
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
    for (const r of scored) {
      r.vorp = Math.round((r.fpts - replacement) * 10) / 10;
    }
  } else {
    const weeklyRows = await prisma.nflPlayerWeekStat.findMany({
      where: {
        season,
        grain: "week",
        week: { gt: 0 },
        ...positionFilter(position),
        seasonType: { in: ["REG", "reg", "REG+POST"] },
      },
      take: 8000,
    });

    const byWeek = new Map<number, Array<{ sleeperPlayerId: string | null; fpts: number; startRate: number; playerKey: string }>>();
    const playerWeeks = new Map<string, Array<{ week: number; fpts: number }>>();

    for (const wr of weeklyRows) {
      const fpts = scoreBox(wr, preset);
      const startRate =
        (wr.sleeperPlayerId ? seasonStartByKey.get(wr.sleeperPlayerId) : undefined) ??
        seasonStartByKey.get(wr.playerKey) ??
        (wr.fantasyProsRosterPct != null ? Math.min(1, Math.max(0, wr.fantasyProsRosterPct / 100)) : 0);
      const bucket = byWeek.get(wr.week) ?? [];
      bucket.push({ sleeperPlayerId: wr.sleeperPlayerId, fpts, startRate, playerKey: wr.playerKey });
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
      const weeks = playerWeeks.get(r.playerKey) ?? [];
      r.vorp = Math.round(vorpFromWeeklyScores(weeks, replacementByWeek) * 10) / 10;
    }
  }

  const minimumVolume = defaultMinimumVolume(sort, week);
  const eligible = minimumVolume
    ? scored.filter((row) =>
        minimumVolume.unit === "carries"
          ? (row.box.carries ?? 0) >= minimumVolume.value
          : (row.routesRun ?? 0) >= minimumVolume.value,
      )
    : scored;
  const dirMul = sortDir === "asc" ? 1 : -1;
  eligible.sort((a, b) => {
    const av = sortValue(a as unknown as Record<string, unknown>, sort);
    const bv = sortValue(b as unknown as Record<string, unknown>, sort);
    if (typeof av === "string" || typeof bv === "string") {
      return String(av).localeCompare(String(bv)) * (sortDir === "asc" ? 1 : -1);
    }
    const an = typeof av === "number" && Number.isFinite(av) ? av : -Infinity;
    const bn = typeof bv === "number" && Number.isFinite(bv) ? bv : -Infinity;
    if (bn === an) return b.fpts - a.fpts;
    return (an - bn) * dirMul;
  });

  const page = eligible.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));

  return Response.json(
    {
      season,
      week: week ?? "season",
      position,
      sort,
      dir: sortDir,
      q: q || null,
      scoring: preset,
      replacementPoints: Math.round(replacementSummary.fpts * 10) / 10,
      replacementPerGame: Math.round(replacementSummary.fptsPerGame * 10) / 10,
      minimumVolume,
      attribution:
        "Box scores via nflverse/nflfastR. Expected points via ffopportunity. Participation/routes via FTN Data via nflverse (CC-BY-SA) when present. Roster % fallback via FantasyPros rankings when member start-rate sample is thin.",
      players: page,
      total: eligible.length,
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

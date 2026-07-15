import { requireSessionUser } from "@/lib/sessionUser";
import { prisma } from "@fantasy/db";
import { parseScoringQuery, scoreBox, scoreExpected } from "@fantasy/domain/fantasyScoring";
import { computeStartRates, pickReplacementPoints } from "@fantasy/services/stats/vorp";
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
  "pass_yds",
  "pass_td",
  "int",
  "cmp",
  "tgt_pct",
  "tprr",
  "routes",
  "snap_pct",
  "catch_pct",
  "adot",
  "yac",
  "racr",
  "wopr",
  "rush_epa",
  "start_pct",
  "pos",
  "player",
]);

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
    case "routes":
      return typeof row.routesRun === "number" ? row.routesRun : -Infinity;
    case "snap_pct":
      return typeof row.offenseSnapPct === "number" ? row.offenseSnapPct : -Infinity;
    case "catch_pct":
      return typeof row.catchRate === "number" ? row.catchRate : -Infinity;
    case "start_pct":
      return typeof row.startRate === "number" ? row.startRate : -Infinity;
    case "rush_epa":
      return typeof row.rushingEpa === "number" ? row.rushingEpa : -Infinity;
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
    offenseSnapPct: number | null;
    routesRun: number | null;
    catchRate: number | null;
    catchRateExp: number | null;
    adot: number | null;
    yac: number | null;
    racr: number | null;
    wopr: number | null;
    rushingEpa: number | null;
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
      offenseSnapPct: r.offenseSnapPct,
      routesRun: r.routesRun,
      catchRate,
      catchRateExp,
      adot,
      yac: r.receivingYac,
      racr: r.racr,
      wopr: r.wopr,
      rushingEpa: r.rushingEpa,
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
        targets: r.targets,
        receptions: r.receptions,
        receivingYards: r.receivingYards,
        receivingTds: r.receivingTds,
      },
    };
  });

  // Rank / VORP always relative to FPTS order within the filtered set
  scored.sort((a, b) => b.fpts - a.fpts);
  const startCount = POS_START_COUNT[position] ?? 2;
  const replacement = pickReplacementPoints(
    scored.map((r) => ({
      sleeperPlayerId: r.sleeperPlayerId,
      fpts: r.fpts,
      startRate: r.startRate ?? 0,
    })),
    { startCount },
  );
  for (const r of scored) {
    r.vorp = Math.round((r.fpts - replacement) * 10) / 10;
  }

  const dirMul = sortDir === "asc" ? 1 : -1;
  scored.sort((a, b) => {
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

  const page = scored.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));

  return Response.json(
    {
      season,
      week: week ?? "season",
      position,
      sort,
      dir: sortDir,
      q: q || null,
      scoring: preset,
      replacementPoints: Math.round(replacement * 10) / 10,
      attribution:
        "Box scores via nflverse/nflfastR. Expected points via ffopportunity. Participation/routes via FTN Data via nflverse (CC-BY-SA) when present. Roster % fallback via FantasyPros rankings when member start-rate sample is thin.",
      players: page,
      total: scored.length,
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

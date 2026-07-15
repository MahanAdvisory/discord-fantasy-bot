import { requireSessionUser } from "@/lib/sessionUser";
import { prisma } from "@fantasy/db";
import { parseScoringQuery, scoreBox, scoreExpected } from "@fantasy/domain/fantasyScoring";
import { computeStartRates, pickReplacementPoints } from "@fantasy/services/stats/vorp";

const POS_START_COUNT: Record<string, number> = { QB: 1, RB: 2, WR: 3, TE: 1 };

export async function GET(req: Request) {
  const { user } = await requireSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const u = new URL(req.url);
  const season = Number(u.searchParams.get("season") ?? new Date().getFullYear());
  const weekRaw = u.searchParams.get("week");
  const week = weekRaw === "season" || weekRaw === "-1" || !weekRaw ? null : Number(weekRaw);
  const position = (u.searchParams.get("position") ?? "RB").toUpperCase();
  const sort = u.searchParams.get("sort") ?? "fpts";
  const q = (u.searchParams.get("q") ?? "").trim();
  const limit = Math.min(200, Math.max(1, Number(u.searchParams.get("limit") ?? "100") || 100));
  const preset = parseScoringQuery(u.searchParams);
  const grain = week == null ? "season" : "week";

  const rows = await prisma.nflPlayerWeekStat.findMany({
    where: {
      season,
      grain,
      ...(week == null ? { week: -1 } : { week }),
      position,
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
    take: 800,
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
    const games = Math.max(1, r.gamesPlayed || (grain === "week" ? 1 : 1));
    const xfp =
      r.receptionsExp != null || r.receivingYardsExp != null || r.rushingYardsExp != null || r.passingYardsExp != null
        ? scoreExpected(r, r.position, preset)
        : r.totalFantasyPointsExp;
    const fpoe = xfp != null ? fpts - xfp : r.totalFantasyPointsDiff;
    const targets = r.targets ?? 0;
    const receptions = r.receptions ?? 0;
    const catchRate = targets > 0 ? receptions / targets : null;
    const catchRateExp =
      r.receptionsExp != null && targets > 0 ? r.receptionsExp / targets : null;
    const adot =
      r.receivingAirYards != null && targets > 0 ? r.receivingAirYards / targets : null;
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

  const sortKey = sort === "fpts_g" ? "fptsPerGame" : sort === "fpoe" ? "fpoe" : sort === "xfp" ? "xfp" : sort === "vorp" ? "vorp" : "fpts";
  scored.sort((a, b) => {
    const av = (a as Record<string, unknown>)[sortKey];
    const bv = (b as Record<string, unknown>)[sortKey];
    return (typeof bv === "number" ? bv : -Infinity) - (typeof av === "number" ? av : -Infinity);
  });

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
  if (sort === "vorp") {
    scored.sort((a, b) => (b.vorp ?? -Infinity) - (a.vorp ?? -Infinity));
  }

  const page = scored.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));

  return Response.json(
    {
      season,
      week: week ?? "season",
      position,
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

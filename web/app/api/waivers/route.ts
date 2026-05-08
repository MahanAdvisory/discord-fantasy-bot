import { requireSessionUser } from "@/lib/sessionUser";
import { fetchEspnLeagueSnapshot } from "@fantasy/adapters/espn/index";
import { espnLeagueIdsFromJson, espnSeasonOrDefault } from "@fantasy/espn/linkedLeagues";
import { getNflState, getUserLeagues, getLeagueRosters } from "@fantasy/sleeper/client";
import { fetchAllNflPlayers } from "@fantasy/sleeper/playersFull";
import { prisma } from "@fantasy/db";

type WaiverPlayer = {
  playerId: string;
  name: string;
  position: string | null;
  team: string | null;
  ownershipPct: number;
  lastWeekPoints: number;
  last3WeeksPoints: number;
};

type WaiverLeagueRow = {
  provider: "sleeper" | "espn";
  leagueId: string;
  leagueName: string;
  leagueUrl: string;
  waiverRunAt: string | null;
  waiverRunDayOffset: number | null;
  players: WaiverPlayer[];
};

const WAIVER_DAY_LABELS: Record<number, string> = {
  0: "Tuesday",
  1: "Wednesday",
  2: "Thursday",
  3: "Friday",
  4: "Saturday",
  5: "Sunday",
  6: "Monday",
};

/** Sleeper `waiver_day_of_week` index (per labels above) → JS `Date.getUTCDay()` (0=Sun … 6=Sat). */
const SLEEPER_WAIVER_DOW_TO_JS_UTC: number[] = [2, 3, 4, 5, 6, 0, 1];

function nextWaiverDayOffset(sleeperDayOfWeek: number): number | null {
  const jsDow = SLEEPER_WAIVER_DOW_TO_JS_UTC[sleeperDayOfWeek];
  if (jsDow === undefined) return null;
  const nowDow = new Date().getUTCDay();
  return (jsDow - nowDow + 7) % 7;
}

function waiverRunSchedule(
  raw: { waiver_day_of_week?: number; waiver_time?: number } | undefined,
): { label: string | null; dayOffset: number | null } {
  if (!raw) return { label: null, dayOffset: null };
  const day = raw.waiver_day_of_week;
  if (typeof day !== "number") return { label: null, dayOffset: null };
  const label = WAIVER_DAY_LABELS[day] ?? `Day ${day}`;
  return { label, dayOffset: nextWaiverDayOffset(day) };
}

function scoreFromStats(data: unknown): number {
  if (!data || typeof data !== "object") return 0;
  const d = data as Record<string, unknown>;
  const direct =
    (typeof d.pts_ppr === "number" ? d.pts_ppr : null) ??
    (typeof d.pts_half_ppr === "number" ? d.pts_half_ppr : null) ??
    (typeof d.pts_std === "number" ? d.pts_std : null);
  return direct ?? 0;
}

export async function GET(req: Request) {
  const { user } = await requireSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const espnIds = espnLeagueIdsFromJson(user.espnLeagueIds);
  const hasSleeper = Boolean(user.sleeperUserId);
  if (!hasSleeper && !espnIds.length) {
    return Response.json(
      {
        error: "no_leagues",
        message: "Link Sleeper or add ESPN leagues on the Help page to use waivers.",
      },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const sortBy = (url.searchParams.get("sortBy") ?? "ownership") as "ownership" | "lastWeek" | "last3Weeks";
  const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();

  const nfl = await getNflState();
  const season = nfl.league_season ?? nfl.season;
  const week = Math.max(1, nfl.display_week ?? nfl.week ?? 1);

  const byLeague: WaiverLeagueRow[] = [];

  if (hasSleeper) {
    const leagues = await getUserLeagues(user.sleeperUserId!, season);
    const allLeagueRosters = await Promise.all(
      leagues.map(async (l) => ({ leagueId: l.league_id, rosters: await getLeagueRosters(l.league_id).catch(() => []) })),
    );
    const rosteredAcrossUserLeagues = new Map<string, number>();
    for (const entry of allLeagueRosters) {
      for (const r of entry.rosters) {
        for (const pid of r.players ?? []) {
          rosteredAcrossUserLeagues.set(pid, (rosteredAcrossUserLeagues.get(pid) ?? 0) + 1);
        }
      }
    }

    const allPlayers = await fetchAllNflPlayers().catch(() => ({} as Record<string, Record<string, unknown>>));
    const statsRows = await prisma.sleeperPlayerStats.findMany({
      where: {
        season,
        grouping: "week",
        week: { in: [week - 1, week - 2, week - 3].filter((w) => w > 0) },
      },
      select: { playerId: true, week: true, stats: true },
    });
    const weekly = new Map<string, Map<number, number>>();
    for (const row of statsRows) {
      if (!weekly.has(row.playerId)) weekly.set(row.playerId, new Map());
      weekly.get(row.playerId)!.set(row.week, scoreFromStats(row.stats));
    }

    for (const l of leagues) {
      const rosters = allLeagueRosters.find((x) => x.leagueId === l.league_id)?.rosters ?? [];
      const rostered = new Set<string>();
      for (const r of rosters) {
        for (const pid of r.players ?? []) rostered.add(pid);
      }

      const available: WaiverPlayer[] = [];
      for (const [playerId, data] of Object.entries(allPlayers)) {
        if (rostered.has(playerId)) continue;
        const name =
          (typeof data.full_name === "string" && data.full_name) ||
          `${typeof data.first_name === "string" ? data.first_name : ""} ${typeof data.last_name === "string" ? data.last_name : ""}`.trim();
        if (!name) continue;
        if (query && !name.toLowerCase().includes(query)) continue;
        const wk = weekly.get(playerId) ?? new Map<number, number>();
        const lastWeekPoints = wk.get(week - 1) ?? 0;
        const last3WeeksPoints = [week - 1, week - 2, week - 3].filter((w) => w > 0).reduce((sum, w) => sum + (wk.get(w) ?? 0), 0);
        const team = typeof data.team === "string" ? data.team : null;
        if (!team && last3WeeksPoints <= 0) continue;
        const ownershipPct = Math.round(((rosteredAcrossUserLeagues.get(playerId) ?? 0) / Math.max(1, leagues.length)) * 100);
        available.push({
          playerId,
          name,
          position: typeof data.position === "string" ? data.position : null,
          team,
          ownershipPct,
          lastWeekPoints,
          last3WeeksPoints,
        });
      }

      available.sort((a, b) => {
        if (sortBy === "lastWeek") return b.lastWeekPoints - a.lastWeekPoints || b.ownershipPct - a.ownershipPct;
        if (sortBy === "last3Weeks") return b.last3WeeksPoints - a.last3WeeksPoints || b.ownershipPct - a.ownershipPct;
        return b.ownershipPct - a.ownershipPct || b.last3WeeksPoints - a.last3WeeksPoints;
      });
      const sched = waiverRunSchedule(
        (l as unknown as { settings?: { waiver_day_of_week?: number; waiver_time?: number } }).settings,
      );
      byLeague.push({
        provider: "sleeper",
        leagueId: l.league_id,
        leagueName: l.name,
        leagueUrl: `https://sleeper.com/leagues/${l.league_id}/players`,
        waiverRunAt: sched.label,
        waiverRunDayOffset: sched.dayOffset,
        players: available.slice(0, 120),
      });
    }
  }

  if (espnIds.length) {
    const espnSeason = espnSeasonOrDefault(user, season);
    const espnS2 = user.espnS2?.trim() || undefined;
    const swid = user.espnSwid?.trim() || undefined;
    for (const rawId of espnIds) {
      try {
        const snap = await fetchEspnLeagueSnapshot({ leagueId: rawId, season: espnSeason, espnS2, swid });
        const ws = snap.waiverSchedule;
        const label = ws.label ?? "Unk";
        byLeague.push({
          provider: "espn",
          leagueId: `espn:${rawId}`,
          leagueName: snap.league?.name ?? `ESPN league ${rawId}`,
          leagueUrl: `https://fantasy.espn.com/football/league?leagueId=${rawId}`,
          waiverRunAt: label,
          waiverRunDayOffset: ws.dayOffset,
          players: [],
        });
      } catch {
        byLeague.push({
          provider: "espn",
          leagueId: `espn:${rawId}`,
          leagueName: `ESPN league ${rawId}`,
          leagueUrl: `https://fantasy.espn.com/football/league?leagueId=${rawId}`,
          waiverRunAt: "Unk",
          waiverRunDayOffset: null,
          players: [],
        });
      }
    }
  }

  byLeague.sort((a, b) => {
    const ta = a.waiverRunDayOffset ?? Number.POSITIVE_INFINITY;
    const tb = b.waiverRunDayOffset ?? Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    return a.leagueName.localeCompare(b.leagueName);
  });

  const filtered = byLeague.filter((l) => !query || l.provider === "espn" || l.players.length > 0);

  return Response.json({
    season,
    week,
    cached: true,
    generatedAt: new Date().toISOString(),
    leagues: filtered,
  });
}

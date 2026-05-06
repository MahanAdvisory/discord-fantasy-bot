import { requireSessionUser } from "@/lib/sessionUser";
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

const WAIVER_DAY_LABELS: Record<number, string> = {
  0: "Tuesday",
  1: "Wednesday",
  2: "Thursday",
  3: "Friday",
  4: "Saturday",
  5: "Sunday",
  6: "Monday",
};

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
  if (!user.sleeperUserId) {
    return Response.json({ error: "no_sleeper", message: "Link Sleeper in Discord with /link first." }, { status: 400 });
  }

  const url = new URL(req.url);
  const sortBy = (url.searchParams.get("sortBy") ?? "ownership") as "ownership" | "lastWeek" | "last3Weeks";
  const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();

  const nfl = await getNflState();
  const season = nfl.league_season ?? nfl.season;
  const week = Math.max(1, nfl.display_week ?? nfl.week ?? 1);
  const leagues = await getUserLeagues(user.sleeperUserId, season);
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

  const byLeague = [];
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
      // Relevance guard: drop stale/retired profiles with no team and no recent production.
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
    byLeague.push({
      leagueId: l.league_id,
      leagueName: l.name,
      leagueUrl: `https://sleeper.com/leagues/${l.league_id}/players`,
      waiverRunAt: (() => {
        const raw = (l as unknown as { settings?: { waiver_day_of_week?: number; waiver_time?: number } }).settings;
        if (!raw) return null;
        const day = raw.waiver_day_of_week;
        const time = raw.waiver_time;
        if (typeof day !== "number" && typeof time !== "number") return null;
        const dayLabel = typeof day === "number" ? (WAIVER_DAY_LABELS[day] ?? `Day ${day}`) : "Unknown day";
        const timeLabel = typeof time === "number" ? `${time}:00 UTC` : "time not provided";
        return `${dayLabel} @ ${timeLabel}`;
      })(),
      players: available.slice(0, 120),
    });
  }

  return Response.json({
    season,
    week,
    cached: true,
    generatedAt: new Date().toISOString(),
    leagues: byLeague.filter((l) => !query || l.players.length > 0),
  });
}

import { requireSessionUser } from "@/lib/sessionUser";
import { espnLeagueIdsFromJson } from "@fantasy/espn/linkedLeagues";
import { buildEspnLeagueDetailRows, type EspnLeagueDetailRow } from "@fantasy/services/espnDashboard";
import { getNflState, getUserLeagues, getLeagueRosters, type SleeperLeague } from "@fantasy/sleeper/client";
import { getDraft, getDraftPicks, getLeagueDrafts, getOnTheClockPickerUserId } from "@fantasy/sleeper/draftDetail";
import { getLeagueUsers } from "@fantasy/sleeper/leagueUsers";
import { analyzeLineupForLeague, loadPlayerLabels, loadProjectionMap } from "@fantasy/services/lineupCheck";

type Bucket = { label: string; players: string[] };
const WAIVER_DAY_SHORT: Record<number, string> = {
  0: "Tue",
  1: "Wed",
  2: "Thu",
  3: "Fri",
  4: "Sat",
  5: "Sun",
  6: "Mon",
};

function bucketLeagueRoster(
  starters: string[],
  reserve: string[],
  taxi: string[],
  allPlayers: string[],
): { starters: string[]; bench: string[]; reserveTaxi: string[] } {
  const starterSet = new Set(starters);
  const reserveTaxi = [...new Set([...reserve, ...taxi])];
  const reserveTaxiSet = new Set(reserveTaxi);
  const bench = allPlayers.filter((p) => !starterSet.has(p) && !reserveTaxiSet.has(p));
  return { starters, bench, reserveTaxi };
}

/** True if at least one rostered player label contains every whitespace-separated token (all case-insensitive). */
function rosterMatchesPlayerQuery(buckets: Bucket[], qNormalized: string): boolean {
  const tokens = qNormalized.split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const labels = buckets.flatMap((b) => b.players.map((p) => p.toLowerCase()));
  return labels.some((label) => tokens.every((t) => label.includes(t)));
}

type LeagueDraftSnapshot = {
  draftId: string;
  picksComplete: number;
  nextPickNumber: number;
  onTheClock: string | null;
  draftUrl: string;
};

async function draftSnapshotForLeague(l: SleeperLeague): Promise<LeagueDraftSnapshot | null> {
  if (l.status.trim().toLowerCase() !== "drafting") return null;
  const drafts = await getLeagueDrafts(l.league_id).catch(() => []);
  const active = drafts.find((d) => d.status === "drafting");
  const draftId = active?.draft_id ?? l.draft_id;
  if (!draftId) return null;

  const [detail, picks, users] = await Promise.all([
    getDraft(draftId).catch(() => null),
    getDraftPicks(draftId).catch(() => []),
    getLeagueUsers(l.league_id).catch(() => []),
  ]);

  const userLabels = new Map<string, string>();
  for (const u of users) {
    if (!u.user_id) continue;
    const label =
      u.username?.trim() ||
      u.display_name?.trim() ||
      u.metadata?.team_name?.trim() ||
      u.user_id;
    userLabels.set(u.user_id, label);
  }

  let onTheClock: string | null = null;
  if (detail) {
    const uid = getOnTheClockPickerUserId(detail, picks.length);
    if (uid) onTheClock = userLabels.get(uid) ?? uid;
  }

  const n = picks.length;
  return {
    draftId,
    picksComplete: n,
    nextPickNumber: n + 1,
    onTheClock,
    draftUrl: `https://sleeper.com/draft/nfl/${draftId}`,
  };
}

export async function GET(req: Request) {
  const { user } = await requireSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().toLowerCase();
  const espnIds = espnLeagueIdsFromJson(user.espnLeagueIds);

  if (!user.sleeperUserId) {
    if (!espnIds.length) {
      return Response.json(
        { error: "no_sleeper", message: "Link Sleeper on the Help page (or /link), or add ESPN leagues on Help." },
        { status: 400 },
      );
    }
    const espnRows = await buildEspnLeagueDetailRows(user, q);
    espnRows.sort((a, b) => a.leagueName.localeCompare(b.leagueName));
    return Response.json(
      { leagues: espnRows },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const nfl = await getNflState();
  const season = nfl.league_season ?? nfl.season;
  const leagues = await getUserLeagues(user.sleeperUserId, season);
  const projections = await loadProjectionMap();

  type SleeperLeagueDetailRow = {
    provider: "sleeper";
    leagueId: string;
    leagueName: string;
    status: string;
    draftId: string | null;
    draftSnapshot: LeagueDraftSnapshot | null;
    wins: number;
    losses: number;
    ties: number;
    recordPct: number;
    waiverRunDay: string;
    lineupHasIssue: boolean;
    lineupUrl: string;
    rosterBuckets: Bucket[];
  };
  const out: Array<SleeperLeagueDetailRow | EspnLeagueDetailRow> = [];
  for (const l of leagues) {
    const rosters = await getLeagueRosters(l.league_id).catch(() => []);
    const myRoster = rosters.find((r) => r.owner_id === user.sleeperUserId);
    if (!myRoster) continue;
    const starters = (myRoster.starters ?? []).filter((p): p is string => typeof p === "string");
    const reserve = (myRoster.reserve ?? []).filter((p): p is string => typeof p === "string");
    const taxi = (myRoster.taxi ?? []).filter((p): p is string => typeof p === "string");
    const players = (myRoster.players ?? []).filter((p): p is string => typeof p === "string");
    const bucketed = bucketLeagueRoster(starters, reserve, taxi, players);
    const labels = await loadPlayerLabels(players);

    const toNamed = (ids: string[]) =>
      ids.map((id) => {
        if (id === "0") return "EMPTY SLOT";
        const named = labels.get(id) ?? id;
        return named === "0" ? "EMPTY SLOT" : named;
      });
    const buckets: Bucket[] = [
      { label: "Starters", players: toNamed(bucketed.starters) },
      { label: "Bench", players: toNamed(bucketed.bench) },
      { label: "IR/Taxi", players: toNamed(bucketed.reserveTaxi) },
    ];

    if (q && !rosterMatchesPlayerQuery(buckets, q)) continue;
    const wins = myRoster.settings?.wins ?? 0;
    const losses = myRoster.settings?.losses ?? 0;
    const ties = myRoster.settings?.ties ?? 0;
    const lineupOutcome = await analyzeLineupForLeague(user.sleeperUserId, l.league_id, { projections });
    const waiverDayRaw = (l as unknown as { settings?: { waiver_day_of_week?: number } }).settings?.waiver_day_of_week;
    const draftSnapshot = await draftSnapshotForLeague(l);
    out.push({
      provider: "sleeper",
      leagueId: l.league_id,
      leagueName: l.name,
      status: l.status,
      draftId: l.draft_id ?? null,
      draftSnapshot,
      wins,
      losses,
      ties,
      recordPct: (wins + 0.5 * ties) / Math.max(1, wins + losses + ties),
      waiverRunDay: typeof waiverDayRaw === "number" ? (WAIVER_DAY_SHORT[waiverDayRaw] ?? "—") : "—",
      lineupHasIssue: lineupOutcome.kind !== "ok",
      rosterBuckets: buckets,
      lineupUrl: `https://sleeper.com/leagues/${l.league_id}/team`,
    });
  }

  const espnRows = await buildEspnLeagueDetailRows(user, q);
  out.push(...espnRows);

  out.sort((a, b) => {
    const rank = (s: string) => {
      const v = s.trim().toLowerCase();
      if (v === "drafting") return 0;
      if (v === "in_season" || v === "in season") return 1;
      if (v === "pre_draft" || v === "predraft" || v === "pre draft") return 2;
      if (v === "complete") return 3;
      return 4;
    };
    const d = rank(a.status) - rank(b.status);
    if (d !== 0) return d;
    const rec = b.recordPct - a.recordPct;
    if (rec !== 0) return rec;
    return a.leagueName.localeCompare(b.leagueName);
  });

  return Response.json(
    { leagues: out },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

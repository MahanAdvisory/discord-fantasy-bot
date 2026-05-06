import { requireSessionUser } from "@/lib/sessionUser";
import { getNflState, getUserLeagues, getLeagueRosters } from "@fantasy/sleeper/client";
import { getLeagueUsers } from "@fantasy/sleeper/leagueUsers";
import { loadPlayerLabels } from "@fantasy/services/lineupCheck";

type Bucket = { label: string; players: string[] };

function bucketLeagueRoster(
  starters: string[],
  reserve: string[],
  allPlayers: string[],
): { starters: string[]; bench: string[]; reserve: string[] } {
  const starterSet = new Set(starters);
  const reserveSet = new Set(reserve);
  const bench = allPlayers.filter((p) => !starterSet.has(p) && !reserveSet.has(p));
  return { starters, bench, reserve };
}

export async function GET(req: Request) {
  const { user } = await requireSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.sleeperUserId) {
    return Response.json({ error: "no_sleeper", message: "Link Sleeper in Discord with /link first." }, { status: 400 });
  }
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().toLowerCase();

  const nfl = await getNflState();
  const season = nfl.league_season ?? nfl.season;
  const leagues = await getUserLeagues(user.sleeperUserId, season);

  const out = [];
  for (const l of leagues) {
    const [users, rosters] = await Promise.all([
      getLeagueUsers(l.league_id).catch(() => []),
      getLeagueRosters(l.league_id).catch(() => []),
    ]);
    const myRoster = rosters.find((r) => r.owner_id === user.sleeperUserId);
    if (!myRoster) continue;
    const starters = (myRoster.starters ?? []).filter((p): p is string => typeof p === "string");
    const reserve = (myRoster.reserve ?? []).filter((p): p is string => typeof p === "string");
    const players = (myRoster.players ?? []).filter((p): p is string => typeof p === "string");
    const bucketed = bucketLeagueRoster(starters, reserve, players);
    const labels = await loadPlayerLabels(players);

    const toNamed = (ids: string[]) => ids.map((id) => labels.get(id) ?? id);
    const buckets: Bucket[] = [
      { label: "Starters", players: toNamed(bucketed.starters) },
      { label: "Bench", players: toNamed(bucketed.bench) },
      { label: "IR / Taxi / Reserve", players: toNamed(bucketed.reserve) },
    ];

    if (q) {
      const anyMatch = buckets.some((b) => b.players.some((p) => p.toLowerCase().includes(q)));
      if (!anyMatch) continue;
    }
    const wins = myRoster.settings?.wins ?? 0;
    const losses = myRoster.settings?.losses ?? 0;
    const ties = myRoster.settings?.ties ?? 0;
    out.push({
      leagueId: l.league_id,
      leagueName: l.name,
      status: l.status,
      wins,
      losses,
      ties,
      recordPct: (wins + 0.5 * ties) / Math.max(1, wins + losses + ties),
      rosterBuckets: buckets,
      lineupUrl: `https://sleeper.com/leagues/${l.league_id}/team`,
    });
  }

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

  return Response.json({ leagues: out });
}

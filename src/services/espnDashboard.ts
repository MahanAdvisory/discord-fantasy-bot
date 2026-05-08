import { fetchEspnLeagueSnapshot } from "../adapters/espn/index.js";
import type { DashboardSnapshot } from "../domain/dashboard.js";
import { applySleeperLabelsToEspnRosters } from "../espn/espnSleeperPlayerCrosswalk.js";
import {
  espnLeagueIdsFromJson,
  espnSeasonOrDefault,
  espnTeamByLeagueFromJson,
  espnTeamIdForLeague,
  type EspnLinkFields,
} from "../espn/linkedLeagues.js";
import { getNflState } from "../sleeper/client.js";

type Bucket = { label: string; players: string[] };

function rosterBucketsMatchQuery(buckets: Bucket[], qNormalized: string): boolean {
  const tokens = qNormalized.split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const labels = buckets.flatMap((b) => b.players.map((p) => p.toLowerCase()));
  return labels.some((label) => tokens.every((t) => label.includes(t)));
}

function mapEspnLeagueStatus(args: {
  leagueStatus: string;
  draftStatus: string;
}): string {
  if (args.draftStatus === "drafting") return "drafting";
  if (args.leagueStatus === "in_season") return "in_season";
  if (args.draftStatus === "pre_draft") return "pre_draft";
  if (args.draftStatus === "complete") return "in_season";
  return args.leagueStatus || "unknown";
}

export async function appendEspnLeaguesToDashboardSnapshot(
  snapshot: DashboardSnapshot,
  user: EspnLinkFields,
): Promise<void> {
  const ids = espnLeagueIdsFromJson(user.espnLeagueIds);
  if (!ids.length) return;
  const season = espnSeasonOrDefault(user, snapshot.nfl.season);
  const espnS2 = user.espnS2?.trim() || undefined;
  const swid = user.espnSwid?.trim() || undefined;
  const teamMap = espnTeamByLeagueFromJson(user.espnTeamByLeague);

  for (const rawId of ids) {
    try {
      const snap = await fetchEspnLeagueSnapshot({ leagueId: rawId, season, espnS2, swid });
      const status = mapEspnLeagueStatus({
        leagueStatus: snap.league?.status ?? "unknown",
        draftStatus: snap.draft.status,
      });
      const leagueId = `espn:${rawId}`;
      const myTeamId = espnTeamIdForLeague(teamMap, rawId);
      const rec = myTeamId != null ? snap.teamRecordByTeamId.get(myTeamId) : undefined;
      const wins = rec?.wins ?? 0;
      const losses = rec?.losses ?? 0;
      const ties = rec?.ties ?? 0;
      snapshot.leagues.push({
        provider: "espn",
        leagueId,
        name: snap.league?.name ?? `ESPN league ${rawId}`,
        status,
        season,
        totalRosters: snap.rosters.length,
        draftId: null,
        wins,
        losses,
        ties,
        recordLabel: rec ? (ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`) : "—",
        leagueUrl: `https://fantasy.espn.com/football/league?leagueId=${rawId}`,
      });
      if (snap.draft.status === "drafting") {
        const cur = snap.draft.currentPick ?? 1;
        snapshot.activeDrafts.push({
          provider: "espn",
          draftId: `espn-draft:${rawId}`,
          leagueId,
          leagueName: snap.league?.name ?? `ESPN ${rawId}`,
          status: "drafting",
          draftType: null,
          pickCount: Math.max(0, cur - 1),
          onTheClockLabel: snap.draft.onTheClockTeam ?? null,
          draftUrl: `https://fantasy.espn.com/football/draft?leagueId=${rawId}`,
          leagueUrl: `https://fantasy.espn.com/football/league?leagueId=${rawId}`,
        });
      }
    } catch {
      /* omit failed league */
    }
  }
}

export async function buildEspnOnlyDashboardSnapshot(user: EspnLinkFields): Promise<DashboardSnapshot> {
  const state = await getNflState();
  const season = state.league_season ?? state.season;
  const snapshot: DashboardSnapshot = {
    nfl: {
      season,
      week: Math.max(1, state.leg ?? state.display_week ?? state.week ?? 1),
      seasonType: state.season_type,
      displayWeek: state.display_week ?? state.week ?? 1,
    },
    leagues: [],
    activeDrafts: [],
    linkedSleeperUsername: null,
  };
  await appendEspnLeaguesToDashboardSnapshot(snapshot, user);
  return snapshot;
}

export type EspnLeagueDetailRow = {
  provider: "espn";
  leagueId: string;
  leagueName: string;
  status: string;
  draftId: string | null;
  draftSnapshot: {
    draftId: string;
    picksComplete: number;
    nextPickNumber: number;
    onTheClock: string | null;
    draftUrl: string;
  } | null;
  wins: number;
  losses: number;
  ties: number;
  recordPct: number;
  waiverRunDay: string;
  lineupHasIssue: boolean;
  lineupUrl: string;
  rosterBuckets: Bucket[];
};

export async function buildEspnLeagueDetailRows(user: EspnLinkFields, q: string): Promise<EspnLeagueDetailRow[]> {
  const ids = espnLeagueIdsFromJson(user.espnLeagueIds);
  if (!ids.length) return [];
  const nfl = await getNflState();
  const nflSeason = nfl.league_season ?? nfl.season;
  const season = espnSeasonOrDefault(user, nflSeason);
  const espnS2 = user.espnS2?.trim() || undefined;
  const swid = user.espnSwid?.trim() || undefined;
  const qn = q.trim().toLowerCase();
  const out: EspnLeagueDetailRow[] = [];
  const teamMap = espnTeamByLeagueFromJson(user.espnTeamByLeague);

  for (const rawId of ids) {
    try {
      const snap = await fetchEspnLeagueSnapshot({ leagueId: rawId, season, espnS2, swid });
      const status = mapEspnLeagueStatus({
        leagueStatus: snap.league?.status ?? "unknown",
        draftStatus: snap.draft.status,
      });
      const myTeamId = espnTeamIdForLeague(teamMap, rawId);
      let rosters = snap.rosters;
      if (myTeamId != null) rosters = rosters.filter((t) => t.teamId === myTeamId);
      await applySleeperLabelsToEspnRosters(rosters);

      const buckets: Bucket[] = [];
      for (const t of rosters) {
        buckets.push({ label: `${t.teamName} · Starters`, players: t.buckets.starters });
        buckets.push({ label: `${t.teamName} · Bench`, players: t.buckets.bench });
        if (t.buckets.reserve.length) {
          buckets.push({ label: `${t.teamName} · IR / reserve`, players: t.buckets.reserve });
        }
      }
      if (qn && !rosterBucketsMatchQuery(buckets, qn)) continue;

      const leagueId = `espn:${rawId}`;
      const cur = snap.draft.currentPick ?? 1;
      const draftSnapshot =
        snap.draft.status === "drafting"
          ? {
              draftId: `espn:${rawId}`,
              picksComplete: Math.max(0, cur - 1),
              nextPickNumber: cur,
              onTheClock: snap.draft.onTheClockTeam ?? null,
              draftUrl: `https://fantasy.espn.com/football/draft?leagueId=${rawId}`,
            }
          : null;

      const rec = myTeamId != null ? snap.teamRecordByTeamId.get(myTeamId) : undefined;
      const wins = rec?.wins ?? 0;
      const losses = rec?.losses ?? 0;
      const ties = rec?.ties ?? 0;
      const recordPct = (wins + 0.5 * ties) / Math.max(1, wins + losses + ties);

      out.push({
        provider: "espn",
        leagueId,
        leagueName: snap.league?.name ?? `ESPN league ${rawId}`,
        status,
        draftId: null,
        draftSnapshot,
        wins,
        losses,
        ties,
        recordPct,
        waiverRunDay: snap.waiverSchedule.label ?? "Unk",
        lineupHasIssue: false,
        lineupUrl:
          myTeamId != null
            ? `https://fantasy.espn.com/football/team?leagueId=${rawId}&teamId=${myTeamId}`
            : `https://fantasy.espn.com/football/league?leagueId=${rawId}`,
        rosterBuckets: buckets,
      });
    } catch {
      /* skip */
    }
  }

  return out;
}

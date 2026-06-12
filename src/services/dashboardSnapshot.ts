import {
  getLeagueRosters,
  getNflState,
  getUserLeagues,
  type SleeperLeague,
} from "../sleeper/client.js";
import { buildDraftLiveSnapshot } from "../sleeper/draftLiveSnapshot.js";
import { getLeagueDrafts } from "../sleeper/draftDetail.js";
import { findRosterForUser } from "../sleeper/rosterOwnership.js";
import type { DashboardDraftRow, DashboardLeagueRow, DashboardSnapshot } from "../domain/dashboard.js";
import { sleeperLeagueUrlPlain } from "../domain/sleeperLinks.js";

function leagueRow(l: SleeperLeague): DashboardLeagueRow {
  return {
    provider: "sleeper",
    leagueId: l.league_id,
    name: l.name,
    status: l.status,
    season: l.season,
    totalRosters: l.total_rosters,
    draftId: l.draft_id ?? null,
    wins: 0,
    losses: 0,
    ties: 0,
    recordLabel: "0-0",
    leagueUrl: sleeperLeagueUrlPlain(l.league_id),
  };
}

/**
 * Read-only aggregate for the web dashboard (and tools): leagues + drafting highlights.
 */
export async function buildSleeperDashboardSnapshot(
  sleeperUserId: string,
  sleeperUsername: string | null,
): Promise<DashboardSnapshot> {
  const state = await getNflState();
  const season = state.league_season ?? state.season;
  const leaguesRaw = await getUserLeagues(sleeperUserId, season);
  const leagues = leaguesRaw.map(leagueRow);

  const activeDrafts: DashboardDraftRow[] = [];

  for (const l of leaguesRaw) {
    const rosters = await getLeagueRosters(l.league_id).catch(() => []);
    const myRoster = findRosterForUser(rosters, sleeperUserId);
    const wins = myRoster?.settings?.wins ?? 0;
    const losses = myRoster?.settings?.losses ?? 0;
    const ties = myRoster?.settings?.ties ?? 0;
    const row = leagues.find((x) => x.leagueId === l.league_id);
    if (row) {
      row.wins = wins;
      row.losses = losses;
      row.ties = ties;
      row.recordLabel = ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
    }

    const drafts = await getLeagueDrafts(l.league_id).catch(() => [] as { draft_id: string; status: string }[]);
    for (const d of drafts) {
      if (d.status !== "drafting") continue;
      const live = await buildDraftLiveSnapshot(l.league_id, d.draft_id);
      if (!live) continue;

      activeDrafts.push({
        provider: "sleeper",
        draftId: live.draftId,
        leagueId: l.league_id,
        leagueName: l.name,
        status: d.status,
        draftType: live.draftType,
        pickCount: live.picksComplete,
        onTheClockLabel: live.onTheClock,
        draftUrl: live.draftUrl,
        leagueUrl: sleeperLeagueUrlPlain(l.league_id),
        lastPick: live.lastPick,
        auction: live.auction,
      });
    }
  }

  return {
    nfl: {
      season,
      week: Math.max(1, state.leg ?? state.display_week ?? state.week ?? 1),
      seasonType: state.season_type,
      displayWeek: state.display_week ?? state.week ?? 1,
    },
    leagues,
    activeDrafts,
    linkedSleeperUsername: sleeperUsername,
  };
}

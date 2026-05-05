import {
  getLeagueRosters,
  getNflState,
  getUserLeagues,
  type SleeperLeague,
} from "../sleeper/client.js";
import {
  getDraft,
  getDraftPicks,
  getLeagueDrafts,
  getOnTheClockPickerUserId,
} from "../sleeper/draftDetail.js";
import { getLeagueUsers } from "../sleeper/leagueUsers.js";
import type { DashboardDraftRow, DashboardLeagueRow, DashboardSnapshot } from "../domain/dashboard.js";
import { sleeperDraftUrlPlain, sleeperLeagueUrlPlain } from "../domain/sleeperLinks.js";

async function userLabelMap(leagueId: string): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  try {
    const users = await getLeagueUsers(leagueId);
    for (const u of users) {
      if (!u.user_id) continue;
      const team = u.metadata?.team_name?.trim();
      const label = u.username?.trim() || u.display_name?.trim() || team || u.user_id;
      m.set(u.user_id, label);
    }
  } catch {
    /* */
  }
  return m;
}

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
    const myRoster = rosters.find((r) => r.owner_id === sleeperUserId);
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
      const detail = await getDraft(d.draft_id).catch(() => null);
      const picks = await getDraftPicks(d.draft_id).catch(() => []);
      const labels = await userLabelMap(l.league_id);
      let onTheClockLabel: string | null = null;
      if (detail) {
        const uid = getOnTheClockPickerUserId(detail, picks.length);
        if (uid) onTheClockLabel = labels.get(uid) ?? uid;
      }

      activeDrafts.push({
        provider: "sleeper",
        draftId: d.draft_id,
        leagueId: l.league_id,
        leagueName: l.name,
        status: d.status,
        draftType: detail?.type ?? null,
        pickCount: picks.length,
        onTheClockLabel,
        draftUrl: sleeperDraftUrlPlain(d.draft_id),
        leagueUrl: sleeperLeagueUrlPlain(l.league_id),
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

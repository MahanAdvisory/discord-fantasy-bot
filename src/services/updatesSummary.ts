import * as sleeper from "../sleeper/client.js";

/**
 * On-demand summary for `/updates` (rule D: user-triggered). Reuses Sleeper reads only.
 */
export async function buildLeagueUpdatesSummary(sleeperUserId: string): Promise<string> {
  const state = await sleeper.getNflState();
  const season = state.league_season ?? state.season;
  const leagues = await sleeper.getUserLeagues(sleeperUserId, season);
  const drafts = await sleeper.getUserDrafts(sleeperUserId, season);
  const activeDrafts = drafts.filter((d) => d.status !== "complete");

  const lines: string[] = [];
  lines.push(`**NFL state:** week ${state.display_week ?? state.week} · ${state.season_type} · season ${season}`);
  if (leagues.length) {
    lines.push("");
    lines.push("**Leagues**");
    for (const l of leagues) {
      lines.push(`• **${l.name}** — \`${l.league_id}\` — _${l.status}_`);
    }
  } else {
    lines.push("");
    lines.push("_No leagues this season._");
  }
  if (activeDrafts.length) {
    lines.push("");
    lines.push("**Active / incomplete drafts**");
    for (const d of activeDrafts) {
      lines.push(`• \`${d.draft_id}\` — _${d.status}_ — league \`${d.league_id}\``);
    }
  }
  lines.push("");
  lines.push("_Hourly digests and live alerts will use your notification routes (Phase B)._");
  return lines.join("\n");
}

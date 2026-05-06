/**
 * ESPN notification-ingest smoke check.
 *
 * Usage (public league):
 *   ESPN_UNOFFICIAL_ENABLED=true ESPN_LEAGUE_ID=123 ESPN_SEASON=2025 npx tsx scripts/spikes/espn-notification-smoke.ts
 *
 * Usage (private league):
 *   ESPN_UNOFFICIAL_ENABLED=true ESPN_LEAGUE_ID=123 ESPN_SEASON=2025 ESPN_S2=... ESPN_SWID=... npx tsx scripts/spikes/espn-notification-smoke.ts
 */
import { fetchEspnLeagueSnapshot } from "../../src/adapters/espn/index.js";

const leagueId = process.env.ESPN_LEAGUE_ID?.trim();
const season = process.env.ESPN_SEASON?.trim() ?? String(new Date().getUTCFullYear());
const espnS2 = process.env.ESPN_S2;
const swid = process.env.ESPN_SWID;

if (!leagueId) {
  console.error("Set ESPN_LEAGUE_ID (from the ESPN league URL).");
  process.exit(1);
}

const out = await fetchEspnLeagueSnapshot({ leagueId, season, espnS2, swid });

console.log(
  JSON.stringify(
    {
      sourceUrl: out.sourceUrl,
      league: out.league,
      draft: out.draft,
      rosterTeams: out.rosters.length,
      rosterSample: out.rosters.slice(0, 2),
      recentCount: out.recent.length,
      sampleRecent: out.recent.slice(0, 8),
    },
    null,
    2,
  ),
);

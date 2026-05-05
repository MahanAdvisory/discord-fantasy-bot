/**
 * Spike: read a public ESPN fantasy football league (no auth).
 * Unofficial API — for investigation only.
 *
 *   ESPN_LEAGUE_ID=123456 ESPN_SEASON=2025 npx tsx scripts/spikes/espn-public-league.ts
 */
const leagueId = process.env.ESPN_LEAGUE_ID;
const season = process.env.ESPN_SEASON ?? "2025";

if (!leagueId) {
  console.error("Set ESPN_LEAGUE_ID to a public league id (from the league URL).");
  process.exit(1);
}

// Base used by many community clients (see ESPN fantasy v3 notes).
const base = "https://lm-api-reads.fantasy.espn.com/apis/v3/games";
const url = `${base}/ffl/seasons/${season}/segments/0/leagues/${leagueId}?view=mTeam&view=mSettings&view=mMatchupScore`;

const res = await fetch(url, {
  headers: {
    Accept: "application/json",
  },
});

if (!res.ok) {
  const text = await res.text();
  console.error("HTTP", res.status, text.slice(0, 500));
  process.exit(1);
}

const data = (await res.json()) as {
  settings?: { name?: string };
  teams?: { id: number; name: string }[];
};

console.log(
  JSON.stringify(
    {
      url,
      leagueName: data.settings?.name,
      teamCount: data.teams?.length,
      sampleTeamNames: data.teams?.slice(0, 3).map((t) => t.name),
    },
    null,
    2,
  ),
);

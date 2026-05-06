/**
 * Yahoo leagues discovery smoke.
 *
 * Uses refresh token to get access token, then:
 * 1) fetches NFL game entries for logged-in user
 * 2) extracts candidate game keys
 * 3) fetches leagues for each game key
 *
 * Env:
 *   YAHOO_CLIENT_ID
 *   YAHOO_CLIENT_SECRET
 *   YAHOO_REFRESH_TOKEN
 */

const id = process.env.YAHOO_CLIENT_ID;
const secret = process.env.YAHOO_CLIENT_SECRET;
const refresh = process.env.YAHOO_REFRESH_TOKEN;

if (!id || !secret || !refresh) {
  console.error("Missing Yahoo env: YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET / YAHOO_REFRESH_TOKEN");
  process.exit(1);
}

async function getAccessToken(): Promise<string> {
  const tokenRes = await fetch("https://api.login.yahoo.com/oauth2/get_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: id,
      client_secret: secret,
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`Token refresh failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const tokenJson = (await tokenRes.json()) as { access_token: string };
  return tokenJson.access_token;
}

function extractGameKeys(payload: unknown): string[] {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    const rec = v as Record<string, unknown>;
    if (typeof rec.game_key === "string") out.add(rec.game_key);
    for (const val of Object.values(rec)) walk(val);
  };
  walk(payload);
  return [...out];
}

function extractLeagueRows(payload: unknown): Array<{ leagueKey: string; name: string | null; season: string | null }> {
  const rows: Array<{ leagueKey: string; name: string | null; season: string | null }> = [];
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    const rec = v as Record<string, unknown>;
    if (typeof rec.league_key === "string") {
      rows.push({
        leagueKey: rec.league_key,
        name: typeof rec.name === "string" ? rec.name : null,
        season: typeof rec.season === "string" ? rec.season : null,
      });
    }
    for (const val of Object.values(rec)) walk(val);
  };
  walk(payload);
  return rows;
}

const access = await getAccessToken();
const gamesUrl = "https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_codes=nfl?format=json";
const gamesRes = await fetch(gamesUrl, {
  headers: { Authorization: `Bearer ${access}` },
});
if (!gamesRes.ok) {
  console.error("User games call failed", gamesRes.status, await gamesRes.text().then((t) => t.slice(0, 500)));
  process.exit(1);
}
const gamesJson = await gamesRes.json();
const gameKeys = extractGameKeys(gamesJson);

const leaguesByGame: Record<string, Array<{ leagueKey: string; name: string | null; season: string | null }>> = {};
for (const gameKey of gameKeys) {
  const leaguesUrl = `https://fantasysports.yahooapis.com/fantasy/v2/game/${encodeURIComponent(gameKey)}/leagues;use_login=1?format=json`;
  const res = await fetch(leaguesUrl, { headers: { Authorization: `Bearer ${access}` } });
  if (!res.ok) {
    leaguesByGame[gameKey] = [];
    continue;
  }
  const j = await res.json();
  leaguesByGame[gameKey] = extractLeagueRows(j);
}

const allLeagues = Object.values(leaguesByGame).flat();
console.log(
  JSON.stringify(
    {
      ok: true,
      gameKeys,
      leagueCount: allLeagues.length,
      leaguesByGame,
    },
    null,
    2,
  ),
);

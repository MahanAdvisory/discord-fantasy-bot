/**
 * Spike: minimal Yahoo Fantasy API call after OAuth2 token exchange.
 * Set env or see printed instructions. Does nothing destructive (GET user games).
 *
 *   YAHOO_CLIENT_ID=... YAHOO_CLIENT_SECRET=... YAHOO_REFRESH_TOKEN=... npx tsx scripts/spikes/yahoo-fantasy-smoke.ts
 */
const id = process.env.YAHOO_CLIENT_ID;
const secret = process.env.YAHOO_CLIENT_SECRET;
const refresh = process.env.YAHOO_REFRESH_TOKEN;

if (!id || !secret || !refresh) {
  console.log(
    `Yahoo Fantasy spike — missing env.

Create an app at https://developer.yahoo.com/apps/ and obtain:
  - YAHOO_CLIENT_ID
  - YAHOO_CLIENT_SECRET
Run Yahoo OAuth2 authorization code flow to get a refresh token, then:
  - YAHOO_REFRESH_TOKEN

This script calls https://api.login.yahoo.com/oauth2/get_token to refresh, then
GET https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_codes=nfl

No credentials were found — exiting without error.`,
  );
  process.exit(0);
}

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
  console.error("Token refresh failed", tokenRes.status, await tokenRes.text());
  process.exit(1);
}

const tokenJson = (await tokenRes.json()) as { access_token: string };
const access = tokenJson.access_token;

const apiUrl =
  "https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_codes=nfl?format=json";
const gameRes = await fetch(apiUrl, {
  headers: { Authorization: `Bearer ${access}` },
});

if (!gameRes.ok) {
  console.error("Fantasy API failed", gameRes.status, await gameRes.text().then((t) => t.slice(0, 400)));
  process.exit(1);
}

const gameJson = await gameRes.json();
console.log(JSON.stringify({ ok: true, sampleKeys: Object.keys(gameJson) }, null, 2));
console.log(JSON.stringify(gameJson, null, 2).slice(0, 2000), gameJson ? "…" : "");

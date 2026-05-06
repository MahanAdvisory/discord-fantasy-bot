/**
 * Print Yahoo OAuth authorization URL (one-time setup).
 *
 * Usage:
 *   YAHOO_CLIENT_ID=... YAHOO_REDIRECT_URI=http://localhost:3000/api/auth/callback/yahoo npx tsx scripts/spikes/yahoo-oauth-url.ts
 */

const clientId = process.env.YAHOO_CLIENT_ID;
const redirectUri = process.env.YAHOO_REDIRECT_URI ?? "http://localhost:3000/api/auth/callback/yahoo";
const scope = process.env.YAHOO_SCOPE ?? "fspt-r";
const state = process.env.YAHOO_OAUTH_STATE ?? "yahoo-spike";

if (!clientId) {
  console.error("Missing YAHOO_CLIENT_ID");
  process.exit(1);
}

const q = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: "code",
  language: "en-us",
  scope,
  state,
});

const url = `https://api.login.yahoo.com/oauth2/request_auth?${q.toString()}`;
console.log("\nOpen this URL in browser and approve access:\n");
console.log(url);
console.log("\nAfter redirect, copy `code` from the callback URL and run `npm run yahoo:exchange`.\n");

/**
 * Exchange Yahoo OAuth authorization code for tokens.
 *
 * Usage:
 *   YAHOO_CLIENT_ID=... YAHOO_CLIENT_SECRET=... YAHOO_REDIRECT_URI=http://localhost:3000/api/auth/callback/yahoo YAHOO_AUTH_CODE=... npx tsx scripts/spikes/yahoo-oauth-exchange.ts
 */

const clientId = process.env.YAHOO_CLIENT_ID;
const clientSecret = process.env.YAHOO_CLIENT_SECRET;
const redirectUri = process.env.YAHOO_REDIRECT_URI ?? "http://localhost:3000/api/auth/callback/yahoo";
const authCode = process.env.YAHOO_AUTH_CODE;

if (!clientId || !clientSecret || !authCode) {
  console.error("Missing one or more required env vars: YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET, YAHOO_AUTH_CODE");
  process.exit(1);
}

const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
const res = await fetch("https://api.login.yahoo.com/oauth2/get_token", {
  method: "POST",
  headers: {
    Authorization: `Basic ${authHeader}`,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code: authCode,
    redirect_uri: redirectUri,
  }),
});

if (!res.ok) {
  console.error("Code exchange failed", res.status, await res.text().then((t) => t.slice(0, 400)));
  process.exit(1);
}

const json = (await res.json()) as {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
};

console.log(
  JSON.stringify(
    {
      ok: true,
      tokenType: json.token_type ?? null,
      expiresIn: json.expires_in ?? null,
      hasAccessToken: Boolean(json.access_token),
      hasRefreshToken: Boolean(json.refresh_token),
      refreshToken: json.refresh_token ?? null,
    },
    null,
    2,
  ),
);
console.log("\nSet YAHOO_REFRESH_TOKEN to the value above, then run `npm run yahoo:smoke`.\n");

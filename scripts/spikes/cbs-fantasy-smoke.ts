/**
 * CBS Fantasy/Open Platform smoke check (investigation mode).
 *
 * This script does NOT assume the platform is currently open for new apps.
 * It validates configured credentials against the token endpoint and, if a token is
 * returned, optionally probes a caller-provided API URL.
 *
 * Env:
 *   CBS_APP_ID
 *   CBS_APP_SECRET
 *
 * Optional:
 *   CBS_TOKEN_URL      (default: https://api.cbssports.com/general/oauth/generate_token)
 *   CBS_API_SMOKE_URL  (full URL to test with bearer token; no default due endpoint uncertainty)
 */

const appId = process.env.CBS_APP_ID?.trim();
const appSecret = process.env.CBS_APP_SECRET?.trim();
const tokenUrl =
  process.env.CBS_TOKEN_URL?.trim() ||
  "https://api.cbssports.com/general/oauth/generate_token";
const apiSmokeUrl = process.env.CBS_API_SMOKE_URL?.trim();

if (!appId || !appSecret) {
  console.log(
    `CBS smoke — missing env.

Set:
  - CBS_APP_ID
  - CBS_APP_SECRET

Optional:
  - CBS_TOKEN_URL
  - CBS_API_SMOKE_URL

This script will try token exchange first and print the raw response summary.`,
  );
  process.exit(0);
}

const tokenRes = await fetch(tokenUrl, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    app_id: appId,
    app_secret: appSecret,
  }),
});

const tokenBody = await tokenRes.text();
let parsed: Record<string, unknown> | null = null;
try {
  parsed = JSON.parse(tokenBody) as Record<string, unknown>;
} catch {
  parsed = null;
}

if (!tokenRes.ok) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        stage: "token_exchange",
        status: tokenRes.status,
        tokenUrl,
        bodyPreview: tokenBody.slice(0, 500),
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const accessToken =
  (parsed?.access_token as string | undefined) ||
  (parsed?.token as string | undefined) ||
  null;

const result: Record<string, unknown> = {
  ok: true,
  stage: "token_exchange",
  tokenUrl,
  responseKeys: parsed ? Object.keys(parsed) : [],
  hasAccessToken: Boolean(accessToken),
};

if (!accessToken || !apiSmokeUrl) {
  console.log(JSON.stringify(result, null, 2));
  if (!apiSmokeUrl) {
    console.log(
      "\nSet CBS_API_SMOKE_URL to probe an authenticated CBS fantasy endpoint once you confirm one.",
    );
  }
  process.exit(0);
}

const apiRes = await fetch(apiSmokeUrl, {
  headers: {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  },
});
const apiBody = await apiRes.text();
console.log(
  JSON.stringify(
    {
      ...result,
      stage: "api_probe",
      apiSmokeUrl,
      apiStatus: apiRes.status,
      apiOk: apiRes.ok,
      apiBodyPreview: apiBody.slice(0, 600),
    },
    null,
    2,
  ),
);

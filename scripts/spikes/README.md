# API spikes

Time-boxed scripts to validate external fantasy APIs. Run with `npx tsx` from repo root.

## ESPN public league (`espn-public-league.ts`)

Fetches a **public** ESPN fantasy football league without cookies.

**Env:**

- `ESPN_LEAGUE_ID` — numeric league id (from URL)
- `ESPN_SEASON` — e.g. `2025`

**Example:**

```bash
set ESPN_LEAGUE_ID=123456
set ESPN_SEASON=2025
npx tsx scripts/spikes/espn-public-league.ts
```

Private leagues require `SWID` and `espn_s2` cookies — not implemented here; store securely client-side only if building BYO-cookie flows.

## Yahoo Fantasy (`yahoo-fantasy-smoke.ts`)

Exercises Yahoo Fantasy API after OAuth. **Requires a Yahoo Developer app** and a **refresh token** (or run a one-time OAuth in a small local server — not included).

**Env:**

- `YAHOO_CLIENT_ID` / `YAHOO_CLIENT_SECRET` — from Yahoo Developer Network
- `YAHOO_REFRESH_TOKEN` — from OAuth 2.0 (Yahoo now often uses OAuth2 for new apps; confirm current YDN docs for Fantasy)

If env is missing, the script prints setup steps and exits 0.

**Example:**

```bash
set YAHOO_CLIENT_ID=...
set YAHOO_CLIENT_SECRET=...
set YAHOO_REFRESH_TOKEN=...
npx tsx scripts/spikes/yahoo-fantasy-smoke.ts
```

Yahoo’s Fantasy Sports API uses game keys like `nfl` and league resources under `fantasy/v2/...` — see [Yahoo Fantasy API docs](https://developer.yahoo.com/fantasysports/).

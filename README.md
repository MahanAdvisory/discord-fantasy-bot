# Discord fantasy bot (Sleeper)

TypeScript Discord bot that links Discord users to Sleeper accounts, stores notification routes, and syncs Sleeper NFL player/stats data into Postgres for future features (lineups, alerts, analytics).

## Setup

1. **Environment** — Copy `.env.example` to `.env` and fill in values (never commit `.env`).
2. **Postgres** — Point `DATABASE_URL` at your database; local Docker example is in `docker-compose.yml`.
3. **Database schema** — `npx prisma migrate deploy` (or `npx prisma db push` for quick local iteration).
4. **Prisma client** — `npx prisma generate`.
5. **Discord application** — Create an app in the Discord Developer Portal; bot token → `DISCORD_TOKEN`, application id → `DISCORD_CLIENT_ID`. Enable **applications.commands** and **bot** scopes; **Server Members Intent** is not required for slash-only MVP. In the app’s **Installation** settings, enable installs for **servers** and, if available, **users** (helps DM slash). The bot registers slash commands with **guild + user** install types and **guild / bot DM / private channel** contexts so commands like `/draft-check` appear in servers and in DMs with the bot. Optionally set `DISCORD_GUILD_ID` for instant updates in one server; **global** commands are always registered as well (see `src/index.ts`). If startup registration returns **400**, read the JSON error — you may need to turn on **User Install** for the app, or adjust install types in `src/bot/commands.ts` to match what the portal allows.
6. **Run** — `npm install`, then `npm run dev` (or `npm run build` && `npm start`).

## Commands

Requires **`/link`** first so the bot knows your Sleeper username.

| Command | Where | Description |
|--------|--------|-------------|
| `/link sleeper_username:` | anywhere | Resolve Sleeper user and store `user_id` on your Discord account. |
| `/leagues` | anywhere | List your Sleeper NFL leagues for the active league season. |
| `/drafts` | anywhere | List your Sleeper drafts for that season. **Drafting** rooms include the same **pick #**, **on-the-clock team**, slot, and last pick as `/draft-check` / `/draft-status`; other statuses show one line with league name. |
| `/updates` | anywhere | On-demand snapshot: NFL state, leagues, and incomplete drafts (plus pointer to future hourly digest). |
| `/draft-check` · `/draft-status` | **DM** or **server channel** | Same command under two names. Fresh Sleeper draft status: in **DM**, all your drafts with status `drafting` (optional `sleeper_league_id` to narrow); in a **server**, `sleeper_league_id` is required. Shows **pick #**, **on-the-clock team**, draft slot, snake + linear on-the-clock, last pick. In a server, **Manage Server** can query a league you’re not in (same idea as `/subscribe`). |
| `/subscribe` | **DM** or **server channel** | Create notification routes (see below). |
| `/unsubscribe` | **DM** or **server channel** | Remove routes: in **DM**, all DM routes or filter by `sleeper_league_id` / `categories`; in a **server**, routes for **this channel** with the same optional filters. |
| `/subscriptions` | anywhere | List your routes (category, destination, league scope). |
| `/route-test` | **server text channel** | Posts a short test message to confirm the bot can deliver here after a permission error; clears `permission_notified_at` for routes on this channel so a future failure can DM again. No Sleeper link required. |
| `/post-summary` | server channel only | Post an embed of your leagues to the **current channel** (needs Send Messages). |

### `/subscribe` behavior

- **After linking**, you can subscribe. For a **specific** league id, the bot normally checks that you belong to that league for the current NFL league season (`/user/:id/leagues/nfl/:season`).
- **In a Discord server (channel):**  
  - **`sleeper_league_id` is required** — usually from `/leagues`, or any real id if you have **Manage Server** (see below).  
  - **`categories`** — optional comma-separated list (defaults below).  
  - Routes post to the **channel where you ran the command**. Each category for that league can only target **one channel per server** (conflicts if already mapped elsewhere).  
  - **Not your Sleeper league?** Members with Discord **Manage Server** can still subscribe the channel to any **existing** Sleeper `league_id` (fan channels, shared news, etc.); the league must resolve via Sleeper’s API.
- **In a DM with the bot:**  
  - Scope is always **all leagues** you belong to on Sleeper (`__all__`). **Do not pass** `sleeper_league_id` (it is rejected with a hint to use a server channel for a single league).  
  - **`categories`** — optional (defaults below).  
  - Routes deliver to **your DMs**.

### `/unsubscribe`

- **DM:** Removes **DM** routes for your account. Omit options to remove **all** DM routes, or set **`sleeper_league_id`** to remove only that league scope, and/or **`categories`** (comma-separated ids) to narrow further.  
- **Server (same channel you used for `/subscribe`):** Removes routes that post to **this channel** for your account, with the same optional filters.  
- **`categories`** — if provided, every token must be a valid category id or the command errors (no silent “delete nothing”).

### Category options (`categories`)

Pass one or more **internal ids** as a comma-separated list (spaces optional). Defaults if omitted: **draft_on_the_clock**, **draft_status**, **transactions**, **waivers**, **lineup_alerts**.

| Value | Meaning |
|-------|---------|
| `draft_on_the_clock` | Alerts when it is your pick (draft polling in a later phase). |
| `draft_status` | Draft board / round updates (not necessarily “your pick”). |
| `transactions` | Trades, adds, drops completed in the league. |
| `waivers` | Waiver runs / FAAB results. |
| `lineup_alerts` | Starters with bye/IR/out and suggested replacements (uses projections later). |
| `league_scores` | Matchup / scoring highlights. |

**Examples**

```text
/subscribe sleeper_league_id:289646328504385536
/subscribe sleeper_league_id:289646328504385536 categories:transactions,waivers
/subscribe categories:draft_on_the_clock,draft_status
```
(In a server, the first line requires the league id; categories default.)

```text
/subscribe
/subscribe categories:transactions,waivers
```
(In DM: always **all** your leagues → your DMs; optional `categories` only.)

```text
/unsubscribe
/unsubscribe categories:transactions,waivers
/unsubscribe sleeper_league_id:289646328504385536
```
(In DM: drop all DM routes, or only some categories, or only one league scope.)

## Sleeper data in Postgres

The bot stores Sleeper payloads for offline use and future seasons:

| Table | Purpose |
|-------|---------|
| `sleeper_players` | Full JSON per player from `GET https://api.sleeper.app/v1/players/nfl` (large; refresh sparingly). |
| `sleeper_player_stats` | Per-player stats blobs from `api.sleeper.com/stats/nfl` (`grouping=season` or `week`). |
| `sleeper_stats_snapshots` | Whole-request snapshots (e.g. bulk week list) for archival/replay. |
| `app_meta` | Sync metadata keys (e.g. last player catalog sync time). |

**CLI sync scripts**

```bash
npm run sync:players      # Upsert full NFL player catalog (heavy network + DB write).
npm run sync:stats-week   # Optional args: season year, week — defaults from NFL state.
```

Undocumented Sleeper hosts (`api.sleeper.com` stats/projections) may change; we persist raw JSON so you can adapt parsers later.

## Background notifications (Phase B)

With the bot running, **every hour** it polls Sleeper for leagues tied to your `/subscribe` routes:

- **Transactions / waivers** — Uses NFL week from [`GET /state/nfl`](https://docs.sleeper.com/) and [`GET /league/:id/transactions/:week`](https://docs.sleeper.com/). First poll **baseline only** (no spam): it records the latest transaction timestamp, then notifies only on **new** completed transactions. **Trades** → `transactions`; **FAAB/waiver bids** → `waivers`; other adds/drops → `transactions`.
- **Draft status** — While a league draft is `drafting`, at most **one** message per poll with the **latest** new pick since the last check (`draft_status`). If several picks happened between ticks, earlier ones are skipped (cursor still advances so nothing is replayed).  
- **Overlapping `/subscribe` routes** — If you have both **`__all__`** and a **specific league** (same category, same DM or channel), both would match the same pick; the poller now sends **one** notification per destination and keeps the **league-specific** route when both exist. Remove extras with `/unsubscribe` if you want only `__all__`.
- **Your pick is up** — On-the-clock detection for **snake** and **linear** drafts (`draft_on_the_clock`). Other types (e.g. auction) log once and skip until supported.

State is stored in `league_poll_cursors` and `draft_poll_cursors` so restarts do not duplicate alerts.

On-demand **`/updates`** is unchanged (snapshot only). **Lineup / `league_scores` alerts** are not implemented in the poller yet.

## Web dashboard (`web/`)

Next.js app: Discord login, Sleeper league/draft overview, Stripe subscribe/manage billing. See **[docs/web-setup.md](docs/web-setup.md)**.

```bash
npm install
npm run web:dev
```

Requires `DISCORD_CLIENT_SECRET` (OAuth2 client secret, not the bot token) and the rest of the variables listed in `docs/web-setup.md`.

## Billing gate (Discord bot)

When **`STRIPE_SECRET_KEY`** is set, slash commands require an active Stripe subscription except **`/link`** (override list via `COMMERCIAL_GATE_ALLOWLIST_COMMANDS`). With Stripe unset, the gate stays **open** so existing deployments keep working. Use **`BILLING_URL`** or **`NEXT_PUBLIC_APP_URL`** in the bot env so blocked users see your dashboard URL.

## Multi-provider API notes

See **[docs/platform-apis.md](docs/platform-apis.md)** and **`scripts/spikes/`** for ESPN/Yahoo investigation scripts.

## Production note

Phase 1 targets **local** development. Later deployment is intended as a **single VPS/VM** with the same env-driven configuration.


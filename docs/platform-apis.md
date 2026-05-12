# Fantasy platform APIs — investigation matrix

This document consolidates desk research for multi-provider support (leagues, drafts, rosters, transactions, waivers, scoring). **Implementation details must be re-validated** before production use; provider APIs change without notice.

## Summary tiering

| Tier | Meaning |
|------|---------|
| **A** | Official developer program / documented contract — preferred for notifications and billing-grade reliability |
| **B** | Technically feasible but undocumented, cookie-based, or fragile — usable with explicit user consent and UX warnings |
| **C** | No viable league-state API for our use case — stats/projection supplements only |

---

## Provider matrix

| Provider | Official API | Primary auth | Leagues / teams | Drafts | Rosters / lineups | Transactions / waivers | Scores | Risk / notes |
|----------|--------------|--------------|-----------------|--------|-------------------|------------------------|--------|--------------|
| **Sleeper** | Yes (public REST `api.sleeper.app/v1`) | None for reads; link user by username → `user_id` | Full | Full | Full | Full (per NFL week) | Via league state | **Tier A** for this repo — current integration |
| **Yahoo Fantasy** | Yes ([Yahoo Developer Network — Fantasy Sports](https://developer.yahoo.com/fantasysports/)) | OAuth 1.0a (historical standard for YDN fantasy) | Full (game, league, team resources) | Varies by year/endpoint | Roster, stats | Trades, add/drop where exposed | Yes | **Tier A** — implement OAuth + league key (`league key` / `game_key` pattern) |
| **ESPN** | No | Public league: unauthenticated GET. Private: `espn_s2` + `SWID` cookies | Yes (unofficial JSON) | Yes (views on league) | Yes | Yes (activity feed patterns) | Yes | **Tier B** — `lm-api-reads.fantasy.espn.com` / `fantasy.espn.com/apis/v3` style endpoints; can break; ToS may restrict automated access |
| **NFL.com fantasy** | Partial — gated ([Fantasy API v2 docs](https://api.fantasy.nfl.com/v2/docs) pattern; keys via NFL developer process) | App token + user auth token flow | Documented paths exist for leagues/rosters in legacy docs | Check current program | Check current program | Check current program | Varies | **Investigate** — confirm whether new third-party apps are still issued keys |
| **CBS Sports** | Historical “Fantasy Open Platform” ([developer.cbssports.com](http://developer.cbssports.com/) references) | OAuth / app credentials | League, teams, transactions per legacy docs | Varies | Yes | Yes | Yes | **Investigate** — confirm program status (some sources indicate legacy/limited onboarding) |
| **Underdog / PrizePicks / DFS** | Product-specific; not drop-in for season-long redraft | — | Different model | Best ball / DFS | — | — | — | Out of scope unless product expands |

> **Sleeper note:** the public REST at `api.sleeper.app/v1` does **not** expose pending trade offers, league chat messages, inbox DMs, friend invites, or in-app notifications. Those events live behind an authenticated session at `sleeper.app/graphql`. See [Sleeper Private Events Spike](./sleeper-private-events-spike.md) for the feasibility plan that decides whether and how to support them.

---

## Supplemental data vendors (not full league hosts)

| Vendor | Use | Tier |
|--------|-----|------|
| **SportsDataIO / FantasyData / Stats Perform** | Players, injuries, projections, schedules | **C** for league management; **A** for enriched NFL facts |
| **NFL NGS** | Advanced stats — not fantasy league state | **C** |
| **Open NFL schedules** | Kickoff times — already aligned with ESPN public schedule usage in `src/nfl/espnKickoff.ts` | Supplement |

---

## Feature parity vs this product

| Product feature | Sleeper | Yahoo | ESPN | NFL.com | CBS |
|-----------------|---------|-------|------|---------|-----|
| Route notifications (Discord) | Done | Needs adapter + OAuth | Fragile | Unknown | Unknown |
| Draft status / on-clock | Strong | Strong candidate | Possible | TBD | TBD |
| Transactions / waivers | Strong | Strong candidate | Possible | TBD | TBD |
| Lineup / IR checks | Strong | Possible | Possible | TBD | TBD |
| Web dashboard (read) | Strong | Strong candidate | Possible with cookies | TBD | TBD |

---

## Recommended engineering order

1. Keep **Sleeper** as reference implementation (`src/sleeper/*`).
2. Add **Yahoo** as first additional **Tier A** adapter (OAuth + normalized models in `src/domain/*`).
3. **ESPN** as optional **Tier B** “bring your own cookies” for advanced users only.
4. **NFL.com / CBS** — product spike after confirming developer programs still accept apps.

---

## Spikes (see `scripts/spikes/`)

- **ESPN public league**: no cookies; validate JSON shape for a known public league id + year.
- **Yahoo**: requires Yahoo Developer app + OAuth — scripts document env vars and expected failure modes when unset.
- **Sleeper private events**: research-first spike for trade-offer / chat / DM alerts via the authenticated GraphQL endpoint. See [docs/sleeper-private-events-spike.md](./sleeper-private-events-spike.md).

---

## Legal / compliance note

Unofficial APIs (ESPN) may violate terms of service if scraped at scale. Prefer official programs where revenue or automation is involved; disclose limitations in UI.

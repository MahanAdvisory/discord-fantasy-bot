# Sleeper Private Events Spike

Status: research-first. No implementation should begin until this spike concludes with a recommended approach and acceptance evidence.

## 1. Goal

Determine whether FFSidekick can offer "trade offer received" and "league message received" alerts (and similar private events) similar to dynasty-daddy, and pick an approach with acceptable terms-of-service, credential, and brittleness risk before any implementation work begins.

Out of scope for this spike:

- Building the feature itself.
- Web-push notifications. Delivery is assumed to reuse the existing Discord/Telegram/Slack fanout via the planned `TransportAdapter` abstraction described in [Growth Roadmap](./growth-roadmap.md).
- Providers other than Sleeper. Yahoo and ESPN authenticated events can use the same shape later, but this spike is Sleeper-only.

## 2. The public / private API gap

- The public Sleeper REST in `src/sleeper/client.ts` and `src/sleeper/transactionsApi.ts` exposes accepted transactions only. A trade only appears after both sides accept it, and league chat messages, friend invites, and in-app inbox notifications are not exposed at all.
- Pending trade offers, inbox DMs, friend invites, and in-app notifications are served by Sleeper's authenticated, undocumented GraphQL endpoint at `sleeper.app/graphql`, plus a few authenticated REST endpoints under `sleeper.com`.
- Sleeper's own web and mobile clients are the documented users of those endpoints. Any third-party use requires the user's authenticated session in some form.

Therefore replicating dynasty-daddy-style alerts is not possible from the public REST alone. The interesting question is how to access the private path with the least credential exposure, the least terms-of-service risk, and the lowest brittleness.

## 3. Approach options

Each option is evaluated against the same dimensions so they can be compared apples-to-apples in section 4.

### A. Server-side token capture

How it works: the user signs into Sleeper in their own browser, copies a session token or cookie (similar to today's ESPN `espn_s2`/`SWID` flow in `prisma/schema.prisma` and `web/app/help/page.tsx`), and pastes it into the FFSidekick dashboard. Our server polls `sleeper.app/graphql` on their behalf and routes new events through the existing notification fanout.

- Engineering effort: medium. We already have a precedent for storing per-user provider credentials and polling on a cron.
- Credential handling: highest exposure. We store a long-lived session credential that grants effectively full read access to the user's Sleeper account.
- Terms-of-service risk: high. We are calling undocumented endpoints from server infrastructure at scale.
- Brittleness: medium. Session cookies expire, and Sleeper can rotate auth flows.
- Install UX: low friction once the user finds the token, but extracting a session cookie is non-trivial for a non-technical user.
- Coverage: highest. Anything Sleeper's own web app can read is available, including trade offers, league chat, inbox DMs, friend invites, and in-app notifications.
- Test plan: a small Node script that uses a known-good session cookie and polls candidate GraphQL queries; verify we can detect a trade offer and a chat message within 60 seconds of them happening.
- Acceptance criteria: 60-second detection, survives a 24-hour cookie pause, can be revoked from a single "disconnect" button in our help/account page, and works without storing username or password.
- Kill criteria: if Sleeper enforces a short cookie lifetime that requires user re-login more than once per week, or if a documented IP-based anti-automation behaviour shows up during the smoke test.

### B. Browser extension

How it works: a Chrome / Firefox extension runs on `sleeper.com` (and potentially `sleeper.app`). It piggybacks on the user's already-authenticated session in their own browser, watches for new events, fires a native browser notification, and optionally calls a FFSidekick webhook so the existing Discord/Telegram/Slack fanout reaches them too.

- Engineering effort: high. Manifest v3 limitations, content-script lifetime issues, two store-review pipelines (Chrome Web Store and Firefox AMO), update channel management.
- Credential handling: lowest. The user's session never leaves their own browser. FFSidekick only ever receives event payloads (or hashes/identifiers thereof).
- Terms-of-service risk: lowest of the four. Extensions running in the user's own browser are the same shape Sleeper's users already use.
- Brittleness: medium. We are still reading Sleeper's internal DOM or GraphQL responses, but at least each user runs only their own session.
- Install UX: medium. One-click install from a store, but discovery is harder than a web flow.
- Coverage: highest. Same reach as option A.
- Test plan: a minimal Manifest v3 extension that injects a content script on `sleeper.com`, intercepts GraphQL responses, and logs detected events; verify the same trade-offer and chat-message detections as option A.
- Acceptance criteria: 60-second detection while the user is signed into Sleeper in that browser, works in both Chrome and Firefox, store-review approval is realistic, and optional backend webhook works through the existing fanout.
- Kill criteria: Manifest v3 lifetime restrictions prevent reliable background detection, or Sleeper's responses are obfuscated in a way that breaks daily.

### C. Userscript (Tampermonkey / Greasemonkey)

How it works: same idea as the extension but distributed as a small userscript file. Users install Tampermonkey (Chrome) or Greasemonkey (Firefox), then add our script. It runs on `sleeper.com`, watches for events, and posts to a FFSidekick webhook.

- Engineering effort: low to medium. No store-review overhead; ship from GitHub.
- Credential handling: same as option B; nothing leaves the user's browser.
- Terms-of-service risk: same as option B.
- Brittleness: similar to B, slightly higher because we have fewer extension-API guarantees and rely more on DOM and fetch interception.
- Install UX: higher friction. The user has to install a userscript manager before our script.
- Coverage: same as B.
- Test plan: a Tampermonkey script that intercepts `sleeper.com` fetch calls, logs detected events, and posts a test webhook back to a sandbox endpoint.
- Acceptance criteria: 60-second detection in both Chrome and Firefox, install instructions that a non-technical user can follow, and a sandboxed test webhook that exercises the existing dispatch.
- Kill criteria: Tampermonkey/Greasemonkey market share or maintenance health declines enough that targeting them is not worth it.

### D. Tab-pinned web client

How it works: the user keeps a FFSidekick tab open in the same browser where they are signed into Sleeper. That tab uses the user's own browser session to call the same authenticated endpoints, parses events client-side, and streams them to our backend over Server-Sent Events or a WebSocket. The backend then runs the existing fanout to Discord / Telegram / Slack.

- Engineering effort: medium. We need a stable browser-side poller, a streaming pipe to our backend, and a clear "this works only while the tab is open" UX.
- Credential handling: same as B/C; nothing leaves the user's browser unless they choose to share an event payload.
- Terms-of-service risk: similar to B/C, slightly more visible because the polling is consistent and deterministic.
- Brittleness: medium. CORS and cookie scoping on `sleeper.com` may block calls from `ffsidekick.example`, in which case option D is structurally not viable.
- Install UX: zero install. Best of the four.
- Coverage: same as B/C if CORS allows the calls; otherwise zero.
- Test plan: a small Next.js page that, while a known Sleeper session is active in the same browser, fetches a candidate GraphQL query and logs the response. Establish whether `sleeper.com` allows credentialed cross-origin requests from our origin.
- Acceptance criteria: option D is only viable if a credentialed cross-origin fetch from our domain to `sleeper.com` actually succeeds. If not, this option is dropped.
- Kill criteria: CORS preflight fails or cookies are `SameSite=Lax`/`Strict` in a way that excludes our origin.

## 4. Comparison summary

Scored 1 (poor) to 5 (excellent) relative to each other:

- Coverage:
  - A: 5 (server has full access on the user's behalf).
  - B: 5 (in-browser, full access).
  - C: 5 (in-browser, full access).
  - D: depends on CORS; either 5 or 0.
- Credential exposure (5 = lowest exposure to us):
  - A: 1.
  - B: 5.
  - C: 5.
  - D: 5.
- ToS risk (5 = lowest risk):
  - A: 2.
  - B: 4.
  - C: 4.
  - D: 3.
- Brittleness (5 = most resilient):
  - A: 3.
  - B: 3.
  - C: 3.
  - D: 2 if it works at all.
- Install UX (5 = least friction):
  - A: 3 (token paste is annoying).
  - B: 4 (store install).
  - C: 2 (manager + script).
  - D: 5 (nothing to install).
- Dev cost (5 = cheapest):
  - A: 4.
  - B: 2.
  - C: 4.
  - D: 3.
- Ongoing maintenance (5 = lowest):
  - A: 3.
  - B: 2.
  - C: 3.
  - D: 3.

Sum is intentionally not used as a decision; the rubric below is.

## 5. Decision rubric

The spike concludes with a recommended approach only if all of the following hold:

- At least one option captures both **trade offer received** and **league message received** in a smoke test against a real Sleeper account, within 60 seconds, and survives a 24-hour pause.
- The chosen option's credential model is acceptable. Preference order: B, then C, then D, then A.
- The chosen option does not require us to store a Sleeper username or password.
- The chosen option works in both Chrome and Firefox if it ships as an extension or userscript.

If no option clears the bar, the recommendation is to ship without this feature and revisit after Sleeper publishes more API surface or a known third party (for example dynasty-daddy) documents a stable path.

## 6. Smoke-test plan

For each candidate that we run, the spike specifies a concrete test:

- Use a throwaway Sleeper test account that is a member of a private dynasty league with a cooperating tester.
- The tester sends:
  - one trade offer at time `T0`,
  - one league chat message at time `T1`,
  - one direct message at time `T2`.
- The candidate must surface each event within 60 seconds of its `T*`.
- After surfacing the initial events, leave the candidate running with no activity for 24 hours. Then repeat the three-event sequence and confirm it still detects them.
- The smoke test must run in a sandbox repo or branch, not against production. The fanout target during the smoke test must be a sandbox Discord channel or webhook.bin.

Acceptance evidence for the spike is:

- Logs showing detection within the 60-second window for each event.
- Logs showing detection after the 24-hour pause.
- A short note describing what broke during the test and how it was recovered.

## 7. Integration plan (only after the spike picks a winner)

This section is intentionally short. Detailed work belongs in a follow-up plan once the spike concludes.

- Add a `SleeperPrivateEvent` Prisma model with at minimum: `id`, `userId`, `kind` (`trade_offer` | `league_message` | `direct_message` | `friend_invite` | `inbox_notification`), `externalId`, `receivedAt`, `payload` JSON, and a unique constraint on `(userId, kind, externalId)` for idempotent ingest.
- Add new notification categories: `trade_offers`, `league_messages`, optionally `friend_invites` and `direct_messages`. Mirror the shape of the existing categories in `src/domain/notifications.ts`.
- Route events through the planned `TransportAdapter` fanout described in [Growth Roadmap](./growth-roadmap.md) so Discord, Telegram, and Slack delivery come for free.
- Per-user opt-in toggle on the help/account page with explicit consent copy that explains what data we are reading.
- Polling cursor pattern parallel to the existing Sleeper transactions poller (`leaguePollCursor`-style) for option A. For B / C / D, idempotent ingest keyed on the external event id is sufficient because the browser-side client decides what to forward.
- Documented "disconnect" flow that revokes our access for the chosen option.

## 8. Risk register

- Terms-of-service exposure. Undocumented endpoints can be revoked; explicit per-user opt-in and a documented kill switch are non-negotiable.
- Credential rotation. Sleeper session cookies expire. The chosen option must tolerate refresh, ideally without re-prompting the user.
- Account safety. Poll cadence must stay below patterns that could trip rate limits or anti-automation heuristics. Server-side options must rate-limit per user and respect a global ceiling.
- Privacy. Payloads can contain other users' messages. Storage must be scoped to the consenting user, and we should avoid logging full message bodies in operational logs.
- Vendor change risk. GraphQL response shape drift. Ship behind a feature flag and a per-user enable so we can dark-mode the feature.
- Support load. Failure modes here are confusing for end users; the surface needs a clear status indicator in the dashboard ("Trade alerts: working", "Trade alerts: needs re-link", etc.).

## 9. Open decisions called out for the next session

- Final choice among A through D after smoke tests.
- Whether to gate this feature behind the Pro tier. Suggested yes, because it is high-effort, ToS-sensitive, and a clear power-user benefit.
- Whether to capture league messages by default or only on explicit opt-in.
- Whether to capture direct messages at all, or limit the feature to trade offers and league chat only.
- Whether to extend the same model later to Yahoo and ESPN authenticated events, or treat each provider as its own spike.

## 10. References

- [Growth Roadmap](./growth-roadmap.md) for the planned transport abstraction and free vs Pro tiering.
- [Platform APIs](./platform-apis.md) for the public/private capability matrix across providers.
- Existing Sleeper polling and dispatch code:
  - `src/sleeper/client.ts` (public REST helpers),
  - `src/sleeper/transactionsApi.ts` (public transactions endpoint),
  - `src/services/notifications/runPoll.ts` (poll loop and per-league cursor),
  - `src/services/notifications/dispatch.ts` (Discord delivery, transport abstraction target).

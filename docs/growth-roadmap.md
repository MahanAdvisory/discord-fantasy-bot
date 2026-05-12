# Growth Roadmap

This document is the consolidated product and engineering roadmap for growth work that sits beyond the current Sleeper/ESPN/Discord core: new notification transports, Yahoo leagues, donation and subscription monetization, and public-launch branding.

Use this as the strategy-level source of truth. The existing sprint and migration docs should point here when work needs more tactical breakdown.

## Guiding Principles

- Keep the core dashboard useful for free users so the product can grow by word of mouth.
- Put variable-cost or high-support features behind paid plans.
- Prefer official APIs and OAuth flows for anything that becomes revenue-facing.
- Keep provider and transport code behind narrow adapters so Discord/Sleeper remain the reference implementations, not permanent special cases.
- Avoid using third-party provider logos or implying affiliation with fantasy football platforms.

## 1. Notification Transports

Discord is the current delivery path. The next transport work should introduce a shared transport abstraction instead of adding one-off delivery branches for every channel.

### Shared Requirements

Create a `TransportAdapter` concept that can cover Discord, Telegram, Slack, and WhatsApp:

- `send(destination, message)` for outbound delivery.
- `validateDestination(destination)` for configuration health checks.
- `renderMention(mapping)` for platform-specific user mentions.
- `supportsRichLinks` / `supportsMarkdown` capability flags if formatting diverges.
- Structured error types for retryable, permanent, and auth failures.

The current Discord path in `src/services/notifications/dispatch.ts` should become the reference implementation. The current `NotificationSubscription` model in `prisma/schema.prisma` is Discord-shaped (`guildId`, `channelId`, `isDm`), so future work should add:

- `transport`: `discord` | `telegram` | `slack` | `whatsapp`.
- `transportDestination`: JSON for transport-specific destination details.
- Optional migration/backfill from the existing Discord columns.

Each transport milestone should include:

- Auth / install flow.
- Destination linking UX.
- Subscription route support.
- Fanout adapter.
- Rate-limit handling.
- Mention mapping.
- Smoke test.
- Operational logging and failure metrics.

### Telegram (Todo, Free Tier)

Telegram is a good free-tier expansion because it is low cost, has a straightforward bot model, and supports direct-to-user notifications.

Requirements:

- Create a Telegram bot via BotFather and store `TELEGRAM_BOT_TOKEN`.
- Add a deep-link flow such as `https://t.me/<bot>?start=<signed_user_token>` so a signed-in user can connect their Telegram chat to their dashboard account.
- Store the Telegram `chatId` and enough profile metadata to display the linked destination.
- Add a "Link Telegram" CTA on the account/help page.
- Add Telegram as a notification destination in subscription management.
- Reuse waiver burst batching to stay within Telegram rate limits.
- Use `@username` where available for mention-like display, but do not rely on usernames as stable IDs.
- Add opt-out/unlink support from both the web UI and Telegram command flow.

Acceptance criteria:

- A signed-in user can link Telegram without manual database work.
- The user can route at least one category (waivers, transactions, draft status, or lineup alerts) to Telegram.
- Delivery failures are logged and do not stop Discord delivery.
- Duplicate sends remain prevented by the existing notification journal.

### Slack (Todo, Free Tier)

Slack is useful for league group chats and workplace-style fantasy leagues. It should be treated as a workspace installation, not just a personal notification channel.

Requirements:

- Add Slack OAuth with an "Add to Slack" install flow.
- Store `team_id`, bot token, installer user ID, token scopes, and install timestamps.
- Required scopes for v1: `chat:write`, `channels:read`, `groups:read` if private channels are supported, and identity scopes only if needed for user linking.
- Add `/api/slack/install` and `/api/slack/oauth/callback` endpoints.
- Add a channel picker sourced from Slack `conversations.list`.
- Store Slack destinations as `{ teamId, channelId }` in `transportDestination`.
- Add Slack-specific mention mapping from Sleeper user ID to Slack user ID.
- Respect Slack rate limits and retry headers.
- Include install health checks so users know if the bot was removed from a workspace or channel.

Acceptance criteria:

- A user can install the Slack app, select a channel, and route notifications there.
- A workspace can have multiple league/category routes.
- Slack delivery errors are visible in logs and route diagnostics.
- Slack notification formatting remains readable without Discord-specific markup.

### WhatsApp (Potential, Paid Tier)

WhatsApp should be reserved for paid plans because each active user can create variable vendor cost and operational overhead.

Recommended v1 path:

- Use Twilio WhatsApp for the MVP.
- Keep Meta Cloud API as a later cost/control optimization if volume justifies it.

Requirements:

- User phone verification and explicit WhatsApp opt-in.
- Store phone destination, verification state, opt-in timestamp, and opt-out timestamp.
- Use approved templates where required for outbound notifications outside a user-initiated conversation window.
- Add per-user and per-category rate controls.
- Track delivery cost per user and per category.
- Add a kill switch or monthly cap for runaway notification volume.
- Include WhatsApp in paid-tier entitlement checks only.

Why paid-only:

- Twilio/WhatsApp can charge per conversation window or template message depending on setup and region.
- Template approval adds support burden.
- Failed delivery and opt-in issues are more support-heavy than Discord, Telegram, or Slack.
- League activity bursts can multiply message volume during waiver windows.

Acceptance criteria:

- One paid test user can opt in and receive at least one category end to end.
- Delivery failures are non-fatal to the poll loop.
- Per-user monthly cost can be estimated from logs or metrics.
- Duplicate sends remain prevented on retry/replay.

### Private / Authenticated Provider Events (Research-First)

Some events users expect (e.g. trade offers received, league chat messages, inbox DMs) are not available from public provider APIs. Sleeper exposes them only behind an authenticated session via the undocumented `sleeper.app/graphql` endpoint, similar to what dynasty-daddy uses. This work is research-first, not yet on the build queue.

See [Sleeper Private Events Spike](./sleeper-private-events-spike.md) for the detailed feasibility plan covering four approaches (server-side token capture, browser extension, userscript, tab-pinned web client), the smoke-test plan, the decision rubric, and risk register.

Key constraints when this work eventually ships:

- Reuse the `TransportAdapter` fanout above so delivery still goes to Discord, Telegram, and Slack.
- Per-user explicit opt-in and a documented kill switch.
- Likely gated behind the Pro tier given the ToS and support burden.
- Equivalent work for Yahoo and ESPN authenticated events is descoped until the Sleeper spike concludes.

## 2. League Providers

### Yahoo (Leagues Roadmap)

Yahoo is the preferred next league provider because it has an official fantasy sports API and OAuth flow. It should be implemented as a Tier A provider after the current ESPN spike stabilizes.

Requirements:

- Create a Yahoo Developer app for production.
- Implement OAuth token exchange and refresh.
- Store access/refresh tokens securely and encrypt refresh tokens at rest.
- Add a `YAHOO_ENABLED` feature flag for alpha rollout.
- Build `src/adapters/yahoo/index.ts` with the same normalized concepts as the ESPN adapter:
  - leagues,
  - teams,
  - rosters,
  - lineup state,
  - transactions,
  - waivers,
  - draft status where available,
  - league URLs.
- Extend provider routing to support `sleeper`, `espn`, and `yahoo`.
- Extend the dashboard provider badge to include a `Y` icon.
- Extend account linking UX on `web/app/help/page.tsx`.
- Add smoke scripts that verify token refresh, league list, roster read, and transaction read.
- Document known limitations in `/help`.

Suggested phases:

1. OAuth spike cleanup: turn the existing Yahoo scripts into a repeatable local auth flow.
2. Read-only league list and team identity.
3. Roster and lineup dashboard parity.
4. Transactions and waiver feed.
5. Draft/on-clock support if Yahoo exposes enough data.
6. Private alpha behind `YAHOO_ENABLED`.
7. Production rollout with diagnostics and help copy.

Acceptance criteria:

- A user can link Yahoo without manual token copy/paste.
- Yahoo leagues render in the same dashboard contracts as Sleeper and ESPN.
- Yahoo transaction/waiver notifications use the existing fanout pipeline.
- Token refresh works without recurring user intervention.
- Provider-specific limitations are documented before public launch.

## 3. Monetization

### Phase A: Donations / "Buy Me a Coffee" Button

Goal: add a lightweight support path before full subscriptions are ready.

Provider options:

| Provider | Fit | Pros | Cons |
| --- | --- | --- | --- |
| Buy Me a Coffee | Fastest public button | Familiar donation UX, hosted page, easy embed/link | Platform fee on transactions, less reusable for subscription entitlements |
| Ko-fi | Creator-friendly donation page | Can be 0% platform fee on one-time donations if configured without Contributor mode; supports PayPal/Stripe | Requires account configuration diligence; less connected to existing Stripe code |
| Stripe Payment Link | Best fit for this repo | Reuses existing Stripe account and billing direction; no-code donation page; easy to later connect to reporting/webhooks | Less "coffee" branded; may need a simple `/support` or thank-you page |

Recommendation:

- Default to **Stripe Payment Link** because the app already has Stripe checkout, portal, and webhook scaffolding.
- Use Buy Me a Coffee only if the immediate goal is a recognizable creator-style support button with minimal configuration.
- Use Ko-fi if PayPal support or creator-page presentation is more important than keeping payment data centralized in Stripe.

Donation requirements:

- Add a `Donate` or `Support the project` button in the dashboard header and footer.
- Add a short `/support` page that explains donations are optional and do not unlock product entitlements.
- Link to Privacy Policy and Terms of Use from the support page.
- Update the Privacy Policy and Terms of Use to state that donations are non-refundable unless required by law and do not create subscription access.
- Avoid additional analytics in v1; rely on provider dashboards and Stripe exports.
- Add a `SUPPORT_URL` or `DONATION_URL` environment variable so the provider can change without code edits.

Donor tracking requirements:

We need to keep enough information about donors to thank them, recognize them in any future "supporters" list (with consent), reconcile provider payouts, and migrate donors into Pro plans later if they choose.

- Add a `Donation` table to Prisma with at minimum:
  - `id` (cuid).
  - `provider` enum: `stripe` | `buymeacoffee` | `kofi`.
  - `providerEventId`: unique per provider for idempotent webhook ingestion.
  - `donorEmail` (lowercased, indexed, optional only if provider truly does not supply one).
  - `donorName` (optional, as supplied by provider).
  - `amountCents` and `currency` (ISO 4217, e.g. `usd`).
  - `feeCents` (provider/processing fee where exposed).
  - `netCents` (amount minus fees, where calculable).
  - `message` (optional supporter note from the provider page).
  - `userId` foreign key (nullable) for donations tied to a signed-in dashboard user.
  - `receivedAt` (timestamp from the provider event, not server time).
  - `rawPayload` (JSON of the relevant webhook event for debugging and re-derivation).
- Add an index on `donorEmail` and a unique constraint on `(provider, providerEventId)`.
- Add a Prisma migration alongside the table.
- Webhook ingestion:
  - Stripe: extend the existing webhook handler in `web/app/api/stripe/webhook/route.ts` to handle the donation Payment Link product/price; map the Stripe `checkout.session.completed` (or `payment_intent.succeeded`) event into a `Donation` row.
  - Buy Me a Coffee: add a new `web/app/api/donations/buymeacoffee/route.ts` webhook handler with HMAC verification.
  - Ko-fi: add a new `web/app/api/donations/kofi/route.ts` webhook handler with the Ko-fi verification token.
  - All webhooks must be idempotent on `(provider, providerEventId)`.
- Operational tooling:
  - An admin-only API or script to list recent donations (CSV export by month).
  - A counter for total donations and unique donors (for an optional public "supporters" page).
  - A "link to user" reconciliation step that matches `donorEmail` to an existing dashboard `User.email` so we can offer Pro discounts later.
- Privacy and consent:
  - Treat `donorEmail` and `donorName` as PII; include them in the Privacy Policy data-collection section.
  - Default to *not* publishing donor names; require explicit opt-in via the donation form before any public listing.
  - Add a delete-on-request workflow that anonymizes donor rows (keeps amounts/totals for accounting, removes identifiers).
- Reporting:
  - Add a small admin dashboard view (or scheduled email) for monthly totals, top message highlights with consent, and donor count.
  - Reconcile against Stripe / BMC / Ko-fi exports during the public-launch window.

Acceptance criteria:

- A visitor can click from the website to the donation provider.
- The legal pages accurately describe donations.
- The button can be hidden with an empty env var.
- No user must donate to access existing free features.
- Each successful donation persists exactly one `Donation` row, including donor email, amount, currency, and provider event id.
- A donor email can be looked up to find a list of contributions across providers.
- Donor PII can be deleted on request without losing aggregate financial totals.

### Phase B: Move From Donations to Subscriptions

Goal: preserve a useful free product while creating a paid plan for power users and variable-cost features.

Suggested plan:

1. Launch donations first to validate whether users are willing to support the product.
2. Instrument rough interest signals:
   - donation clicks,
   - donation conversions,
   - number of linked leagues,
   - number of notification routes,
   - waiver explorer usage,
   - WhatsApp waitlist clicks.
3. Define `Free` and `Pro` entitlements.
4. Add a `/pro` page that explains paid benefits before enforcing gates.
5. Launch subscriptions with a trial or founding-user discount.
6. Keep donation active for users who do not need Pro but still want to support the project.

Suggested pricing:

- Monthly: $3/month.
- Annual: $30/year.
- Optional 14-day free trial for first launch.

These are starting points, not final pricing. Revisit once real user volume, Twilio costs, and support load are known.

### Free vs Pro Benefits

Free should remain useful:

- Sign in with Discord, Google, or email.
- Link Sleeper and ESPN.
- Basic dashboard.
- Basic lineup status.
- Discord notifications.
- Telegram and Slack notifications if support burden remains low.
- Limited league count, suggested initial cap: 3 leagues.
- Basic waiver display.

Pro should include high-perceived-value or cost-bearing features:

- League hyperlinks in dashboard and notifications.
- WhatsApp notifications.
- Yahoo leagues when launched.
- Unlimited linked leagues.
- Cross-league waiver explorer advanced sorts and filters.
- Higher poll cadence / faster alerts.
- Unlimited custom mention mappings.
- Advanced notification routing by provider, league, and category.
- Priority support.
- Early access to new providers.

Why league hyperlinks are a reasonable Pro benefit:

- They are visible and useful without breaking core free functionality.
- They have no marginal vendor cost.
- They create a clear upgrade moment in a daily workflow.
- Free users can still see league names and data.

Implementation requirements:

- Extend `BillingSubscription` with explicit tier/plan metadata.
- Add an entitlement helper such as `hasProAccess(userId)` or `requiresPro(feature, user)`.
- Gate web UI affordances, not just API responses, so users understand why a feature is locked.
- Avoid hiding core safety/lineup warnings behind the paywall.
- Add Stripe monthly and annual prices.
- Update checkout to select monthly vs annual.
- Update Customer Portal to allow plan switching and cancellation.
- Add billing-state copy for active, trialing, canceled, delinquent, and grace states.
- Add tests for entitlement transitions and webhook replay.

Migration from donations:

- Keep one-time donations available.
- Offer founding donors a discount code or free first month.
- Do not automatically convert donors into subscribers without explicit consent.
- Email or dashboard-message donors before any benefit changes.

## 4. Branding: Logo and Screenshots

### Logo

Goal: replace the current logo placeholder with a small, recognizable brand system that works in the dashboard, favicon, Discord, and social previews.

Deliverables:

- Header logo, light background.
- Header logo, dark background.
- Icon mark / favicon.
- 512x512 Discord avatar.
- Open Graph image.
- Simple brand notes: colors, typography, and spacing.

Constraints:

- Do not use ESPN, Sleeper, Yahoo, NFL, or other provider logos.
- Avoid marks that imply official affiliation with any fantasy football provider.
- The logo should read at small sizes.
- It should communicate fantasy football plus dashboard/alerts, not sports betting.

Production options:

| Path | Cost | Timeline | Best for |
| --- | --- | --- | --- |
| AI-generated drafts | Free/low | Hours | Fast direction-finding and internal review |
| Template-based tools (Canva, Looka, Hatchful) | Low | 1 day | Clean enough launch assets |
| Freelance designer | Moderate | 3-7 days | Strong public launch polish and brand kit |

Recommended path:

1. Generate 3-5 AI or template directions.
2. Pick one direction.
3. If the app is going public, have a designer clean it up into SVG/PNG assets.
4. Wire final files into:
   - dashboard header,
   - favicon,
   - Open Graph metadata,
   - Discord bot avatar if appropriate.

Implementation locations:

- Replace the `LOGO PLACEHOLDER` in `web/app/page.tsx`.
- Add favicon / app icons under `web/app` or `web/public`.
- Update metadata in `web/app/layout.tsx`.
- Store reusable assets under `web/public/brand`.

### Screenshots

Goal: refresh screenshots so the public landing page shows the current product and does not expose private league/user data.

Capture requirements:

- Use a sanitized demo account or staged seed data.
- Hide real names, private league IDs, emails, Discord IDs, and cookies.
- Capture at consistent browser width.
- Use 2x scale where possible.
- Include light and dark mode if both are public-facing.

Recommended tooling:

- ShareX on Windows for capture.
- Browser dev tools device frames or Shots.so/Screely for polished frames.
- Figma or Canva for minor callouts and cropping.

Screenshot set:

- Dashboard overview.
- Leagues table with provider badges.
- Waiver explorer.
- Notification settings.
- Help/account linking page.
- Example Discord notification.

Storage and update cadence:

- Store final screenshots under `web/public/screenshots`.
- Use descriptive names such as `dashboard-overview.png` and `waivers-explorer.png`.
- Refresh screenshots before Railway public launch and after major UI changes.
- Keep raw editable source files outside the deployed bundle unless needed.

## 5. Suggested Sequencing

1. Donation button and support page.
2. Logo replacement and screenshot refresh.
3. Transport abstraction groundwork.
4. Telegram notification MVP.
5. Slack notification MVP.
6. Subscription tier scaffolding and `/pro` page.
7. WhatsApp paid-tier pilot.
8. Yahoo provider alpha.
9. Public subscription launch.

## 6. Open Decisions

- Final donation provider: Stripe Payment Link, Buy Me a Coffee, or Ko-fi.
- Final product name.
- Final governing law and contact address for legal pages.
- Free league cap.
- Whether Yahoo launches as Pro-only or enters Free after a beta period.
- Whether Slack should support private channels in v1.
- Whether WhatsApp should use Twilio permanently or migrate to Meta Cloud API later.

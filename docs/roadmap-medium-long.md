# Medium/Long Roadmap Milestones

For the consolidated growth plan covering transports, Yahoo, monetization, logo, and screenshots, see [Growth Roadmap](./growth-roadmap.md).

## Medium Term

### 1) Notification condensation for waiver bursts
- Group contiguous waiver/add-drop events by league + transaction type.
- Emit paginated messages with up to 6 line items per message.
- Preserve links and transaction IDs in each page footer.
- Add unit tests for grouping boundaries and page splits.

### 2) ESPN unofficial adapter
- Ship an adapter spike behind a feature flag (`ESPN_UNOFFICIAL_ENABLED`).
- Support read-only league snapshot + activity ingestion first.
- Add retries and shape guards for unstable upstream response changes.
- Keep ESPN routes isolated from Sleeper pipeline via provider abstraction.

### 3) Yahoo adapter
- Implement OAuth flow and secure token storage/refresh.
- Build parity read-model: leagues, rosters, transactions, active draft state.
- Reuse dashboard contracts so UI tabs remain provider-agnostic.
- Roll out to private alpha with telemetry before broad enablement.

### 4) Telegram notification transport
- Add Telegram bot token config and signed deep-link account linking.
- Store Telegram destination metadata for each user and notification route.
- Reuse the normalized notification fanout path through a transport adapter.
- Add opt-in/unlink controls in the web help/account page.

### 5) Slack notification transport
- Add Slack OAuth installation and callback routes.
- Store workspace, channel, and bot-token metadata securely.
- Add channel selection to subscription management.
- Add Slack-specific mention mapping and route health diagnostics.

### 6) WhatsApp bot parity
- Start with Twilio WhatsApp transport abstraction matching Discord command intents.
- Reuse core domain services (`lineup`, `draft`, `transactions`) through channel adapters.
- Add per-user channel preference and notification rate controls.
- Gate WhatsApp behind paid entitlements because delivery has variable vendor cost.

## Long Term

### 1) Stripe hardening
- Move to explicit entitlement states and audit trails for billing transitions.
- Add webhook replay tooling and dead-letter handling for failed events.
- Add account self-service for subscription status and payment troubleshooting.

### 2) Railway migration readiness
- Externalize runtime config and secrets to Railway-managed envs.
- Move schedules/pollers to Railway-compatible workers/cron.
- Add deployment runbook:
  - preflight checks,
  - migration order,
  - smoke tests,
  - rollback steps.
- Add baseline SLO dashboards and alerting before cutover.

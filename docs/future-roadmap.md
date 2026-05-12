# Future Roadmap (Post-Sprint)

## Focus Areas
- Expand notification transports with Telegram, Slack, then WhatsApp
- Complete ESPN integration to parity-level reliability
- Finish Stripe commercialization hardening
- Decide next provider expansion (Yahoo vs CBS vs NFL.com)

For the consolidated growth plan covering transports, Yahoo, donations/subscriptions, logo, and screenshots, see [Growth Roadmap](./growth-roadmap.md).

## Phase 1 - Notification Transport Expansion

### Goals
- Add Telegram and Slack as free-tier notification destinations.
- Productionize WhatsApp as a paid-tier notification destination.
- Reuse existing normalized notification pipeline (same event source, different transport).

### Milestones
1. **Transport abstraction**
   - Define a shared `TransportAdapter` interface for Discord, Telegram, Slack, and WhatsApp.
   - Add transport destination metadata to the subscription model.
2. **Telegram MVP**
   - Implement BotFather token config, deep-link account linking, and direct-message delivery.
   - Add Telegram route management to the web subscription UI.
3. **Slack MVP**
   - Implement Slack OAuth installation, channel selection, and `chat.postMessage` delivery.
   - Add Slack-specific mention mapping and route diagnostics.
4. **WhatsApp paid pilot**
   - Implement Twilio WhatsApp sender abstraction.
   - Add phone verification, opt-in state, and paid-tier entitlement checks.
5. **Delivery guarantees**
   - Reuse idempotency/event journal behavior to prevent duplicate sends.
   - Add retry policy + dead-letter/error logging.
6. **User onboarding and controls**
   - Add web workflows for linking Telegram, Slack, and WhatsApp.
   - Add opt-in/opt-out controls per category.
7. **Operational readiness**
   - Add delivery metrics and failure alerts by transport.
   - Add runbooks for Slack install errors and Twilio template/content issues.

### Exit Criteria
- At least 1 production user receives stable waiver/draft/lineup notifications via Telegram.
- At least 1 production workspace receives stable notifications via Slack.
- At least 1 paid pilot user receives stable notifications via WhatsApp.
- Duplicate send rate remains at/near zero during retries/restarts.

---

## Phase 2 - ESPN Completion

### Goals
- Move ESPN from spike mode to reliable, user-facing integration with known limitations.

### Milestones
1. **Auth and access**
   - Support public + private league access (cookie path where needed).
   - Validate/help UX for missing or invalid cookies.
2. **Draft status fidelity**
   - Improve draft-state detection with multi-view fallback.
   - Normalize pick/on-clock/status events into existing pipeline schema.
3. **Transactions and waivers**
   - Normalize recent activity and map to `transactions` / `waivers` categories.
   - Add provider-specific parsing guards for schema drift.
4. **Provider routing**
   - Wire ESPN events through same fanout path as Sleeper.
   - Add provider-aware subscriptions and diagnostics.

### Exit Criteria
- ESPN draft + transaction notifications deliver through the same fanout architecture as Sleeper.
- Known limitations documented in `/help` and web help page.

---

## Phase 3 - Stripe Hardening

### Goals
- Make billing state resilient and operator-friendly.

### Milestones
1. **Webhook resiliency**
   - Keep idempotent event handling; add replay tooling and operational scripts.
   - Add missing-mapping recovery flow for customer/user links.
2. **Entitlement correctness**
   - Expand explicit states: active, trialing, grace, canceled, delinquent.
   - Ensure bot gating behavior is consistent for all states.
3. **User experience**
   - Improve billing-status diagnostics in dashboard (state + next action).
   - Improve error copy and escalation path.
4. **Auditability**
   - Add event timeline visibility for support/debugging.

### Exit Criteria
- No entitlement drift on duplicate or replayed Stripe events.
- Billing issues can be diagnosed from logs/UI without DB deep-dives.

---

## What’s Left Beyond These?

## Priority Candidates
- **Yahoo** (official API + OAuth) -> highest-confidence next provider.
- **CBS** -> still unresolved program/access certainty; keep as investigation item.
- **NFL.com** -> verify current developer onboarding and usable endpoints.
- **Railway migration** -> deployment/cost/ops readiness track.

## CBS Status
- **Not implemented yet.**
- Still in **investigate/feasibility** status due to unclear modern onboarding/program reliability.
- Initial smoke tooling added (`npm run cbs:smoke`) to validate token/access assumptions quickly once credentials are available.
- Recommended order remains: Yahoo first, then reassess CBS/NFL.com with fresh validation.

---

## Suggested Sequencing
1. Telegram notification MVP
2. Slack notification MVP
3. Twilio WhatsApp paid pilot
4. ESPN completion (draft + activity parity)
5. Stripe hardening
6. Yahoo integration
7. CBS/NFL.com decision gate

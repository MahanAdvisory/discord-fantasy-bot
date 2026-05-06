# Future Roadmap (Post-Sprint)

## Focus Areas
- Finalize WhatsApp delivery via Twilio
- Complete ESPN integration to parity-level reliability
- Finish Stripe commercialization hardening
- Decide next provider expansion (Yahoo vs CBS vs NFL.com)

## Phase 1 - WhatsApp (Twilio) Finalization

### Goals
- Productionize WhatsApp as a first-class notification destination.
- Reuse existing normalized notification pipeline (same event source, different transport).

### Milestones
1. **Transport adapter**
   - Implement `whatsapp` adapter with Twilio sender abstraction.
   - Add destination metadata to subscription model (phone, opt-in state, channel type).
2. **Delivery guarantees**
   - Reuse idempotency/event journal behavior to prevent duplicate sends.
   - Add retry policy + dead-letter/error logging.
3. **User onboarding**
   - Add web + Discord workflow for WhatsApp linking/verification.
   - Add opt-in/opt-out controls per category.
4. **Operational readiness**
   - Add delivery metrics and failure alerts.
   - Add runbook for Twilio template/content issues.

### Exit Criteria
- At least 1 production user receives stable waiver/draft/lineup notifications via WhatsApp.
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
1. Twilio WhatsApp finalize
2. ESPN completion (draft + activity parity)
3. Stripe hardening
4. Yahoo integration
5. CBS/NFL.com decision gate

# WhatsApp Transport Spike (Decision Note)

## Objective
Choose initial transport for WhatsApp bot parity with Discord notifications.

## Candidates

### Option A: Twilio WhatsApp
Pros:
- Fastest developer onboarding.
- Stable SDK/webhook tooling.
- Good for MVP and iterative experimentation.

Cons:
- Extra vendor layer/cost.
- Template approval + throughput constraints still apply.

### Option B: Meta Cloud API
Pros:
- Direct platform integration.
- Potential long-term cost/control advantages.

Cons:
- More setup complexity.
- Heavier operational responsibility up front.

## Recommendation for Phase 1
Use **Twilio WhatsApp** for MVP transport, then evaluate direct Meta migration later if volume/cost justifies it.

## MVP Scope
- Notification fanout only (no full command parity in v1).
- Support core categories:
  - waivers
  - transactions
  - draft status
  - lineup alerts
- Preserve same normalized event shape used by Discord path.

## MVP Acceptance Criteria
- User can opt into WhatsApp destination.
- One notification category successfully delivered end-to-end.
- Delivery failures are logged and non-fatal to poll loop.
- No duplicate sends on retry/replay.

## Next Engineering Tasks
1. Define `TransportAdapter` interface (`discord`, `whatsapp`).
2. Add WhatsApp destination metadata to subscription model.
3. Implement Twilio sender + webhook health checks.
4. Add staging-only rollout flag and smoke tests.

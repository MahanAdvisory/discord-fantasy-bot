# Sprint Board

## Status Columns
- Backlog
- Ready
- In Progress
- Review
- Done
- Blocked

## Sprint Goal
Ship the first non-Sleeper expansion path and improve notification quality, while de-risking deployment/billing operations.

## Sprint 1 (Now)

### P0 - Notification batching for waiver bursts
- [ ] Status: In Progress
- [ ] Owner: Unassigned
- [ ] Estimate: 2-3 days
- [x] Group waiver/add-drop notifications by league and event window.
- [x] Paginate to max 6 line-items per message.
- [x] Include page header/footer (`page X/Y`, league, status).
- [x] Preserve idempotency and prevent duplicates.
- [ ] Acceptance: burst of 20 waiver events produces <=4 messages with correct paging.
- [ ] Acceptance: single-event behavior unchanged when no burst exists.

### P1 - ESPN unofficial adapter (spike -> read-only integration)
- [ ] Status: In Progress
- [ ] Owner: Unassigned
- [ ] Estimate: 3-4 days
- [ ] Dependency: provider abstraction/dashboard contracts.
- [x] Build adapter behind feature flag (`ESPN_UNOFFICIAL_ENABLED`).
- [ ] Pull leagues, roster snapshot, and recent activity (best effort).
- [ ] Add robust shape guards/retries for brittle endpoints.
- [ ] Acceptance: ESPN league rows render without impacting Sleeper paths.
- [ ] Acceptance: ESPN adapter failures do not break page load.

### P1 - Waiver relevance quality pass
- [x] Status: Done
- [ ] Owner: Unassigned
- [ ] Estimate: 1 day
- [x] Filter stale players (no team and no recent stats).
- [ ] Improve sort tie-breakers for relevant pickups.
- [ ] Acceptance: retired/inactive players no longer rise to top by default.

## Sprint 2 (Next)

### P1 - Yahoo adapter (OAuth + parity read model)
- [ ] Status: Backlog
- [ ] Owner: Unassigned
- [ ] Estimate: 4-6 days
- [ ] Dependency: ESPN adapter pattern + provider abstraction.
- [ ] Implement OAuth flow and secure token refresh.
- [ ] Add league + roster + activity ingestion for dashboard parity.
- [ ] Acceptance: Yahoo-linked user sees data in existing dashboard tabs.

### P2 - WhatsApp channel parity (phase 1)
- [ ] Status: Backlog
- [ ] Owner: Unassigned
- [ ] Estimate: 3-5 days
- [ ] Dependency: transport decision (Twilio vs Meta Cloud API).
- [ ] Implement transport adapter + minimal command parity (`updates`, `lineup`, notifications).
- [ ] Acceptance: mapped users receive notifications + basic command responses.

## Hardening Track (Parallel)

### P1 - Stripe hardening
- [ ] Status: Backlog
- [ ] Owner: Unassigned
- [ ] Estimate: 2-3 days
- [ ] Add webhook replay safety tooling.
- [ ] Tighten entitlement transitions and billing troubleshooting UX.
- [ ] Acceptance: duplicate/replayed events do not cause entitlement drift.

### P2 - Railway migration readiness
- [ ] Status: Backlog
- [ ] Owner: Unassigned
- [ ] Estimate: 2-4 days
- [ ] Build env parity checklist.
- [ ] Define worker/cron strategy for pollers/jobs.
- [ ] Publish deployment + rollback runbook.
- [ ] Acceptance: dry-run deployment checklist executes end-to-end.

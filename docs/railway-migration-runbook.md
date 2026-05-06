# Railway Migration Runbook

## Goal
Migrate bot + web workloads from local hosting to Railway with safe rollback.

## Preflight Checklist
- [ ] Confirm all required env vars are documented and available in Railway:
  - bot: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DATABASE_URL`, `BILLING_URL`, Stripe vars
  - web: `NEXTAUTH_SECRET`, OAuth provider vars, Stripe vars
- [ ] Confirm Prisma migrations are up to date and deployable.
- [ ] Confirm webhook endpoints are reachable from public internet.
- [ ] Confirm background poll interval behavior is acceptable in container lifecycle.

## Service Split
- **Web service**: Next.js app (`web` workspace), public HTTP.
- **Bot/worker service**: Discord bot + hourly polling worker, no public ingress required.
- **Database**: Railway Postgres or external managed Postgres.

## Deploy Order
1. Deploy DB (or attach existing DB).
2. Run `prisma migrate deploy`.
3. Deploy web service and verify:
   - auth callback URLs,
   - billing routes,
   - `/help` and dashboard routes.
4. Deploy bot/worker service and verify:
   - slash command registration on startup,
   - poll loop logs,
   - notification delivery smoke test.
5. Point Stripe webhook to Railway web URL and validate event ingestion.

## Smoke Tests
- [ ] Discord slash command: `/help` returns expected content.
- [ ] Sleeper link + dashboard loads.
- [ ] Notification route test posts to target channel.
- [ ] Billing status endpoint reflects active/inactive states.

## Rollback Plan
- Keep previous local deployment runnable until Railway passes 24h soak.
- If critical failure:
  1. disable Railway bot service,
  2. restore previous webhook URL and bot host,
  3. re-run local bot with same DB,
  4. validate command + notification smoke checks.

## Operational Notes
- Use distinct Railway env groups for `staging` and `production`.
- Ensure one active poller instance to avoid duplicate sends.
- Add uptime + error alerting before final cutover.

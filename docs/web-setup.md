# Web dashboard (`web/`)

Next.js app with Discord OAuth (same users as the bot), Sleeper dashboard API, and Stripe Checkout / Customer Portal.

## Environment variables

Copy into `web/.env.local` (and align the Discord bot’s `.env` where noted).

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Same PostgreSQL URL as the bot / Prisma |
| `NEXTAUTH_URL` | Public origin of the web app (e.g. `http://localhost:3000`) |
| `NEXTAUTH_SECRET` | Random string for NextAuth (e.g. `openssl rand -base64 32`) |
| `DISCORD_CLIENT_ID` | Same Discord application as the bot |
| `DISCORD_CLIENT_SECRET` | OAuth2 client secret from the [Discord Developer Portal](https://discord.com/developers/applications) (OAuth2 section — not the bot token) |
| `NEXT_PUBLIC_APP_URL` | Same as `NEXTAUTH_URL` for redirects |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Signing secret from Stripe Dashboard → Webhooks |
| `STRIPE_PRICE_ID` | Recurring price id for Checkout |

Discord OAuth redirect: add `http://localhost:3000/api/auth/callback/discord` (and production URL) under OAuth2 redirects.

## Stripe webhook

Point Stripe at:

`https://<your-domain>/api/stripe/webhook`

Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.

## Scripts

From repo root:

```bash
npm install
npm run web:dev
```

## Bot billing gate

When `STRIPE_SECRET_KEY` is set, the Discord bot requires an active subscription (except allowlisted commands like `/link`). Set `DISABLE_COMMERCIAL_GATE=true` to disable the gate, or leave `STRIPE_SECRET_KEY` unset during development so the gate stays open.

Set `BILLING_URL` or `NEXT_PUBLIC_APP_URL` so blocked users see your dashboard URL in the reply.

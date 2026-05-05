import { prisma } from "./db.js";

const ALLOWLIST_DEFAULT = "link";

function allowlist(): Set<string> {
  const raw = process.env.COMMERCIAL_GATE_ALLOWLIST_COMMANDS ?? ALLOWLIST_DEFAULT;
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function commandAllowedWithoutSubscription(commandName: string): boolean {
  return allowlist().has(commandName);
}

/**
 * Dev / ops escape hatch: set DISABLE_COMMERCIAL_GATE=true to turn off billing checks.
 * If Stripe is not configured (`STRIPE_SECRET_KEY` unset), the gate is open so existing installs keep working.
 */
export async function userHasActiveCommercialAccess(discordUserId: string): Promise<boolean> {
  if (process.env.DISABLE_COMMERCIAL_GATE === "true") return true;
  if (!process.env.STRIPE_SECRET_KEY?.trim()) return true;

  const user = await prisma.user.findUnique({
    where: { discordUserId },
    include: { billingSubscription: true },
  });

  const sub = user?.billingSubscription;
  if (!sub) return false;
  const activeStatuses = new Set(["active", "trialing"]);
  return activeStatuses.has(sub.status);
}

export async function ensureUserForDiscord(discordUserId: string): Promise<void> {
  await prisma.user.upsert({
    where: { discordUserId },
    create: { discordUserId },
    update: {},
  });
}

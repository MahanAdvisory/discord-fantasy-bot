/**
 * Notification categories and routing (plan todo: notification-matrix).
 *
 * Routing: each `NotificationSubscription` chooses a destination (guild+channel or DM)
 * and a list of categories. Same user can add multiple subscriptions for different
 * leagues or channels.
 */
export const NOTIFICATION_CATEGORIES = [
  "draft_on_the_clock",
  "draft_status",
  "transactions",
  "waivers",
  "lineup_alerts",
  "league_scores",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export function isNotificationCategory(value: string): value is NotificationCategory {
  return (NOTIFICATION_CATEGORIES as readonly string[]).includes(value);
}

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  draft_on_the_clock: "Draft: your pick is up",
  draft_status: "Draft: general (round/pick updates)",
  transactions: "Trades and adds/drops",
  waivers: "Waiver results / FAAB",
  lineup_alerts: "Lineup issues (bye/IR/out) + suggestions",
  league_scores: "League / matchup highlights",
};

/** Default categories when a user adds a subscription without narrowing. */
export const DEFAULT_SUBSCRIPTION_CATEGORIES: NotificationCategory[] = [
  "draft_on_the_clock",
  "transactions",
  "waivers",
  "lineup_alerts",
];

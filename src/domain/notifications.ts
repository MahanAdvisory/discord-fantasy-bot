/**
 * Notification categories and routing (product rules).
 *
 * Guild: at most one destination per (server, league scope, category). The same league
 * may use different channels for different categories. The same league may be configured
 * on multiple Discord servers. DM routes are per Discord-linked user.
 *
 * League scope: real Sleeper `league_id` or ALL_LEAGUES_SCOPE for "all my leagues".
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
  "draft_status",
  "transactions",
  "waivers",
  "lineup_alerts",
];

/**
 * Categories that tie a Discord destination to Sleeper league activity for a user.
 * Used for `/check-lineup` (no explicit `lineup_alerts` row required) and the once-daily
 * lineup scan. Excludes `league_scores` so score-only channels are not treated as roster alerts.
 */
export const LINEUP_MONITOR_SUBSCRIPTION_CATEGORIES: NotificationCategory[] = [
  "draft_on_the_clock",
  "draft_status",
  "transactions",
  "waivers",
  "lineup_alerts",
];

/** Stored in DB when a route applies to all linked Sleeper leagues. */
export const ALL_LEAGUES_SCOPE = "__all__" as const;

export function leagueScopeFromOption(sleeperLeagueId: string | null): string {
  return sleeperLeagueId?.trim() || ALL_LEAGUES_SCOPE;
}

/** Namespace for unique (server|user) + league scope + category. Guild: `g:{guildId}`. DM: `u:{userRowId}`. */
export function routeNamespaceGuild(guildId: string): string {
  return `g:${guildId}`;
}

export function routeNamespaceDm(internalUserId: string): string {
  return `u:${internalUserId}`;
}

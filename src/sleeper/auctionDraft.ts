import type { SleeperDraftDetail } from "./draftDetail.js";

/** Auction-specific keys Sleeper stores on draft `metadata` (all string values). */
export interface SleeperAuctionDraftMetadata {
  nominated_player_id?: string;
  nominating_user_id?: string;
  nominating_slot?: string;
  offering_user_id?: string;
  offering_slot?: string;
  highest_offer?: string;
  passed_slots?: string;
  timer_end_at?: string;
  last_action_at?: string;
  hovered_player_id?: string;
}

export function isAuctionDraft(draft: Pick<SleeperDraftDetail, "type">): boolean {
  return draft.type?.toLowerCase() === "auction";
}

export function parseAuctionMetadata(
  metadata: SleeperDraftDetail["metadata"] | undefined,
): SleeperAuctionDraftMetadata {
  if (!metadata || typeof metadata !== "object") return {};
  const m = metadata as Record<string, unknown>;
  const out: SleeperAuctionDraftMetadata = {};
  for (const key of [
    "nominated_player_id",
    "nominating_user_id",
    "nominating_slot",
    "offering_user_id",
    "offering_slot",
    "highest_offer",
    "passed_slots",
    "timer_end_at",
    "last_action_at",
    "hovered_player_id",
  ] as const) {
    const v = m[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim();
  }
  return out;
}

export function parseTimerEndAt(iso: string | undefined): Date | null {
  if (!iso?.trim()) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** True when an offering/nomination timer expires within `withinMinutes` (default 10). */
export function isAuctionTimerExpiringSoon(
  timerEndAtIso: string | undefined,
  withinMinutes = 10,
  now = new Date(),
): boolean {
  const end = parseTimerEndAt(timerEndAtIso);
  if (!end) return false;
  const ms = end.getTime() - now.getTime();
  return ms > 0 && ms <= withinMinutes * 60_000;
}

export function formatAuctionAmount(amount: string | undefined): string | null {
  if (!amount?.trim()) return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return `$${amount.trim()}`;
  return `$${n}`;
}

export function pickWinningAmount(
  pick: { metadata?: { amount?: string } },
): string | null {
  return formatAuctionAmount(pick.metadata?.amount);
}

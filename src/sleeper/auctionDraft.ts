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

export function pickPlayerSummary(p: {
  player_id: string;
  metadata?: { first_name?: string; last_name?: string; position?: string; team?: string };
}): string {
  const nm =
    p.metadata?.last_name != null
      ? `${p.metadata?.first_name ?? ""} ${p.metadata.last_name}`.trim()
      : p.player_id;
  const pos = p.metadata?.position ?? "?";
  const nfl = p.metadata?.team?.trim();
  return nfl ? `${nm} (${pos}, ${nfl})` : `${nm} (${pos})`;
}

export function formatTimerRemaining(iso: string | undefined, now = new Date()): string {
  const end = parseTimerEndAt(iso);
  if (!end) return iso?.trim() ? "unknown" : "—";
  const ms = end.getTime() - now.getTime();
  if (ms <= 0) return "expired";
  const mins = Math.ceil(ms / 60_000);
  if (mins < 60) return `~${mins} min`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return remMins > 0 ? `~${hours}h ${remMins}m` : `~${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `~${days}d ${remHours}h` : `~${days}d`;
}

/** Display lines for live auction draft status (slash commands). */
export function auctionDraftStatusLines(args: {
  status: string;
  metadata: SleeperDraftDetail["metadata"];
  picks: Array<{
    pick_no: number;
    picked_by: string;
    player_id: string;
    metadata?: { first_name?: string; last_name?: string; position?: string; team?: string; amount?: string };
  }>;
  teamLabel: (userId: string | null | undefined) => string;
  playerLabel: (playerId: string) => string;
  now?: Date;
}): string[] {
  const now = args.now ?? new Date();
  const meta = parseAuctionMetadata(args.metadata);
  const out: string[] = [];

  if (meta.nominated_player_id) {
    const nominatedLabel = args.playerLabel(meta.nominated_player_id);
    const highBid = formatAuctionAmount(meta.highest_offer);
    const bidder = args.teamLabel(meta.offering_user_id);
    const nominator = args.teamLabel(meta.nominating_user_id);
    const timerLeft = formatTimerRemaining(meta.timer_end_at, now);
    out.push(`**On the block:** ${nominatedLabel}`);
    out.push(`**Time left:** ${timerLeft}`);
    if (highBid) {
      out.push(`**High bid:** ${highBid} — **${bidder}**`);
    } else {
      out.push(`**High bid:** — _(no bids yet)_`);
    }
    if (meta.nominating_user_id) {
      out.push(`_Nominated by:_ **${nominator}**`);
    }
  } else if (args.status === "drafting") {
    out.push(`_On the block:_ — _(waiting for nomination)_`);
  }

  const last = args.picks[args.picks.length - 1];
  if (last) {
    const amount = pickWinningAmount(last);
    const winner = args.teamLabel(last.picked_by);
    const pricePart = amount ? ` for **${amount}**` : "";
    out.push(`_Last won (#${last.pick_no}):_ ${pickPlayerSummary(last)}${pricePart} → **${winner}**`);
  } else {
    out.push(`_Last won:_ —`);
  }

  return out;
}

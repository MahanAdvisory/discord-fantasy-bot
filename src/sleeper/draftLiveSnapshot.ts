import { prisma } from "../db.js";
import { sleeperDraftUrlPlain } from "../domain/sleeperLinks.js";
import {
  formatAuctionAmount,
  formatTimerRemaining,
  isAuctionDraft,
  parseAuctionMetadata,
  pickPlayerSummary,
} from "./auctionDraft.js";
import { getDraft, getDraftPicks, getOnTheClockPickerUserId, type SleeperDraftDetail, type SleeperDraftPick } from "./draftDetail.js";
import { getLeagueUsers } from "./leagueUsers.js";
import { fetchAllNflPlayers } from "./playersFull.js";

export interface DraftLastPickSnapshot {
  pickNo: number;
  player: string;
  amount: string | null;
  winner: string;
}

export interface DraftAuctionSnapshot {
  onTheBlock: string | null;
  timeLeft: string;
  highBid: string | null;
  highBidder: string | null;
  nominatedBy: string | null;
}

export interface DraftLiveSnapshot {
  draftId: string;
  draftType: string | null;
  picksComplete: number;
  nextPickNumber: number;
  draftUrl: string;
  /** Snake/linear on-the-clock team; null for auction drafts. */
  onTheClock: string | null;
  lastPick: DraftLastPickSnapshot | null;
  /** Populated when `draftType` is auction. */
  auction: DraftAuctionSnapshot | null;
}

let playerCatalogCache: Map<string, string> | null = null;

function playerLabelFromCatalog(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { first_name?: string; last_name?: string; position?: string; team?: string; full_name?: string };
  const name = d.full_name?.trim() || `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim();
  if (!name) return null;
  const pos = d.position?.trim();
  const team = d.team?.trim();
  if (pos && team) return `${name} (${pos}, ${team})`;
  if (pos) return `${name} (${pos})`;
  return name;
}

async function ensurePlayerCatalogCache(): Promise<Map<string, string>> {
  if (playerCatalogCache) return playerCatalogCache;
  const raw = await fetchAllNflPlayers().catch(() => ({} as Record<string, unknown>));
  const out = new Map<string, string>();
  for (const [playerId, data] of Object.entries(raw)) {
    const label = playerLabelFromCatalog(data);
    if (label) out.set(playerId, label);
  }
  playerCatalogCache = out;
  return out;
}

export async function resolveSleeperPlayerLabel(playerId: string): Promise<string> {
  try {
    const row = await prisma.sleeperPlayer.findUnique({
      where: { playerId },
      select: { data: true },
    });
    const fromDb = row ? playerLabelFromCatalog(row.data) : null;
    if (fromDb) return fromDb;
  } catch {
    /* DB optional in tests / when catalog is enough */
  }
  const catalog = await ensurePlayerCatalogCache();
  return catalog.get(playerId) ?? playerId;
}

async function userLabelMap(leagueId: string): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  const users = await getLeagueUsers(leagueId).catch(() => []);
  for (const u of users) {
    if (!u.user_id) continue;
    const label =
      u.username?.trim() ||
      u.display_name?.trim() ||
      u.metadata?.team_name?.trim() ||
      u.user_id;
    m.set(u.user_id, label);
  }
  return m;
}

function teamLabel(labels: Map<string, string>, userId: string | null | undefined): string | null {
  if (!userId) return null;
  return labels.get(userId) ?? userId;
}

function lastPickSnapshot(
  picks: SleeperDraftPick[],
  labels: Map<string, string>,
): DraftLastPickSnapshot | null {
  const last = picks[picks.length - 1];
  if (!last) return null;
  return {
    pickNo: last.pick_no,
    player: pickPlayerSummary(last),
    amount: formatAuctionAmount(last.metadata?.amount),
    winner: labels.get(last.picked_by) ?? last.picked_by,
  };
}

async function auctionSnapshotFromDetail(
  detail: SleeperDraftDetail,
  labels: Map<string, string>,
): Promise<DraftAuctionSnapshot> {
  const meta = parseAuctionMetadata(detail.metadata);
  let onTheBlock: string | null = null;
  if (meta.nominated_player_id) {
    onTheBlock = await resolveSleeperPlayerLabel(meta.nominated_player_id);
  }
  return {
    onTheBlock,
    timeLeft: formatTimerRemaining(meta.timer_end_at),
    highBid: formatAuctionAmount(meta.highest_offer),
    highBidder: teamLabel(labels, meta.offering_user_id),
    nominatedBy: teamLabel(labels, meta.nominating_user_id),
  };
}

/** Live draft room snapshot for web dashboard and league detail panels. */
export async function buildDraftLiveSnapshot(
  leagueId: string,
  draftId: string,
): Promise<DraftLiveSnapshot | null> {
  const [detail, picks, labels] = await Promise.all([
    getDraft(draftId).catch(() => null),
    getDraftPicks(draftId).catch(() => []),
    userLabelMap(leagueId),
  ]);
  if (!detail) return null;

  const n = picks.length;
  const auction = isAuctionDraft(detail) ? await auctionSnapshotFromDetail(detail, labels) : null;
  let onTheClock: string | null = null;
  if (!auction) {
    const uid = getOnTheClockPickerUserId(detail, n);
    if (uid) onTheClock = labels.get(uid) ?? uid;
  }

  return {
    draftId,
    draftType: detail.type ?? null,
    picksComplete: n,
    nextPickNumber: n + 1,
    draftUrl: sleeperDraftUrlPlain(draftId),
    onTheClock,
    lastPick: lastPickSnapshot(picks, labels),
    auction,
  };
}

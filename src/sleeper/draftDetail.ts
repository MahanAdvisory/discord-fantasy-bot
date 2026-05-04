import { V1, type SleeperDraft } from "./client.js";

export type { SleeperDraft };

export interface SleeperDraftDetail {
  draft_id: string;
  league_id: string;
  status: string;
  type?: string;
  season?: string;
  settings?: { teams?: number; rounds?: number; pick_timer?: number; reversal_round?: number | string };
  metadata?: { name?: string; scoring_type?: string; third_round_reversal?: string };
  draft_order?: Record<string, number | string> | null;
  slot_to_roster_id?: Record<string, string | number> | null;
}

export interface SleeperDraftPick {
  pick_no: number;
  round: number;
  draft_slot: number;
  player_id: string;
  picked_by: string;
  roster_id: string;
  metadata?: { first_name?: string; last_name?: string; position?: string; team?: string };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sleeper HTTP ${res.status} ${url} ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export async function getDraft(draftId: string): Promise<SleeperDraftDetail> {
  return getJson<SleeperDraftDetail>(`${V1}/draft/${draftId}`);
}

export async function getDraftPicks(draftId: string): Promise<SleeperDraftPick[]> {
  const raw = await getJson<SleeperDraftPick[] | null>(`${V1}/draft/${draftId}/picks`);
  return raw ?? [];
}

export async function getLeagueDrafts(leagueId: string): Promise<SleeperDraft[]> {
  const raw = await getJson<SleeperDraft[] | null>(`${V1}/league/${leagueId}/drafts`);
  return raw ?? [];
}

function resolvePickerFromSlot(
  draft: SleeperDraftDetail,
  targetSlot: number,
): string | null {
  const order = draft.draft_order;
  if (!order || typeof order !== "object") return null;
  for (const [userId, slotVal] of Object.entries(order)) {
    const s = typeof slotVal === "string" ? parseInt(slotVal, 10) : Number(slotVal);
    if (Number.isFinite(s) && s === targetSlot) return userId;
  }
  return null;
}

function teamCount(draft: SleeperDraftDetail): number | null {
  const order = draft.draft_order;
  if (!order || typeof order !== "object") return null;
  const entries = Object.entries(order);
  const n = draft.settings?.teams ?? entries.length;
  if (!n || n < 1) return null;
  return n;
}

function parse3rrEnabled(draft: SleeperDraftDetail): boolean {
  const reversalRoundRaw = draft.settings?.reversal_round;
  const reversalRound =
    typeof reversalRoundRaw === "string" ? parseInt(reversalRoundRaw, 10) : Number(reversalRoundRaw);
  return (
    reversalRound === 3 ||
    draft.metadata?.third_round_reversal === "1" ||
    draft.metadata?.third_round_reversal?.toLowerCase() === "true"
  );
}

export function getOnTheClockDraftSlot(draft: SleeperDraftDetail, nextPickIndex: number): number | null {
  const n = teamCount(draft);
  if (n == null) return null;
  const t = draft.type?.toLowerCase();
  if (t === "linear") return (nextPickIndex % n) + 1;
  if (t === "snake" || t === undefined || t === "") {
    const round = Math.floor(nextPickIndex / n);
    const idx = nextPickIndex % n;
    let forward = round % 2 === 0;
    if (parse3rrEnabled(draft) && round >= 2) {
      forward = round % 2 === 1;
    }
    return forward ? idx + 1 : n - idx;
  }
  return null;
}

/**
 * Linear draft: same slot order every round (1…n, 1…n, …).
 * `nextPickIndex` = completed pick count (0-based index of the next pick).
 */
export function getLinearDraftPickerUserId(draft: SleeperDraftDetail, nextPickIndex: number): string | null {
  const n = teamCount(draft);
  if (n == null) return null;
  const targetSlot = (nextPickIndex % n) + 1;
  return resolvePickerFromSlot(draft, targetSlot);
}

/**
 * Snake draft: pick order reverses each round.
 * `nextPickIndex` = completed pick count (0-based index of the next pick).
 */
export function getSnakeDraftPickerUserId(draft: SleeperDraftDetail, nextPickIndex: number): string | null {
  const slot = getOnTheClockDraftSlot({ ...draft, type: "snake" }, nextPickIndex);
  if (slot == null) return null;
  return resolvePickerFromSlot(draft, slot);
}

/**
 * On-the-clock Sleeper `user_id` for the next pick, when the draft type is supported.
 * Unknown/missing `type` is treated as **snake** (Sleeper’s common default).
 */
export function getOnTheClockPickerUserId(draft: SleeperDraftDetail, nextPickIndex: number): string | null {
  const t = draft.type?.toLowerCase();
  if (t === "linear") return getLinearDraftPickerUserId(draft, nextPickIndex);
  if (t === "snake" || t === undefined || t === "") return getSnakeDraftPickerUserId(draft, nextPickIndex);
  return null;
}

/** Sleeper `draft_order` maps `user_id` → 1-based draft slot. */
export function draftSlotForUserId(draft: SleeperDraftDetail, userId: string | null): number | null {
  if (!userId || !draft.draft_order || typeof draft.draft_order !== "object") return null;
  const raw = (draft.draft_order as Record<string, unknown>)[userId];
  if (raw === undefined || raw === null) return null;
  const n = typeof raw === "string" ? parseInt(raw, 10) : Number(raw);
  return Number.isFinite(n) ? n : null;
}

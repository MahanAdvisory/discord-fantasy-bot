import {
  getLeagueRosters,
  getLeagueTradedPicks,
  type SleeperRoster,
} from "./client.js";
import {
  getOnTheClockDraftSlot,
  getOnTheClockPickerUserId,
  type SleeperDraftDetail,
} from "./draftDetail.js";

/** Sleeper roster `co_owners` plus primary `owner_id` — all treated as full owners in this app. */
export function rosterMemberIds(roster: SleeperRoster): string[] {
  const ids: string[] = [];
  if (roster.owner_id) ids.push(roster.owner_id);
  for (const id of roster.co_owners ?? []) {
    if (typeof id === "string" && id.length > 0) ids.push(id);
  }
  return [...new Set(ids)];
}

export function rosterOwnedBy(roster: SleeperRoster, sleeperUserId: string): boolean {
  return rosterMemberIds(roster).includes(sleeperUserId);
}

export function findRosterForUser(
  rosters: SleeperRoster[],
  sleeperUserId: string,
): SleeperRoster | undefined {
  return rosters.find((r) => rosterOwnedBy(r, sleeperUserId));
}

/** Primary Sleeper user on the clock for the next pick (draft slot / traded-pick aware). */
export async function resolveOnClockPrimaryUserId(
  leagueId: string,
  draft: SleeperDraftDetail,
  nextPickIndex: number,
): Promise<string | null> {
  const slot = getOnTheClockDraftSlot(draft, nextPickIndex);
  if (slot == null) return getOnTheClockPickerUserId(draft, nextPickIndex);

  const baseRosterRaw = draft.slot_to_roster_id?.[String(slot)];
  const baseRosterId = Number(baseRosterRaw);
  if (!Number.isFinite(baseRosterId)) return getOnTheClockPickerUserId(draft, nextPickIndex);

  const rosters = await getLeagueRosters(leagueId).catch(() => []);
  const rosterOwner = new Map<number, string | null>(rosters.map((r) => [r.roster_id, r.owner_id]));
  const teams = draft.settings?.teams;
  if (!teams || teams < 1) return rosterOwner.get(baseRosterId) ?? null;
  const round = Math.floor(nextPickIndex / teams) + 1;
  const traded = await getLeagueTradedPicks(leagueId).catch(() => []);
  let ownerRosterId = baseRosterId;
  for (const tp of traded) {
    if (tp.round !== round) continue;
    if (draft.season && tp.season && tp.season !== draft.season) continue;
    if (tp.roster_id !== baseRosterId) continue;
    if (typeof tp.owner_id === "number") ownerRosterId = tp.owner_id;
  }
  return rosterOwner.get(ownerRosterId) ?? null;
}

/** Primary owner plus co-owners for the roster on the clock (for alerts / “your pick”). */
export async function resolveOnClockRosterMemberIds(
  leagueId: string,
  draft: SleeperDraftDetail,
  nextPickIndex: number,
): Promise<string[]> {
  const primary = await resolveOnClockPrimaryUserId(leagueId, draft, nextPickIndex);
  if (!primary) return [];
  const rosters = await getLeagueRosters(leagueId).catch(() => []);
  const roster = findRosterForUser(rosters, primary);
  return roster ? rosterMemberIds(roster) : [primary];
}

export function userIsAmongOnClockMembers(memberIds: string[], sleeperUserId: string): boolean {
  return memberIds.includes(sleeperUserId);
}

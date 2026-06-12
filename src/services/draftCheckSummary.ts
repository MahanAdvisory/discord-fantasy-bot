import * as sleeper from "../sleeper/client.js";
import type { SleeperDraft } from "../sleeper/client.js";
import {
  auctionDraftStatusLines,
  isAuctionDraft,
  parseAuctionMetadata,
  pickPlayerSummary,
} from "../sleeper/auctionDraft.js";
import {
  draftSlotForUserId,
  getDraft,
  getDraftPicks,
  getLeagueDrafts,
} from "../sleeper/draftDetail.js";
import {
  resolveOnClockRosterMemberIds,
  userIsAmongOnClockMembers,
} from "../sleeper/rosterOwnership.js";
import { getLeagueUsers } from "../sleeper/leagueUsers.js";
import { fetchAllNflPlayers } from "../sleeper/playersFull.js";
import { prisma } from "../db.js";
import { sleeperDraftUrl, sleeperLeagueUrl } from "./notifications/links.js";

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

async function playerLabelById(playerId: string): Promise<string> {
  const row = await prisma.sleeperPlayer.findUnique({
    where: { playerId },
    select: { data: true },
  });
  const fromDb = row ? playerLabelFromCatalog(row.data) : null;
  if (fromDb) return fromDb;
  const catalog = await ensurePlayerCatalogCache();
  return catalog.get(playerId) ?? `\`${playerId}\``;
}

function teamLabel(labels: Map<string, string>, userId: string | null | undefined): string {
  if (!userId) return "—";
  return labels.get(userId) ?? `\`${userId}\``;
}

function displayName(users: Map<string, string>, userId: string | null): string {
  if (!userId) return "—";
  return users.get(userId) ?? `\`${userId}\``;
}

async function userLabelMap(leagueId: string): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  try {
    const users = await getLeagueUsers(leagueId);
    for (const u of users) {
      if (!u.user_id) continue;
      const team = u.metadata?.team_name?.trim();
      const label = u.username?.trim() || u.display_name?.trim() || team || u.user_id;
      m.set(u.user_id, label);
    }
  } catch {
    /* Sleeper / network: still show pick # and slot; names may be ids only */
  }
  return m;
}

/**
 * Lines describing one drafting session (caller filters to status === "drafting" if needed).
 */
export async function linesForDraft(
  leagueName: string,
  draftId: string,
  leagueId: string,
  forSleeperUserId: string,
): Promise<string[]> {
  const detail = await getDraft(draftId).catch(() => null);
  if (!detail) {
    return [`**${leagueName}** · draft \`${draftId}\` — _could not load draft_`];
  }

  const picks = await getDraftPicks(draftId).catch(() => []);
  const labels = await userLabelMap(leagueId);
  const teams = detail.settings?.teams;
  const rounds = detail.settings?.rounds;
  const estTotal = teams && rounds ? teams * rounds : null;

  const out: string[] = [];
  out.push(`**${leagueName}** · \`${draftId}\``);
  out.push(
    `_Status:_ **${detail.status}**${detail.type ? ` · ${detail.type}` : ""}` +
      (estTotal != null ? ` · picks ${picks.length}/${estTotal}` : ` · **${picks.length}** picks so far`),
  );

  if (isAuctionDraft(detail)) {
    const meta = parseAuctionMetadata(detail.metadata);
    const playerLabels = new Map<string, string>();
    if (meta.nominated_player_id) {
      playerLabels.set(meta.nominated_player_id, await playerLabelById(meta.nominated_player_id));
    }
    out.push(
      ...auctionDraftStatusLines({
        status: detail.status,
        metadata: detail.metadata,
        picks,
        teamLabel: (id) => teamLabel(labels, id),
        playerLabel: (id) => playerLabels.get(id) ?? `\`${id}\``,
      }),
    );
    out.push(`${sleeperDraftUrl(draftId)} · ${sleeperLeagueUrl(leagueId)}`);
    return out;
  }

  const t = detail.type?.toLowerCase();
  if (detail.status === "drafting" && t && t !== "snake" && t !== "linear") {
    out.push(`_On-the-clock may be unsupported for draft type \`${detail.type}\`._`);
  }

  const nextIdx = picks.length;
  const sequencePick = nextIdx + 1;
  const onClockMembers = await resolveOnClockRosterMemberIds(leagueId, detail, nextIdx);
  const onClock = onClockMembers[0] ?? null;
  const onClockLabel = displayName(labels, onClock);
  const you = userIsAmongOnClockMembers(onClockMembers, forSleeperUserId) ? " **(you)**" : "";
  const slot = draftSlotForUserId(detail, onClock);
  const slotPart = slot != null ? ` · draft slot **${slot}**` : "";

  if (detail.status === "drafting") {
    if (onClock) {
      out.push(`**Up now:** Pick **${sequencePick}** — **${onClockLabel}**${slotPart}${you}`);
    } else {
      out.push(
        `**Up now:** Pick **${sequencePick}** — _on-the-clock team unknown_ (check draft type / \`draft_order\`).`,
      );
    }
  } else {
    out.push(`_Next would be pick_ **${sequencePick}** — _on the clock:_ ${onClockLabel}${you}`);
  }

  const last = picks[picks.length - 1];
  if (last) {
    const pickedBy = labels.get(last.picked_by) ?? `\`${last.picked_by}\``;
    out.push(`_Last pick (#${last.pick_no}):_ ${pickPlayerSummary(last)} by **${pickedBy}**`);
  } else {
    out.push(`_Last pick:_ —`);
  }
  out.push(`${sleeperDraftUrl(draftId)} · ${sleeperLeagueUrl(leagueId)}`);

  return out;
}

/** Sort tier: live → pre-draft → complete → anything else (paused, etc.). */
function statusRank(status: string): number {
  const k = status.toLowerCase();
  if (k === "drafting") return 0;
  if (k === "predraft" || k === "pre_draft" || k === "pre-draft") return 1;
  if (k === "complete" || k === "completed") return 2;
  return 3;
}

async function userIsOnClockInDraft(d: SleeperDraft, sleeperUserId: string): Promise<boolean> {
  if (d.status !== "drafting") return false;
  const detail = await getDraft(d.draft_id).catch(() => null);
  if (!detail || detail.status !== "drafting") return false;
  const picks = await getDraftPicks(d.draft_id).catch(() => []);
  const onClockMembers = await resolveOnClockRosterMemberIds(d.league_id, detail, picks.length);
  return userIsAmongOnClockMembers(onClockMembers, sleeperUserId);
}

export type DraftListEntry = { draft: SleeperDraft; onClock: boolean };

/**
 * `/drafts` ordering: status tier (drafting → predraft → complete → other), then **your** on-the-clock
 * drafting rooms before other drafting rooms.
 */
export async function orderDraftsForSlashList(
  drafts: SleeperDraft[],
  sleeperUserId: string,
): Promise<DraftListEntry[]> {
  const rows = await Promise.all(
    drafts.map(async (draft) => ({
      draft,
      rank: statusRank(draft.status),
      onClock: await userIsOnClockInDraft(draft, sleeperUserId),
    })),
  );
  rows.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.draft.status === "drafting" && b.draft.status === "drafting" && a.onClock !== b.onClock) {
      return a.onClock ? -1 : 1;
    }
    const lc = a.draft.league_id.localeCompare(b.draft.league_id);
    if (lc !== 0) return lc;
    return a.draft.draft_id.localeCompare(b.draft.draft_id);
  });
  return rows.map(({ draft, onClock }) => ({ draft, onClock }));
}

/** Footer line for `/drafts`: counts per Sleeper `status` value. */
export function draftStatusCountsLine(drafts: SleeperDraft[]): string {
  const tallies = new Map<string, number>();
  for (const d of drafts) {
    const s = d.status.toLowerCase();
    tallies.set(s, (tallies.get(s) ?? 0) + 1);
  }
  const preferred = ["drafting", "predraft", "pre_draft", "complete", "completed"];
  const parts: string[] = [];
  const used = new Set<string>();
  for (const key of preferred) {
    const n = tallies.get(key);
    if (n) {
      parts.push(`**${n}** _${key}_`);
      used.add(key);
    }
  }
  for (const key of [...tallies.keys()].sort()) {
    if (used.has(key)) continue;
    parts.push(`**${tallies.get(key)!}** _${key}_`);
  }
  return parts.length ? `_By status:_ ${parts.join(" · ")}` : "";
}

/**
 * One draft for `/drafts`: single line when not live; otherwise the same detail as `/draft-check` (pick #, on-the-clock team, last pick), indented under a bullet.
 */
export async function linesForDraftsListEntry(
  d: SleeperDraft,
  sleeperUserId: string,
  opts?: { onClock?: boolean },
): Promise<string[]> {
  let leagueName = d.league_id;
  try {
    const lg = await sleeper.getLeague(d.league_id);
    leagueName = lg.name;
  } catch {
    /* */
  }

  if (d.status !== "drafting") {
    return [`• \`${d.draft_id}\` — _${d.status}_ — **${leagueName}** · \`${d.league_id}\``];
  }

  const body = await linesForDraft(leagueName, d.draft_id, d.league_id, sleeperUserId);
  return body.map((line, i) => {
    if (i === 0) {
      const tag = opts?.onClock ? "**Your pick is up** · " : "";
      return `• ${tag}${line}`;
    }
    return `  ${line}`;
  });
}

export async function buildDraftCheckDm(
  sleeperUserId: string,
  narrowLeagueId: string | null,
): Promise<string> {
  const state = await sleeper.getNflState();
  const season = state.league_season ?? state.season;
  let drafts = (await sleeper.getUserDrafts(sleeperUserId, season)).filter((d) => d.status === "drafting");

  if (narrowLeagueId?.trim()) {
    const lid = narrowLeagueId.trim();
    const userLeagues = await sleeper.getUserLeagues(sleeperUserId, season);
    if (!userLeagues.some((l) => l.league_id === lid)) {
      return `You are not in league \`${lid}\` for season **${season}**. Use \`/leagues\` for ids.`;
    }
    drafts = drafts.filter((d) => d.league_id === lid);
    if (!drafts.length) {
      return `No **drafting** draft for league \`${lid}\` right now. Use \`/drafts\` for all drafts.`;
    }
  }

  if (!drafts.length) {
    return `No drafts **in progress** (status \`drafting\`) for you this season. Use \`/drafts\` for pre-draft / complete.`;
  }

  const blocks: string[] = [];
  blocks.push(`**Draft check** · season ${season} · ${drafts.length} active`);
  for (const d of drafts) {
    let leagueName = d.league_id;
    try {
      const lg = await sleeper.getLeague(d.league_id);
      leagueName = lg.name;
    } catch {
      /* */
    }
    blocks.push("");
    blocks.push(...(await linesForDraft(leagueName, d.draft_id, d.league_id, sleeperUserId)));
  }
  return blocks.join("\n");
}

export async function buildDraftCheckDmPages(
  sleeperUserId: string,
  narrowLeagueId: string | null,
  activePerPage = 4,
): Promise<string[]> {
  const state = await sleeper.getNflState();
  const season = state.league_season ?? state.season;
  let drafts = (await sleeper.getUserDrafts(sleeperUserId, season)).filter((d) => d.status === "drafting");

  if (narrowLeagueId?.trim()) {
    const lid = narrowLeagueId.trim();
    const userLeagues = await sleeper.getUserLeagues(sleeperUserId, season);
    if (!userLeagues.some((l) => l.league_id === lid)) {
      return [`You are not in league \`${lid}\` for season **${season}**. Use \`/leagues\` for ids.`];
    }
    drafts = drafts.filter((d) => d.league_id === lid);
    if (!drafts.length) {
      return [`No **drafting** draft for league \`${lid}\` right now. Use \`/drafts\` for all drafts.`];
    }
  }

  if (!drafts.length) {
    return [`No drafts **in progress** (status \`drafting\`) for you this season. Use \`/drafts\` for pre-draft / complete.`];
  }

  const blocks = await buildActiveDraftBlocks(drafts, sleeperUserId);
  const groups = chunk(blocks, activePerPage);
  const pages: string[] = [];
  groups.forEach((group, idx) => {
    const lines: string[] = [];
    lines.push(`**Draft check** · season ${season} · ${drafts.length} active · page ${idx + 1}/${groups.length}`);
    lines.push("");
    for (let i = 0; i < group.length; i += 1) {
      lines.push(...group[i]);
      if (i < group.length - 1) lines.push("");
    }
    pages.push(lines.join("\n"));
  });
  return pages;
}

export async function buildDraftCheckGuild(
  sleeperUserId: string,
  leagueId: string,
  opts?: { allowNonMember?: boolean },
): Promise<string> {
  const state = await sleeper.getNflState();
  const season = state.league_season ?? state.season;
  const userLeagues = await sleeper.getUserLeagues(sleeperUserId, season);
  const inLeague = userLeagues.some((l) => l.league_id === leagueId);
  if (!inLeague && !opts?.allowNonMember) {
    return `You are not in league \`${leagueId}\` for season **${season}**. Use \`/leagues\` for ids.`;
  }

  let leagueName = leagueId;
  try {
    const lg = await sleeper.getLeague(leagueId);
    leagueName = lg.name;
  } catch {
    return `League \`${leagueId}\` not found on Sleeper.`;
  }

  const drafts = (await getLeagueDrafts(leagueId)).filter((d) => d.status === "drafting");
  if (!drafts.length) {
    return `**${leagueName}** — no draft **in progress** (\`drafting\`) right now. Use \`/drafts\` for other statuses.`;
  }

  const blocks: string[] = [];
  blocks.push(`**Draft check** · **${leagueName}** · ${drafts.length} active`);
  for (const d of drafts) {
    blocks.push("");
    blocks.push(...(await linesForDraft(leagueName, d.draft_id, leagueId, sleeperUserId)));
  }
  return blocks.join("\n");
}

export async function buildDraftCheckGuildPages(
  sleeperUserId: string,
  leagueId: string,
  opts?: { allowNonMember?: boolean; activePerPage?: number },
): Promise<string[]> {
  const state = await sleeper.getNflState();
  const season = state.league_season ?? state.season;
  const userLeagues = await sleeper.getUserLeagues(sleeperUserId, season);
  const inLeague = userLeagues.some((l) => l.league_id === leagueId);
  if (!inLeague && !opts?.allowNonMember) {
    return [`You are not in league \`${leagueId}\` for season **${season}**. Use \`/leagues\` for ids.`];
  }

  let leagueName = leagueId;
  try {
    const lg = await sleeper.getLeague(leagueId);
    leagueName = lg.name;
  } catch {
    return [`League \`${leagueId}\` not found on Sleeper.`];
  }

  const drafts = (await getLeagueDrafts(leagueId)).filter((d) => d.status === "drafting");
  if (!drafts.length) {
    return [`**${leagueName}** — no draft **in progress** (\`drafting\`) right now. Use \`/drafts\` for other statuses.`];
  }

  const blocks = await buildActiveDraftBlocks(drafts, sleeperUserId);
  const groups = chunk(blocks, opts?.activePerPage ?? 4);
  const pages: string[] = [];
  groups.forEach((group, idx) => {
    const lines: string[] = [];
    lines.push(`**Draft check** · **${leagueName}** · ${drafts.length} active · page ${idx + 1}/${groups.length}`);
    lines.push("");
    for (let i = 0; i < group.length; i += 1) {
      lines.push(...group[i]);
      if (i < group.length - 1) lines.push("");
    }
    pages.push(lines.join("\n"));
  });
  return pages;
}

function normalizedStatus(status: string): string {
  const k = status.toLowerCase();
  if (k === "pre_draft" || k === "pre-draft") return "predraft";
  if (k === "complete") return "completed";
  return k;
}

function statusBreakdown(drafts: SleeperDraft[]): Array<{ status: string; count: number }> {
  const counts = new Map<string, number>();
  for (const d of drafts) {
    const key = normalizedStatus(d.status);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const preferred = ["drafting", "predraft", "completed"];
  const out: Array<{ status: string; count: number }> = [];
  for (const key of preferred) {
    const n = counts.get(key);
    if (n) {
      out.push({ status: key, count: n });
      counts.delete(key);
    }
  }
  for (const key of [...counts.keys()].sort()) {
    out.push({ status: key, count: counts.get(key) ?? 0 });
  }
  return out;
}

function statusBreakdownLines(drafts: SleeperDraft[]): string[] {
  const rows = statusBreakdown(drafts);
  if (!rows.length) return [];
  return rows.map((r) => `• **${r.count}** _${r.status}_`);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function buildActiveDraftBlocks(active: SleeperDraft[], sleeperUserId: string): Promise<string[][]> {
  const blocks: string[][] = [];
  for (const d of active) {
    let leagueName = d.league_id;
    try {
      const lg = await sleeper.getLeague(d.league_id);
      leagueName = lg.name;
    } catch {
      /* */
    }
    blocks.push(await linesForDraft(leagueName, d.draft_id, d.league_id, sleeperUserId));
  }
  return blocks;
}

export async function buildDraftStatusDm(
  sleeperUserId: string,
  narrowLeagueId: string | null,
): Promise<string> {
  const state = await sleeper.getNflState();
  const season = state.league_season ?? state.season;
  let drafts = await sleeper.getUserDrafts(sleeperUserId, season);

  if (narrowLeagueId?.trim()) {
    const lid = narrowLeagueId.trim();
    const userLeagues = await sleeper.getUserLeagues(sleeperUserId, season);
    if (!userLeagues.some((l) => l.league_id === lid)) {
      return `You are not in league \`${lid}\` for season **${season}**. Use \`/leagues\` for ids.`;
    }
    drafts = drafts.filter((d) => d.league_id === lid);
  }

  if (!drafts.length) {
    return `No drafts found for season **${season}**${narrowLeagueId ? ` in league \`${narrowLeagueId}\`` : ""}.`;
  }

  const active = drafts.filter((d) => d.status === "drafting");
  const blocks: string[] = [];
  blocks.push(`**Draft status** · season ${season}`);
  blocks.push(...statusBreakdownLines(drafts));

  if (active.length) {
    blocks.push("");
    blocks.push(`**Active drafts (${active.length})**`);
    for (const d of active) {
      let leagueName = d.league_id;
      try {
        const lg = await sleeper.getLeague(d.league_id);
        leagueName = lg.name;
      } catch {
        /* */
      }
      blocks.push("");
      blocks.push(...(await linesForDraft(leagueName, d.draft_id, d.league_id, sleeperUserId)));
    }
  }
  return blocks.join("\n");
}

export async function buildDraftStatusDmPages(
  sleeperUserId: string,
  narrowLeagueId: string | null,
  activePerPage = 4,
): Promise<string[]> {
  const state = await sleeper.getNflState();
  const season = state.league_season ?? state.season;
  let drafts = await sleeper.getUserDrafts(sleeperUserId, season);

  if (narrowLeagueId?.trim()) {
    const lid = narrowLeagueId.trim();
    const userLeagues = await sleeper.getUserLeagues(sleeperUserId, season);
    if (!userLeagues.some((l) => l.league_id === lid)) {
      return [`You are not in league \`${lid}\` for season **${season}**. Use \`/leagues\` for ids.`];
    }
    drafts = drafts.filter((d) => d.league_id === lid);
  }
  if (!drafts.length) {
    return [`No drafts found for season **${season}**${narrowLeagueId ? ` in league \`${narrowLeagueId}\`` : ""}.`];
  }

  const active = drafts.filter((d) => d.status === "drafting");
  const header = [`**Draft status** · season ${season}`, ...statusBreakdownLines(drafts)];
  if (!active.length) return [header.join("\n")];

  const activeBlocks = await buildActiveDraftBlocks(active, sleeperUserId);
  const pages: string[] = [];
  const groups = chunk(activeBlocks, activePerPage);
  groups.forEach((group, idx) => {
    const lines: string[] = [];
    if (idx === 0) lines.push(...header, "");
    lines.push(`**Active drafts (${active.length}) · page ${idx + 1}/${groups.length}**`, "");
    for (let i = 0; i < group.length; i += 1) {
      lines.push(...group[i]);
      if (i < group.length - 1) lines.push("");
    }
    pages.push(lines.join("\n"));
  });
  return pages;
}

export async function buildDraftStatusGuild(
  sleeperUserId: string,
  leagueId: string,
  opts?: { allowNonMember?: boolean },
): Promise<string> {
  const state = await sleeper.getNflState();
  const season = state.league_season ?? state.season;
  const userLeagues = await sleeper.getUserLeagues(sleeperUserId, season);
  const inLeague = userLeagues.some((l) => l.league_id === leagueId);
  if (!inLeague && !opts?.allowNonMember) {
    return `You are not in league \`${leagueId}\` for season **${season}**. Use \`/leagues\` for ids.`;
  }

  let leagueName = leagueId;
  try {
    const lg = await sleeper.getLeague(leagueId);
    leagueName = lg.name;
  } catch {
    return `League \`${leagueId}\` not found on Sleeper.`;
  }

  const drafts = await getLeagueDrafts(leagueId);
  if (!drafts.length) {
    return `**${leagueName}** — no drafts found.`;
  }
  const active = drafts.filter((d) => d.status === "drafting");
  const blocks: string[] = [];
  blocks.push(`**Draft status** · **${leagueName}**`);
  blocks.push(...statusBreakdownLines(drafts));
  if (active.length) {
    blocks.push("");
    blocks.push(`**Active drafts (${active.length})**`);
    for (const d of active) {
      blocks.push("");
      blocks.push(...(await linesForDraft(leagueName, d.draft_id, leagueId, sleeperUserId)));
    }
  }
  return blocks.join("\n");
}

export async function buildDraftStatusGuildPages(
  sleeperUserId: string,
  leagueId: string,
  opts?: { allowNonMember?: boolean; activePerPage?: number },
): Promise<string[]> {
  const state = await sleeper.getNflState();
  const season = state.league_season ?? state.season;
  const userLeagues = await sleeper.getUserLeagues(sleeperUserId, season);
  const inLeague = userLeagues.some((l) => l.league_id === leagueId);
  if (!inLeague && !opts?.allowNonMember) {
    return [`You are not in league \`${leagueId}\` for season **${season}**. Use \`/leagues\` for ids.`];
  }
  let leagueName = leagueId;
  try {
    const lg = await sleeper.getLeague(leagueId);
    leagueName = lg.name;
  } catch {
    return [`League \`${leagueId}\` not found on Sleeper.`];
  }
  const drafts = await getLeagueDrafts(leagueId);
  if (!drafts.length) return [`**${leagueName}** — no drafts found.`];

  const active = drafts.filter((d) => d.status === "drafting");
  const header = [`**Draft status** · **${leagueName}**`, ...statusBreakdownLines(drafts)];
  if (!active.length) return [header.join("\n")];

  const activeBlocks = await buildActiveDraftBlocks(active, sleeperUserId);
  const pages: string[] = [];
  const groups = chunk(activeBlocks, opts?.activePerPage ?? 4);
  groups.forEach((group, idx) => {
    const lines: string[] = [];
    if (idx === 0) lines.push(...header, "");
    lines.push(`**Active drafts (${active.length}) · page ${idx + 1}/${groups.length}**`, "");
    for (let i = 0; i < group.length; i += 1) {
      lines.push(...group[i]);
      if (i < group.length - 1) lines.push("");
    }
    pages.push(lines.join("\n"));
  });
  return pages;
}

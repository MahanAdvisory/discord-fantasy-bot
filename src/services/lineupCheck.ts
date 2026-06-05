import { prisma } from "../db.js";
import { ALL_LEAGUES_SCOPE, LINEUP_MONITOR_SUBSCRIPTION_CATEGORIES } from "../domain/notifications.js";
import { getLeague, getLeagueRosters, getNflState, getUserLeagues } from "../sleeper/client.js";
import { findRosterForUser } from "../sleeper/rosterOwnership.js";
import { fetchWeeklyProjections } from "../sleeper/projections.js";
import { sleeperLeagueTeamUrl } from "./notifications/links.js";
import { fetchAllNflPlayers } from "../sleeper/playersFull.js";

type ProjectionMap = Map<string, number>;
let fullPlayerCache: Record<string, unknown> | null = null;
let projectionCache: ProjectionMap | null = null;

function playerNameFromCatalog(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { first_name?: string; last_name?: string; full_name?: string; position?: string; team?: string };
  const name = d.full_name?.trim() || `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim();
  if (!name) return null;
  const pos = d.position?.trim();
  const team = d.team?.trim();
  if (pos && team) return `${name} (${pos}, ${team})`;
  if (pos) return `${name} (${pos})`;
  return name;
}

function projFromRow(row: Record<string, unknown>): number {
  const direct =
    (typeof row.pts_ppr === "number" ? row.pts_ppr : null) ??
    (typeof row.pts_half_ppr === "number" ? row.pts_half_ppr : null) ??
    (typeof row.pts_std === "number" ? row.pts_std : null) ??
    (typeof row.fantasy_points === "number" ? row.fantasy_points : null);
  if (direct != null) return direct;
  const stats = row.stats;
  if (stats && typeof stats === "object") {
    const val =
      (stats as Record<string, unknown>).pts_ppr ??
      (stats as Record<string, unknown>).pts_half_ppr ??
      (stats as Record<string, unknown>).pts_std;
    if (typeof val === "number") return val;
  }
  return 0;
}

export async function loadProjectionMap(): Promise<ProjectionMap> {
  if (projectionCache) return projectionCache;
  const nfl = await getNflState();
  const season = nfl.league_season ?? nfl.season;
  const week = Math.max(1, nfl.display_week ?? nfl.week ?? 1);
  const rows = await fetchWeeklyProjections(season, week, "regular").catch(() => []);
  const map: ProjectionMap = new Map();
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    const id = typeof row.player_id === "string" ? row.player_id : null;
    if (!id) continue;
    map.set(id, projFromRow(row));
  }
  projectionCache = map;
  return map;
}

export async function loadPlayerLabels(playerIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(playerIds)];
  const rows = ids.length
    ? await prisma.sleeperPlayer.findMany({
        where: { playerId: { in: ids } },
        select: { playerId: true, data: true },
      })
    : [];
  const out = new Map<string, string>();
  for (const r of rows) {
    const name = playerNameFromCatalog(r.data);
    if (name) out.set(r.playerId, name);
  }
  const missing = ids.filter((id) => !out.has(id));
  if (missing.length) {
    if (!fullPlayerCache) fullPlayerCache = await fetchAllNflPlayers().catch(() => ({}));
    for (const id of missing) {
      const label = playerNameFromCatalog(fullPlayerCache?.[id]);
      if (label) out.set(id, label);
    }
  }
  return out;
}

function isIrStatus(status: string | null): boolean {
  if (!status) return false;
  const s = status.trim().toUpperCase();
  return s === "IR";
}

export function normalizePos(pos: string | null | undefined): string {
  if (!pos) return "";
  return pos.trim().toUpperCase();
}

/** Normalize Sleeper league roster slot id (e.g. SUPER_FLEX, SUPER FLEX). */
export function normalizeRosterSlot(slot: string): string {
  return slot.trim().toUpperCase().replace(/\s+/g, "_");
}

const OFFENSE_FLEX = new Set(["RB", "WR", "TE"]);
const SUPER_FLEX_POS = new Set(["QB", "RB", "WR", "TE"]);
const IDP_DL = new Set(["DL", "DE", "DT"]);
const IDP_DB = new Set(["DB", "CB", "S", "SAF", "SS", "FS"]);

/** Whether a player's NFL `position` can fill this league lineup slot. */
export function playerEligibleForRosterSlot(slotRaw: string, playerPosRaw: string | null | undefined): boolean {
  const s = normalizeRosterSlot(slotRaw);
  const playerPos = normalizePos(playerPosRaw);
  if (!playerPos) return false;

  if (s === "QB") return playerPos === "QB";
  if (s === "RB") return playerPos === "RB";
  if (s === "WR") return playerPos === "WR";
  if (s === "TE") return playerPos === "TE";
  if (s === "K") return playerPos === "K";
  if (s === "DEF" || s === "D/ST" || s === "DST" || s === "DEFENSE") {
    return playerPos === "DEF" || playerPos === "DST";
  }
  if (s === "FLEX") return OFFENSE_FLEX.has(playerPos);
  if (s === "SUPER_FLEX" || s === "SUPERFLEX" || s === "S_FLEX" || s === "SFLEX") {
    return SUPER_FLEX_POS.has(playerPos);
  }
  if (s === "WRRB_FLEX" || s === "WR_RB_FLEX") return playerPos === "WR" || playerPos === "RB";
  if (s === "REC_FLEX" || s === "WR_TE_FLEX") return playerPos === "WR" || playerPos === "TE";
  if (s === "DL") return IDP_DL.has(playerPos);
  if (s === "LB") return playerPos === "LB";
  if (s === "DB") return IDP_DB.has(playerPos);
  if (s === "IDP_FLEX" || s === "IDP") {
    return IDP_DL.has(playerPos) || playerPos === "LB" || IDP_DB.has(playerPos);
  }
  // Unknown / future Sleeper slot ids — allow so we still suggest someone.
  return true;
}

export type IrSlotSuggestion = { slot: string; playerLabel: string; proj: number | null };

export type LineupCheckOutcome =
  | { kind: "ok"; leagueId: string; leagueName: string }
  | { kind: "issues"; leagueId: string; leagueName: string; issues: string[]; suggestions: IrSlotSuggestion[] }
  | { kind: "problem"; leagueId: string; leagueName: string; detail: string };

function formatLineupIssueBlock(leagueName: string, issues: string[], suggestions: IrSlotSuggestion[], leagueId: string): string {
  const sugLines = suggestions.map((s) => {
    const projSuffix = s.proj != null ? ` (proj: ${s.proj.toFixed(2)})` : "";
    return `· **[${s.slot}]** ${s.playerLabel}${projSuffix}`;
  });
  const sugBlock =
    suggestions.length === 1
      ? `Suggested replacement: **[${suggestions[0].slot}]** ${suggestions[0].playerLabel}${
          suggestions[0].proj != null ? ` (proj: ${suggestions[0].proj.toFixed(2)})` : ""
        }`
      : `Suggested replacements:\n${sugLines.join("\n")}`;
  return (
    `**${leagueName}** lineup check\n` +
    `Issues:\n${issues.map((x) => `· ${x}`).join("\n")}\n` +
    `${sugBlock}\n` +
    `${sleeperLeagueTeamUrl(leagueId)}`
  );
}

export async function loadPlayerPositions(playerIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(playerIds)];
  const rows = ids.length
    ? await prisma.sleeperPlayer.findMany({
        where: { playerId: { in: ids } },
        select: { playerId: true, data: true },
      })
    : [];
  const out = new Map<string, string>();
  for (const r of rows) {
    const data = r.data as { position?: string } | null;
    const p = data?.position?.trim();
    if (p) out.set(r.playerId, p);
  }
  const missing = ids.filter((id) => !out.has(id));
  if (missing.length) {
    if (!fullPlayerCache) fullPlayerCache = await fetchAllNflPlayers().catch(() => ({}));
    for (const id of missing) {
      const data = fullPlayerCache?.[id] as { position?: string } | undefined;
      const p = data?.position?.trim();
      if (p) out.set(id, p);
    }
  }
  return out;
}

export async function loadPlayerTeams(playerIds: string[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(playerIds)];
  const rows = ids.length
    ? await prisma.sleeperPlayer.findMany({
        where: { playerId: { in: ids } },
        select: { playerId: true, data: true },
      })
    : [];
  const out = new Map<string, string | null>();
  for (const r of rows) {
    const data = r.data as { team?: string } | null;
    out.set(r.playerId, typeof data?.team === "string" && data.team.trim() ? data.team.trim() : null);
  }
  const missing = ids.filter((id) => !out.has(id));
  if (missing.length) {
    if (!fullPlayerCache) fullPlayerCache = await fetchAllNflPlayers().catch(() => ({}));
    for (const id of missing) {
      const data = fullPlayerCache?.[id] as { team?: string } | undefined;
      out.set(id, typeof data?.team === "string" && data.team.trim() ? data.team.trim() : null);
    }
  }
  return out;
}

function buildFlaggedSlotSuggestions(opts: {
  starters: string[];
  flaggedStarterIdxs: number[];
  rosterPositions: string[] | null | undefined;
  bench: string[];
  projections: ProjectionMap;
  labels: Map<string, string>;
  positions: Map<string, string>;
  teams: Map<string, string | null>;
}): IrSlotSuggestion[] {
  const { starters, flaggedStarterIdxs, rosterPositions, bench, projections, labels, positions, teams } = opts;
  const assignedBench = new Set<string>();
  const suggestions: IrSlotSuggestion[] = [];

  for (const i of flaggedStarterIdxs) {
    const slotRaw = rosterPositions?.[i]?.trim() || "?";
    const candidates = bench
      .filter(
        (bid) =>
          !assignedBench.has(bid) &&
          Boolean(teams.get(bid)) &&
          playerEligibleForRosterSlot(slotRaw, positions.get(bid)),
      )
      .map((bid) => ({ bid, proj: projections.get(bid) ?? 0 }))
      .sort((a, b) => b.proj - a.proj);

    const best = candidates[0];
    if (best) {
      assignedBench.add(best.bid);
      suggestions.push({
        slot: slotRaw,
        playerLabel: labels.get(best.bid) ?? `\`${best.bid}\``,
        proj: best.proj,
      });
    } else {
      suggestions.push({
        slot: slotRaw,
        playerLabel: `none eligible on bench for **${slotRaw}**`,
        proj: null,
      });
    }
  }

  return suggestions;
}

export async function analyzeLineupForLeague(
  sleeperUserId: string,
  leagueId: string,
  opts?: { projections?: ProjectionMap },
): Promise<LineupCheckOutcome> {
  const league = await getLeague(leagueId).catch(() => null);
  if (!league) {
    return { kind: "problem", leagueId, leagueName: leagueId, detail: `League \`${leagueId}\` not found on Sleeper.` };
  }
  const rosters = await getLeagueRosters(leagueId).catch(() => []);
  const roster = findRosterForUser(rosters, sleeperUserId);
  if (!roster) {
    return {
      kind: "problem",
      leagueId,
      leagueName: league.name,
      detail: `You do not appear to have a roster in **${league.name}**.`,
    };
  }

  const starters = (roster.starters ?? []).filter((p): p is string => typeof p === "string" && p.length > 0);
  if (!starters.length) {
    return {
      kind: "problem",
      leagueId,
      leagueName: league.name,
      detail: `No starters configured yet for **${league.name}**.`,
    };
  }
  const allPlayers = (roster.players ?? []).filter((p): p is string => typeof p === "string" && p.length > 0);
  const starterSet = new Set(starters);
  const bench = allPlayers.filter((p) => !starterSet.has(p));
  const labels = await loadPlayerLabels([...starters, ...bench]);
  const starterIds = starters.filter((pid) => pid !== "0");
  const playerRows = await prisma.sleeperPlayer.findMany({
    where: { playerId: { in: starterIds } },
    select: { playerId: true, data: true },
  });
  const statusByPlayer = new Map<string, string | null>();
  const teamByPlayer = new Map<string, string | null>();
  for (const p of playerRows) {
    const data = p.data as { injury_status?: string; team?: string } | null;
    statusByPlayer.set(p.playerId, data?.injury_status ?? null);
    teamByPlayer.set(p.playerId, typeof data?.team === "string" && data.team.trim() ? data.team.trim() : null);
  }
  const unresolved = starterIds.filter((pid) => statusByPlayer.get(pid) == null || !teamByPlayer.has(pid));
  if (unresolved.length) {
    if (!fullPlayerCache) fullPlayerCache = await fetchAllNflPlayers().catch(() => ({}));
    for (const pid of unresolved) {
      const data = fullPlayerCache?.[pid] as { injury_status?: string; team?: string } | undefined;
      statusByPlayer.set(pid, data?.injury_status ?? null);
      teamByPlayer.set(pid, typeof data?.team === "string" && data.team.trim() ? data.team.trim() : null);
    }
  }

  const flaggedStarterIdxs: number[] = [];
  const issues: string[] = [];
  for (let i = 0; i < starters.length; i++) {
    const pid = starters[i];
    const slot = league.roster_positions?.[i]?.trim() || `slot ${i + 1}`;
    if (pid === "0") {
      flaggedStarterIdxs.push(i);
      issues.push(`Empty starter slot (${slot}).`);
      continue;
    }
    if (isIrStatus(statusByPlayer.get(pid) ?? null)) {
      flaggedStarterIdxs.push(i);
      issues.push(`Starter on IR: ${labels.get(pid) ?? `\`${pid}\``}.`);
    }
    if (!teamByPlayer.get(pid)) {
      if (!flaggedStarterIdxs.includes(i)) flaggedStarterIdxs.push(i);
      issues.push(`Starter has no NFL team: ${labels.get(pid) ?? `\`${pid}\``}.`);
    }
  }
  if (!flaggedStarterIdxs.length) {
    return { kind: "ok", leagueId, leagueName: league.name };
  }

  const projections = opts?.projections ?? (await loadProjectionMap());
  const positions = await loadPlayerPositions([...starters, ...bench]);
  const teams = await loadPlayerTeams([...starters, ...bench]);
  const suggestions = buildFlaggedSlotSuggestions({
    starters,
    flaggedStarterIdxs,
    rosterPositions: league.roster_positions,
    bench,
    projections,
    labels,
    positions,
    teams,
  });

  return {
    kind: "issues",
    leagueId,
    leagueName: league.name,
    issues,
    suggestions,
  };
}

export function outcomeToCheckLineupMessage(outcome: LineupCheckOutcome): string {
  if (outcome.kind === "ok") {
    return `**${outcome.leagueName}** lineup check: no IR players found in your starters.\n${sleeperLeagueTeamUrl(outcome.leagueId)}`;
  }
  if (outcome.kind === "problem") {
    return `${outcome.detail}\n${sleeperLeagueTeamUrl(outcome.leagueId)}`;
  }
  return formatLineupIssueBlock(outcome.leagueName, outcome.issues, outcome.suggestions, outcome.leagueId);
}

/** @deprecated Prefer analyzeLineupForLeague + outcomeToCheckLineupMessage for new code. */
export async function buildCheckLineupMessage(
  sleeperUserId: string,
  leagueId: string,
  opts?: { projections?: ProjectionMap },
): Promise<string> {
  const outcome = await analyzeLineupForLeague(sleeperUserId, leagueId, opts);
  return outcomeToCheckLineupMessage(outcome);
}

export const LINEUP_CHECK_ISSUES_PER_MESSAGE = 4;

export type LineupCheckIssueEntry = { text: string };

export async function runLineupCheckAcrossLeagues(
  sleeperUserId: string,
  leagueIds: string[],
): Promise<{
  evaluated: number;
  noIssues: number;
  issueEntries: LineupCheckIssueEntry[];
}> {
  const uniq = [...new Set(leagueIds)];
  const projections = await loadProjectionMap();
  let noIssues = 0;
  const issueEntries: LineupCheckIssueEntry[] = [];

  for (const lid of uniq) {
    const outcome = await analyzeLineupForLeague(sleeperUserId, lid, { projections });
    if (outcome.kind === "ok") {
      noIssues += 1;
      continue;
    }
    if (outcome.kind === "issues") {
      issueEntries.push({
        text: formatLineupIssueBlock(outcome.leagueName, outcome.issues, outcome.suggestions, outcome.leagueId),
      });
      continue;
    }
    issueEntries.push({
      text: `**${outcome.leagueName}**\n${outcome.detail}\n${sleeperLeagueTeamUrl(outcome.leagueId)}`,
    });
  }

  return { evaluated: uniq.length, noIssues, issueEntries };
}

/** Build paginated message bodies for /check-lineup (summary-only when there are zero issues). */
export function buildCheckLineupSlashPages(report: {
  evaluated: number;
  noIssues: number;
  issueEntries: LineupCheckIssueEntry[];
  issuesPerPage?: number;
}): string[] {
  const { evaluated, noIssues, issueEntries } = report;
  const perPage = report.issuesPerPage ?? LINEUP_CHECK_ISSUES_PER_MESSAGE;

  if (!issueEntries.length) {
    return [`Teams evaluated: ${evaluated}. Teams with no issues: ${noIssues}.`];
  }

  const pages = Math.ceil(issueEntries.length / perPage);
  const out: string[] = [];
  for (let p = 0; p < pages; p++) {
    const slice = issueEntries.slice(p * perPage, (p + 1) * perPage);
    const head =
      `Teams evaluated: ${evaluated}. Teams with no issues: ${noIssues}\n` +
      `Teams with issues (${issueEntries.length}) · page ${p + 1}/${pages}`;
    out.push(`${head}\n\n${slice.map((e) => e.text).join("\n\n")}`);
  }
  return out;
}

export async function resolveLineupLeagueIdsForUser(opts: {
  userId: string;
  sleeperUserId: string;
  isDm: boolean;
  guildId: string | null;
  channelId: string | null;
}): Promise<{ leagueIds: string[]; ambiguous: string[] }> {
  const rows = await prisma.notificationSubscription.findMany({
    where: {
      userId: opts.userId,
      category: { in: [...LINEUP_MONITOR_SUBSCRIPTION_CATEGORIES] },
      isDm: opts.isDm,
      ...(opts.isDm
        ? {}
        : {
            guildId: opts.guildId ?? undefined,
            channelId: opts.channelId ?? undefined,
          }),
    },
    select: { sleeperLeagueScope: true },
  });

  const scopes = [...new Set(rows.map((r) => r.sleeperLeagueScope))];
  if (!scopes.length) return { leagueIds: [], ambiguous: [] };

  if (!opts.isDm) {
    const concrete = scopes.filter((s) => s !== ALL_LEAGUES_SCOPE);
    if (concrete.length > 1) return { leagueIds: [], ambiguous: concrete };
  }

  const nfl = await getNflState();
  const season = nfl.league_season ?? nfl.season;

  const leagueIds: string[] = [];
  for (const scope of scopes) {
    if (scope === ALL_LEAGUES_SCOPE) {
      const leagues = await getUserLeagues(opts.sleeperUserId, season);
      leagueIds.push(...leagues.map((l) => l.league_id));
    } else {
      leagueIds.push(scope);
    }
  }

  return { leagueIds: [...new Set(leagueIds)], ambiguous: [] };
}

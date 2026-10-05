import { prisma } from "../db.js";
import { ALL_LEAGUES_SCOPE, LINEUP_MONITOR_SUBSCRIPTION_CATEGORIES } from "../domain/notifications.js";
import { getLeague, getLeagueRosters, getNflState, getUserLeagues, isSleeperBestBallLeague } from "../sleeper/client.js";
import { findRosterForUser } from "../sleeper/rosterOwnership.js";
import { preferredProjectionPoints } from "../sleeper/projections.js";
import { sleeperLeagueTeamUrl } from "./notifications/links.js";
import { sleeperLeagueTeamUrlPlain } from "../domain/sleeperLinks.js";
import { fetchAllNflPlayers, nflTeamFromPlayerData } from "../sleeper/playersFull.js";

export type ProjectionMap = Map<string, number>;
let fullPlayerCache: Record<string, unknown> | null = null;
let fullPlayerCacheAt = 0;
let projectionCache: { key: string; at: number; map: ProjectionMap } | null = null;
const FULL_PLAYER_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const PROJECTION_CACHE_TTL_MS = 10 * 60 * 1000;
/** Ignore tiny ranking noise; 0.5 PPR is enough to bother swapping. */
export const PROJECTION_UPGRADE_MIN_DELTA = 0.5;

const NON_START_SLOTS = new Set(["BN", "BENCH", "IR", "TAXI", "RESERVE"]);

async function loadFullPlayerCache(): Promise<Record<string, unknown>> {
  if (fullPlayerCache && Date.now() - fullPlayerCacheAt < FULL_PLAYER_CACHE_TTL_MS) {
    return fullPlayerCache;
  }
  fullPlayerCache = await fetchAllNflPlayers().catch(() => ({}));
  fullPlayerCacheAt = Date.now();
  return fullPlayerCache;
}

function playerNameFromCatalog(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { first_name?: string; last_name?: string; full_name?: string; position?: string; team?: string };
  const name = d.full_name?.trim() || `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim();
  if (!name) return null;
  const pos = d.position?.trim();
  const team = nflTeamFromPlayerData(data);
  if (pos && team) return `${name} (${pos}, ${team})`;
  if (pos) return `${name} (${pos})`;
  return name;
}

export async function loadProjectionMap(): Promise<ProjectionMap> {
  const nfl = await getNflState();
  const season = String(nfl.league_season ?? nfl.season);
  const week = Math.max(1, nfl.display_week ?? nfl.week ?? 1);
  const seasonType = "regular";
  const key = `${season}:${week}:${seasonType}`;
  if (
    projectionCache &&
    projectionCache.key === key &&
    Date.now() - projectionCache.at < PROJECTION_CACHE_TTL_MS
  ) {
    return projectionCache.map;
  }

  const select = { playerId: true, ptsPpr: true, ptsHalfPpr: true, ptsStd: true } as const;
  const rows = await prisma.sleeperPlayerProjection.findMany({
    where: { season, week, seasonType },
    select,
  });

  const map: ProjectionMap = new Map();
  for (const r of rows) {
    map.set(
      r.playerId,
      preferredProjectionPoints({
        ptsPpr: r.ptsPpr,
        ptsHalfPpr: r.ptsHalfPpr,
        ptsStd: r.ptsStd,
      }),
    );
  }
  projectionCache = { key, at: Date.now(), map };
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
    const live = await loadFullPlayerCache();
    for (const id of missing) {
      const label = playerNameFromCatalog(live[id]);
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

export function isStartableRosterSlot(slotRaw: string): boolean {
  const s = normalizeRosterSlot(slotRaw);
  return Boolean(s) && !NON_START_SLOTS.has(s);
}

export type ProjectionUpgrade = {
  slot: string;
  starterId: string;
  benchId: string;
  starterProj: number;
  benchProj: number;
};

/** Greedy: assign each unused bench player to the eligible starter slot with the largest positive delta. */
export function findProjectionUpgrades(opts: {
  starters: string[];
  rosterPositions: string[] | null | undefined;
  bench: string[];
  projections: ProjectionMap;
  positions: Map<string, string>;
  teams: Map<string, string | null>;
  skipStarterIdxs?: Iterable<number>;
  skipBenchIds?: Iterable<string>;
  minDelta?: number;
}): ProjectionUpgrade[] {
  const minDelta = opts.minDelta ?? PROJECTION_UPGRADE_MIN_DELTA;
  const skipIdx = new Set(opts.skipStarterIdxs ?? []);
  const skipBench = new Set(opts.skipBenchIds ?? []);
  const candidates: Array<ProjectionUpgrade & { starterIdx: number; delta: number }> = [];

  for (let i = 0; i < opts.starters.length; i++) {
    if (skipIdx.has(i)) continue;
    const starterId = opts.starters[i];
    if (!starterId || starterId === "0") continue;
    const slotRaw = opts.rosterPositions?.[i]?.trim() || "";
    if (!isStartableRosterSlot(slotRaw)) continue;
    if (!opts.teams.get(starterId)) continue;
    const starterProj = opts.projections.get(starterId) ?? 0;

    for (const benchId of opts.bench) {
      if (!benchId || skipBench.has(benchId)) continue;
      if (!opts.teams.get(benchId)) continue;
      if (!playerEligibleForRosterSlot(slotRaw, opts.positions.get(benchId))) continue;
      const benchProj = opts.projections.get(benchId) ?? 0;
      const delta = benchProj - starterProj;
      if (delta < minDelta) continue;
      candidates.push({
        slot: slotRaw,
        starterId,
        benchId,
        starterProj,
        benchProj,
        starterIdx: i,
        delta,
      });
    }
  }

  candidates.sort((a, b) => b.delta - a.delta || b.benchProj - a.benchProj);
  const usedStarters = new Set<number>();
  const usedBench = new Set<string>();
  const out: ProjectionUpgrade[] = [];
  for (const c of candidates) {
    if (usedStarters.has(c.starterIdx) || usedBench.has(c.benchId)) continue;
    usedStarters.add(c.starterIdx);
    usedBench.add(c.benchId);
    out.push({
      slot: c.slot,
      starterId: c.starterId,
      benchId: c.benchId,
      starterProj: c.starterProj,
      benchProj: c.benchProj,
    });
  }
  return out;
}

export type IrSlotSuggestion = { slot: string; playerLabel: string; proj: number | null };

export type LineupUpgradeView = {
  slot: string;
  sitLabel: string;
  sitProj: number;
  startLabel: string;
  startProj: number;
};

export type LineupCheckOutcome =
  | { kind: "ok"; leagueId: string; leagueName: string; ignored?: "best_ball" }
  | {
      kind: "issues";
      leagueId: string;
      leagueName: string;
      issues: string[];
      suggestions: IrSlotSuggestion[];
      upgrades: LineupUpgradeView[];
    }
  | { kind: "problem"; leagueId: string; leagueName: string; detail: string };

function formatLineupIssueBlock(
  leagueName: string,
  issues: string[],
  suggestions: IrSlotSuggestion[],
  leagueId: string,
): string {
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

function formatUpgradeBlock(leagueName: string, upgrades: LineupUpgradeView[], leagueId: string): string {
  const lines = upgrades.map(
    (u) =>
      `· Sit **${u.sitLabel}** (${u.sitProj.toFixed(1)}) in **${u.slot}**; start **${u.startLabel}** (${u.startProj.toFixed(1)}).`,
  );
  return (
    `**${leagueName}** projected upgrades\n` +
    `${lines.join("\n")}\n` +
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
    const live = await loadFullPlayerCache();
    for (const id of missing) {
      const data = live[id] as { position?: string } | undefined;
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
    out.set(r.playerId, nflTeamFromPlayerData(r.data));
  }
  const missing = ids.filter((id) => !out.get(id));
  if (missing.length) {
    const live = await loadFullPlayerCache();
    for (const id of missing) {
      out.set(id, nflTeamFromPlayerData(live[id]));
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
}): { suggestions: IrSlotSuggestion[]; assignedBench: Set<string> } {
  const { flaggedStarterIdxs, rosterPositions, bench, projections, labels, positions, teams } = opts;
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

  return { suggestions, assignedBench };
}

export async function analyzeLineupForLeague(
  sleeperUserId: string,
  leagueId: string,
  opts?: { projections?: ProjectionMap; includeProjectionUpgrades?: boolean },
): Promise<LineupCheckOutcome> {
  const league = await getLeague(leagueId).catch(() => null);
  if (!league) {
    return { kind: "problem", leagueId, leagueName: leagueId, detail: `League \`${leagueId}\` not found on Sleeper.` };
  }
  if (isSleeperBestBallLeague(league)) {
    return { kind: "ok", leagueId, leagueName: league.name, ignored: "best_ball" };
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
  const reserveTaxi = new Set(
    [...(roster.reserve ?? []), ...(roster.taxi ?? [])].filter((p): p is string => typeof p === "string" && p.length > 0),
  );
  const bench = allPlayers.filter((p) => !starterSet.has(p) && !reserveTaxi.has(p));
  const labels = await loadPlayerLabels([...starters, ...bench]);
  const starterIds = starters.filter((pid) => pid !== "0");
  const catalogIds = [...new Set([...starterIds, ...bench])];
  const playerRows = catalogIds.length
    ? await prisma.sleeperPlayer.findMany({
        where: { playerId: { in: catalogIds } },
        select: { playerId: true, data: true },
      })
    : [];
  const statusByPlayer = new Map<string, string | null>();
  const teamByPlayer = new Map<string, string | null>();
  for (const p of playerRows) {
    const data = p.data as { injury_status?: string } | null;
    statusByPlayer.set(p.playerId, data?.injury_status ?? null);
    teamByPlayer.set(p.playerId, nflTeamFromPlayerData(p.data));
  }
  const unresolved = catalogIds.filter((pid) => !teamByPlayer.get(pid) || statusByPlayer.get(pid) == null);
  if (unresolved.length) {
    const live = await loadFullPlayerCache();
    for (const pid of unresolved) {
      const data = live[pid] as { injury_status?: string } | undefined;
      if (data?.injury_status != null) statusByPlayer.set(pid, data.injury_status);
      const liveTeam = nflTeamFromPlayerData(live[pid]);
      if (liveTeam) teamByPlayer.set(pid, liveTeam);
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
  const wantUpgrades = Boolean(opts?.includeProjectionUpgrades);
  if (!flaggedStarterIdxs.length && !wantUpgrades) {
    return { kind: "ok", leagueId, leagueName: league.name };
  }

  const projections = opts?.projections ?? (await loadProjectionMap());
  const positions = await loadPlayerPositions([...starters, ...bench]);
  const teams = await loadPlayerTeams([...starters, ...bench]);
  const fill = flaggedStarterIdxs.length
    ? buildFlaggedSlotSuggestions({
        starters,
        flaggedStarterIdxs,
        rosterPositions: league.roster_positions,
        bench,
        projections,
        labels,
        positions,
        teams,
      })
    : { suggestions: [] as IrSlotSuggestion[], assignedBench: new Set<string>() };
  const suggestions = fill.suggestions;

  let upgrades: LineupUpgradeView[] = [];
  if (wantUpgrades) {
    const healthyBench = bench.filter((id) => !isIrStatus(statusByPlayer.get(id) ?? null));
    const raw = findProjectionUpgrades({
      starters,
      rosterPositions: league.roster_positions,
      bench: healthyBench,
      projections,
      positions,
      teams,
      skipStarterIdxs: flaggedStarterIdxs,
      skipBenchIds: fill.assignedBench,
    });
    upgrades = raw.map((u) => ({
      slot: u.slot,
      sitLabel: labels.get(u.starterId) ?? `\`${u.starterId}\``,
      sitProj: u.starterProj,
      startLabel: labels.get(u.benchId) ?? `\`${u.benchId}\``,
      startProj: u.benchProj,
    }));
  }

  if (!issues.length && !upgrades.length) {
    return { kind: "ok", leagueId, leagueName: league.name };
  }

  return {
    kind: "issues",
    leagueId,
    leagueName: league.name,
    issues,
    suggestions,
    upgrades,
  };
}

export function outcomeToCheckLineupMessage(outcome: LineupCheckOutcome): string {
  if (outcome.kind === "ok") {
    return `**${outcome.leagueName}** lineup check: no IR players found in your starters.\n${sleeperLeagueTeamUrl(outcome.leagueId)}`;
  }
  if (outcome.kind === "problem") {
    return `${outcome.detail}\n${sleeperLeagueTeamUrl(outcome.leagueId)}`;
  }
  const irBlock = outcome.issues.length
    ? formatLineupIssueBlock(outcome.leagueName, outcome.issues, outcome.suggestions, outcome.leagueId)
    : "";
  const upgradeBlock = outcome.upgrades.length
    ? formatUpgradeBlock(outcome.leagueName, outcome.upgrades, outcome.leagueId)
    : "";
  return [irBlock, upgradeBlock].filter(Boolean).join("\n\n");
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

export type LineupCheckIssueEntry = { text: string; kind: "injury" | "upgrade" | "problem" };

export type LineupUpgradeEntry = LineupUpgradeView & {
  leagueId: string;
  leagueName: string;
  lineupUrl: string;
};

export async function runLineupCheckAcrossLeagues(
  sleeperUserId: string,
  leagueIds: string[],
): Promise<{
  evaluated: number;
  noIssues: number;
  issueEntries: LineupCheckIssueEntry[];
  upgrades: LineupUpgradeEntry[];
}> {
  const uniq = [...new Set(leagueIds)];
  const projections = await loadProjectionMap();
  let evaluated = 0;
  let noIssues = 0;
  const issueEntries: LineupCheckIssueEntry[] = [];
  const upgrades: LineupUpgradeEntry[] = [];

  for (const lid of uniq) {
    const outcome = await analyzeLineupForLeague(sleeperUserId, lid, {
      projections,
      includeProjectionUpgrades: true,
    });
    if (outcome.kind === "ok" && outcome.ignored === "best_ball") {
      continue;
    }
    evaluated += 1;
    if (outcome.kind === "ok") {
      noIssues += 1;
      continue;
    }
    if (outcome.kind === "issues") {
      if (outcome.issues.length) {
        issueEntries.push({
          kind: "injury",
          text: formatLineupIssueBlock(outcome.leagueName, outcome.issues, outcome.suggestions, outcome.leagueId),
        });
      }
      if (outcome.upgrades.length) {
        issueEntries.push({
          kind: "upgrade",
          text: formatUpgradeBlock(outcome.leagueName, outcome.upgrades, outcome.leagueId),
        });
        const lineupUrl = sleeperLeagueTeamUrlPlain(outcome.leagueId);
        for (const u of outcome.upgrades) {
          upgrades.push({
            ...u,
            leagueId: outcome.leagueId,
            leagueName: outcome.leagueName,
            lineupUrl,
          });
        }
      }
      continue;
    }
    issueEntries.push({
      kind: "problem",
      text: `**${outcome.leagueName}**\n${outcome.detail}\n${sleeperLeagueTeamUrl(outcome.leagueId)}`,
    });
  }

  return { evaluated, noIssues, issueEntries, upgrades };
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

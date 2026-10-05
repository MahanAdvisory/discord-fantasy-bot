import { getLeague, getLeagueRosters, isSleeperBestBallLeague, type NflState } from "../sleeper/client.js";
import { findRosterForUser } from "../sleeper/rosterOwnership.js";
import {
  formatKickoffEt,
  getTeamKickoffMsForNflWeek,
  kickoffMsForPlayerTeam,
} from "../nfl/espnKickoff.js";
import { loadPlayerLabels, loadPlayerPositions, loadPlayerTeams, normalizePos, normalizeRosterSlot } from "./lineupCheck.js";
import { sleeperLeagueTeamUrl } from "./notifications/links.js";

function isSuperFlexSlot(slotRaw: string): boolean {
  const s = normalizeRosterSlot(slotRaw);
  return s === "SUPER_FLEX" || s === "SUPERFLEX" || s === "S_FLEX" || s === "SFLEX";
}

function isFlexSlot(slotRaw: string): boolean {
  return normalizeRosterSlot(slotRaw) === "FLEX";
}

export type FlexSwapRecommendation = {
  leagueId: string;
  leagueName: string;
  flexSlotLabel: string;
  dedicatedSlotLabel: string;
  flexPlayerLabel: string;
  dedicatedPlayerLabel: string;
  flexKickoffEt: string;
  dedicatedKickoffEt: string;
};

export function formatFlexSwapBlock(rec: FlexSwapRecommendation): string {
  return (
    `**${rec.leagueName}** flex / Superflex check\n` +
    `**Swap:** **[${rec.flexSlotLabel}]** ${rec.flexPlayerLabel} (${rec.flexKickoffEt}) plays before ` +
    `**[${rec.dedicatedSlotLabel}]** ${rec.dedicatedPlayerLabel} (${rec.dedicatedKickoffEt}). ` +
    `Move the **earlier** game into the dedicated slot and the **later** game into **${rec.flexSlotLabel}** in Sleeper.\n` +
    `${sleeperLeagueTeamUrl(rec.leagueId)}`
  );
}

export const FLEX_CHECK_ISSUES_PER_MESSAGE = 4;

export function buildFlexCheckSlashPages(report: {
  evaluated: number;
  noIssue: number;
  recommendations: FlexSwapRecommendation[];
  issuesPerPage?: number;
}): string[] {
  const { evaluated, noIssue, recommendations } = report;
  const perPage = report.issuesPerPage ?? FLEX_CHECK_ISSUES_PER_MESSAGE;

  if (!recommendations.length) {
    return [`Teams evaluated: ${evaluated}. Leagues with nothing to swap: ${noIssue}.`];
  }

  const pages = Math.ceil(recommendations.length / perPage);
  const out: string[] = [];
  for (let p = 0; p < pages; p++) {
    const slice = recommendations.slice(p * perPage, (p + 1) * perPage);
    const head =
      `Teams evaluated: ${evaluated}. Leagues with nothing to swap: ${noIssue}\n` +
      `Swap ideas (${recommendations.length}) · page ${p + 1}/${pages}`;
    out.push(`${head}\n\n${slice.map((r) => formatFlexSwapBlock(r)).join("\n\n")}`);
  }
  return out;
}

/**
 * When the flex/SF starter’s team kicks off before the same-position dedicated-slot starter,
 * recommend swapping so the early game sits in the “primary” dedicated slot.
 */
export async function analyzeFlexSwapsForLeague(
  sleeperUserId: string,
  leagueId: string,
  teamKickoffs: Map<string, number>,
  opts?: { leagueName?: string },
): Promise<FlexSwapRecommendation[]> {
  const league = await getLeague(leagueId).catch(() => null);
  if (!league) return [];
  if (isSleeperBestBallLeague(league)) return [];
  const leagueName = opts?.leagueName ?? league.name;
  const rosterPositions = league.roster_positions ?? [];
  if (!rosterPositions.length) return [];

  const rosters = await getLeagueRosters(leagueId).catch(() => []);
  const roster = findRosterForUser(rosters, sleeperUserId);
  if (!roster) return [];

  const starters = (roster.starters ?? []).filter((p): p is string => typeof p === "string" && p.length > 0);
  if (!starters.length) return [];

  const ids = [...new Set(starters)];
  const [positions, labels, teams] = await Promise.all([loadPlayerPositions(ids), loadPlayerLabels(ids), loadPlayerTeams(ids)]);

  const recs: FlexSwapRecommendation[] = [];
  const usedPairs = new Set<string>();

  const kick = (pid: string) => kickoffMsForPlayerTeam(teamKickoffs, teams.get(pid));

  for (let flexIdx = 0; flexIdx < starters.length; flexIdx++) {
    const slotRaw = rosterPositions[flexIdx]?.trim() ?? "";
    if (!isSuperFlexSlot(slotRaw) && !isFlexSlot(slotRaw)) continue;

    const flexPid = starters[flexIdx];
    if (!flexPid) continue;
    const flexPos = normalizePos(positions.get(flexPid));
    if (!flexPos) continue;

    const flexMs = kick(flexPid);
    if (flexMs == null) continue;

    /** Superflex: only QB vs QB slot pairing. */
    if (isSuperFlexSlot(slotRaw)) {
      if (flexPos !== "QB") continue;
      for (let qbIdx = 0; qbIdx < starters.length; qbIdx++) {
        if (qbIdx === flexIdx) continue;
        const qbSlot = rosterPositions[qbIdx]?.trim() ?? "";
        if (normalizeRosterSlot(qbSlot) !== "QB") continue;
        const qbPid = starters[qbIdx];
        if (!qbPid) continue;
        if (normalizePos(positions.get(qbPid)) !== "QB") continue;
        const qbMs = kick(qbPid);
        if (qbMs == null) continue;
        if (flexMs >= qbMs) continue;

        const key = `${Math.min(flexIdx, qbIdx)}-${Math.max(flexIdx, qbIdx)}`;
        if (usedPairs.has(key)) continue;
        usedPairs.add(key);

        recs.push({
          leagueId,
          leagueName,
          flexSlotLabel: slotRaw || "SUPER_FLEX",
          dedicatedSlotLabel: qbSlot || "QB",
          flexPlayerLabel: labels.get(flexPid) ?? flexPid,
          dedicatedPlayerLabel: labels.get(qbPid) ?? qbPid,
          flexKickoffEt: formatKickoffEt(flexMs),
          dedicatedKickoffEt: formatKickoffEt(qbMs),
        });
      }
      continue;
    }

    /** FLEX: same position as an RB / WR / TE dedicated slot. */
    if (!["RB", "WR", "TE"].includes(flexPos)) continue;

    let best: { idx: number; ms: number; slotLabel: string; pid: string } | null = null;
    for (let i = 0; i < starters.length; i++) {
      if (i === flexIdx) continue;
      const dedSlot = rosterPositions[i]?.trim() ?? "";
      if (normalizeRosterSlot(dedSlot) !== flexPos) continue;
      const dedPid = starters[i];
      if (!dedPid) continue;
      if (normalizePos(positions.get(dedPid)) !== flexPos) continue;

      const dedMs = kick(dedPid);
      if (dedMs == null) continue;
      if (flexMs >= dedMs) continue;

      if (!best || dedMs > best.ms) {
        best = { idx: i, ms: dedMs, slotLabel: dedSlot, pid: dedPid };
      }
    }

    if (best) {
      const key = `${Math.min(flexIdx, best.idx)}-${Math.max(flexIdx, best.idx)}`;
      if (usedPairs.has(key)) continue;
      usedPairs.add(key);

      recs.push({
        leagueId,
        leagueName,
        flexSlotLabel: slotRaw || "FLEX",
        dedicatedSlotLabel: best.slotLabel,
        flexPlayerLabel: labels.get(flexPid) ?? flexPid,
        dedicatedPlayerLabel: labels.get(best.pid) ?? best.pid,
        flexKickoffEt: formatKickoffEt(flexMs),
        dedicatedKickoffEt: formatKickoffEt(best.ms),
      });
    }
  }

  return recs;
}

export async function runFlexCheckAcrossLeagues(
  sleeperUserId: string,
  leagueIds: string[],
  nflState: NflState,
): Promise<{ evaluated: number; noIssue: number; recommendations: FlexSwapRecommendation[] }> {
  const uniq = [...new Set(leagueIds)];
  const season = nflState.league_season ?? nflState.season;
  const week = Math.max(1, nflState.display_week ?? nflState.leg ?? nflState.week ?? 1);
  const teamKickoffs = await getTeamKickoffMsForNflWeek(season, week);

  const recommendations: FlexSwapRecommendation[] = [];
  for (const lid of uniq) {
    const recs = await analyzeFlexSwapsForLeague(sleeperUserId, lid, teamKickoffs);
    recommendations.push(...recs);
  }

  const withSwaps = new Set(recommendations.map((r) => r.leagueId));
  const noIssue = uniq.filter((id) => !withSwaps.has(id)).length;
  return { evaluated: uniq.length, noIssue, recommendations };
}

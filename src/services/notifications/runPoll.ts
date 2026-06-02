import type { Client } from "discord.js";
import { prisma } from "../../db.js";
import { ALL_LEAGUES_SCOPE, LINEUP_MONITOR_SUBSCRIPTION_CATEGORIES } from "../../domain/notifications.js";
import { getLeague, getLeagueRosters, getLeagueTradedPicks, getNflState, getUserLeagues } from "../../sleeper/client.js";
import {
  getDraft,
  getOnTheClockDraftSlot,
  getDraftPicks,
  getLeagueDrafts,
  getOnTheClockPickerUserId,
} from "../../sleeper/draftDetail.js";
import { getLeagueUsers } from "../../sleeper/leagueUsers.js";
import { getLeagueTransactions, type SleeperTransaction } from "../../sleeper/transactionsApi.js";
import { categoriesForTransaction, formatTransactionLine } from "./formatTransaction.js";
import { deliverNotification, type SubscriptionWithUser } from "./dispatch.js";
import {
  finalizeNotificationJournalEntry,
  journalKeys,
  recordNotificationJournalEntry,
} from "./eventJournal.js";
import { sleeperDraftUrl, sleeperLeagueUrl } from "./links.js";
import { log } from "../../logging.js";
import { fetchAllNflPlayers } from "../../sleeper/playersFull.js";
import { analyzeLineupForLeague, loadProjectionMap, outcomeToCheckLineupMessage } from "../lineupCheck.js";
import { runEspnNotificationPoll } from "./espnPoll.js";

/** Log unsupported draft types for on-the-clock once per draft id per process. */
const warnedUnsupportedOnClockDraftIds = new Set<string>();
let fullPlayerCatalogCache: Map<string, string> | null = null;

type LeagueInterest = Map<string, Set<string>>;

interface PollOptions {
  /** If provided and empty, force replay for all leagues in this poll. */
  forceReplayLeagueIds?: Set<string>;
}

type PendingTxDelivery = {
  sub: SubscriptionWithUser;
  category: string;
  leagueName: string;
  lines: Array<{ content: string; batchableWaiverFa: boolean }>;
};

function compactWaiverBatchLine(line: string, leagueName: string): string {
  const escapedLeague = leagueName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const withoutLeague = line.replace(new RegExp(`^\\*\\*${escapedLeague}\\*\\*\\s+—\\s+`), "");
  const detail = withoutLeague.match(/^Waiver\/FA(?: · [^\n]+)? \(status: complete\)\n_([^_]+)_$/);
  return detail?.[1] ?? withoutLeague;
}

export function buildWaiverBatchPages(leagueName: string, lines: string[], perPage = 6): string[] {
  if (lines.length <= 1) return lines;
  const pages = Math.ceil(lines.length / perPage);
  const out: string[] = [];
  for (let i = 0; i < pages; i++) {
    const slice = lines.slice(i * perPage, (i + 1) * perPage);
    const cleaned = slice.map((ln) => compactWaiverBatchLine(ln, leagueName));
    out.push(
      `**${leagueName}** — Waiver/FA ${lines.length} item(s) (status: complete) · page ${i + 1}/${pages}\n` +
        cleaned.join("\n"),
    );
  }
  return out;
}

async function buildLeagueInterest(
  subs: SubscriptionWithUser[],
  season: string,
): Promise<LeagueInterest> {
  const map: LeagueInterest = new Map();
  for (const s of subs) {
    if (!s.user.sleeperUserId) continue;
    if (s.sleeperLeagueScope === ALL_LEAGUES_SCOPE) {
      const leagues = await getUserLeagues(s.user.sleeperUserId, season);
      for (const l of leagues) {
        if (!map.has(l.league_id)) map.set(l.league_id, new Set());
        map.get(l.league_id)!.add(s.userId);
      }
    } else {
      if (!map.has(s.sleeperLeagueScope)) map.set(s.sleeperLeagueScope, new Set());
      map.get(s.sleeperLeagueScope)!.add(s.userId);
    }
  }
  return map;
}

function subMatchesLeagueUser(
  sub: SubscriptionWithUser,
  leagueId: string,
  memberIds: Set<string>,
): boolean {
  if (sub.sleeperLeagueScope === leagueId) return true;
  if (sub.sleeperLeagueScope === ALL_LEAGUES_SCOPE && sub.user.sleeperUserId) {
    return memberIds.has(sub.user.sleeperUserId);
  }
  return false;
}

/**
 * One row per (Discord user × destination × category) for delivery. Overlapping `/subscribe`
 * routes — e.g. `__all__` and a specific league to the same DM — would otherwise match the same
 * event twice. Prefer a **league-specific** scope over `__all__` when both exist.
 */
function dedupeSubsByDestination(subs: SubscriptionWithUser[]): SubscriptionWithUser[] {
  const m = new Map<string, SubscriptionWithUser>();
  for (const s of subs) {
    const k = `${s.userId}:${s.category}:${s.isDm}:${s.guildId ?? ""}:${s.channelId ?? ""}`;
    const existing = m.get(k);
    if (!existing) {
      m.set(k, s);
      continue;
    }
    const exAll = existing.sleeperLeagueScope === ALL_LEAGUES_SCOPE;
    const sAll = s.sleeperLeagueScope === ALL_LEAGUES_SCOPE;
    if (exAll && !sAll) m.set(k, s);
    else if (!exAll && sAll) m.set(k, existing);
    else m.set(k, existing);
  }
  return [...m.values()];
}

async function loadMemberIds(leagueId: string): Promise<Set<string>> {
  const users = await getLeagueUsers(leagueId);
  return new Set(users.map((u) => u.user_id).filter(Boolean));
}

async function loadSleeperTeamLabels(leagueId: string): Promise<Map<string, string>> {
  const users = await getLeagueUsers(leagueId);
  const out = new Map<string, string>();
  for (const u of users) {
    if (!u.user_id) continue;
    const label = u.username?.trim() || u.display_name?.trim() || u.user_id;
    out.set(u.user_id, label);
  }
  return out;
}

const mentionCache = new Map<string, Map<string, string>>();
async function mentionForGuild(guildId: string, sleeperUserId: string): Promise<string | null> {
  let m = mentionCache.get(guildId);
  if (!m) {
    const rows = await prisma.sleeperMentionMapping.findMany({ where: { guildId } });
    m = new Map(rows.map((r) => [r.sleeperUserId, r.discordUserId]));
    mentionCache.set(guildId, m);
  }
  const discordUserId = m.get(sleeperUserId);
  return discordUserId ? `<@${discordUserId}>` : null;
}

function playerSummary(p: { player_id: string; metadata?: { first_name?: string; last_name?: string; position?: string; team?: string } }): string {
  const name =
    p.metadata?.last_name != null ? `${p.metadata?.first_name ?? ""} ${p.metadata.last_name}`.trim() : p.player_id;
  const pos = p.metadata?.position ?? "?";
  const team = p.metadata?.team?.trim();
  return team ? `${name} (${pos}, ${team})` : `${name} (${pos})`;
}

function playerLabelFromCatalog(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { first_name?: string; last_name?: string; position?: string; team?: string; full_name?: string };
  const name =
    d.full_name?.trim() ||
    `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim();
  if (!name) return null;
  const pos = d.position?.trim();
  const team = d.team?.trim();
  if (pos && team) return `${name} (${pos}, ${team})`;
  if (pos) return `${name} (${pos})`;
  return name;
}

async function ensureFullPlayerCatalogCache(): Promise<Map<string, string>> {
  if (fullPlayerCatalogCache) return fullPlayerCatalogCache;
  const raw = await fetchAllNflPlayers().catch(() => ({} as Record<string, unknown>));
  const out = new Map<string, string>();
  for (const [playerId, data] of Object.entries(raw)) {
    const label = playerLabelFromCatalog(data);
    if (label) out.set(playerId, label);
  }
  fullPlayerCatalogCache = out;
  return out;
}

function computePickRound(draft: { settings?: { teams?: number } }, nextPickIndex: number): number | null {
  const teams = draft.settings?.teams;
  if (!teams || teams < 1) return null;
  return Math.floor(nextPickIndex / teams) + 1;
}

async function resolveOnClockOwnerUserId(
  leagueId: string,
  draft: Awaited<ReturnType<typeof getDraft>>,
  nextPickIndex: number,
): Promise<string | null> {
  const slot = getOnTheClockDraftSlot(draft, nextPickIndex);
  if (slot == null) return getOnTheClockPickerUserId(draft, nextPickIndex);
  const baseRosterRaw = draft.slot_to_roster_id?.[String(slot)];
  const baseRosterId = Number(baseRosterRaw);
  if (!Number.isFinite(baseRosterId)) return getOnTheClockPickerUserId(draft, nextPickIndex);

  const rosters = await getLeagueRosters(leagueId).catch(() => []);
  const rosterOwner = new Map<number, string | null>(rosters.map((r) => [r.roster_id, r.owner_id]));

  const round = computePickRound(draft, nextPickIndex);
  if (round == null) return rosterOwner.get(baseRosterId) ?? null;

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

/** Snapshot for /poll-now and ops: are routes and Sleeper leagues visible to the poller? */
export async function describePollReadiness(): Promise<{
  season: string;
  week: number;
  subscriptionCount: number;
  dmRouteCount: number;
  channelRouteCount: number;
  leagueCount: number;
  sampleLeagueIds: string[];
}> {
  const state = await getNflState();
  const season = state.league_season ?? state.season;
  const week = Math.max(1, state.leg ?? state.display_week ?? state.week ?? 1);
  const subs = await prisma.notificationSubscription.findMany({
    where: { user: { sleeperUserId: { not: null } } },
    include: { user: true },
  });
  const interest = subs.length
    ? await buildLeagueInterest(subs as SubscriptionWithUser[], season)
    : new Map<string, Set<string>>();
  return {
    season,
    week,
    subscriptionCount: subs.length,
    dmRouteCount: subs.filter((s) => s.isDm).length,
    channelRouteCount: subs.filter((s) => !s.isDm).length,
    leagueCount: interest.size,
    sampleLeagueIds: [...interest.keys()].slice(0, 5),
  };
}

export async function runNotificationPoll(client: Client, opts?: PollOptions): Promise<void> {
  const state = await getNflState();
  const season = state.league_season ?? state.season;
  // Sleeper can report leg/week 0 in offseason; transactions still live under round 1.
  const week = Math.max(1, state.leg ?? state.display_week ?? state.week ?? 1);

  const subs = await prisma.notificationSubscription.findMany({
    where: { user: { sleeperUserId: { not: null } } },
    include: { user: true },
  });

  if (!subs.length) {
    log.info("poll_skip_no_subscriptions", { season, week });
    return;
  }

  const interest = await buildLeagueInterest(subs as SubscriptionWithUser[], season);
  const leagueIds = [...interest.keys()];
  if (!leagueIds.length) {
    log.info("poll_skip_no_leagues", { season, week, subscriptionCount: subs.length });
    return;
  }

  log.info("poll_start", {
    season,
    week,
    subscriptionCount: subs.length,
    leagueCount: leagueIds.length,
    sampleLeagueIds: leagueIds.slice(0, 5),
  });

  const memberCache = new Map<string, Set<string>>();

  for (const leagueId of leagueIds) {
    try {
      await processLeagueTransactions(
        client,
        subs as SubscriptionWithUser[],
        interest,
        memberCache,
        leagueId,
        season,
        week,
        opts?.forceReplayLeagueIds
          ? opts.forceReplayLeagueIds.size === 0 || opts.forceReplayLeagueIds.has(leagueId)
          : false,
      );
    } catch (e) {
      log.error("poll_transactions_league_failed", {
        leagueId,
        err: e instanceof Error ? e.message : String(e),
      });
    }

    try {
      await processLeagueDrafts(
        client,
        subs as SubscriptionWithUser[],
        interest,
        memberCache,
        leagueId,
      );
    } catch (e) {
      log.error("poll_drafts_league_failed", {
        leagueId,
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }

  try {
    await runDailyLineupAlerts(client, subs as SubscriptionWithUser[], season);
  } catch (e) {
    log.error("poll_lineup_alerts_failed", { err: e instanceof Error ? e.message : String(e) });
  }

  try {
    await runEspnNotificationPoll(client, subs as SubscriptionWithUser[]);
  } catch (e) {
    log.error("poll_espn_failed", { err: e instanceof Error ? e.message : String(e) });
  }

  log.info("poll_complete", { season, week, leagueCount: leagueIds.length });
}

async function runDailyLineupAlerts(
  client: Client,
  subs: SubscriptionWithUser[],
  season: string,
): Promise<void> {
  const todayUtc = new Date().toISOString().slice(0, 10);
  const metaKey = "lineup_alerts_last_run_utc_date";
  const last = await prisma.appMeta.findUnique({ where: { key: metaKey } });
  if (last?.value === todayUtc) return;

  const monitorCat = new Set<string>(LINEUP_MONITOR_SUBSCRIPTION_CATEGORIES);
  const qualifying = subs.filter((s) => monitorCat.has(s.category));
  if (!qualifying.length) return;

  type WorkKey = string;
  const work = new Map<
    WorkKey,
    { sleeperUserId: string | null; leagueId: string; deliverAs: SubscriptionWithUser }
  >();

  const pickDeliverSub = (
    current: SubscriptionWithUser | undefined,
    candidate: SubscriptionWithUser,
  ): SubscriptionWithUser => {
    if (!current) return candidate;
    if (current.category === "lineup_alerts") return current;
    if (candidate.category === "lineup_alerts") return candidate;
    return current;
  };

  for (const sub of qualifying) {
    const sleeperUserId = sub.user.sleeperUserId;
    if (!sleeperUserId) continue;
    const leagueIds =
      sub.sleeperLeagueScope === ALL_LEAGUES_SCOPE
        ? (await getUserLeagues(sleeperUserId, season).catch(() => [])).map((l) => l.league_id)
        : [sub.sleeperLeagueScope];
    for (const leagueId of leagueIds) {
      const k: WorkKey = sub.isDm
        ? `${sub.userId}:${sub.isDm}:${sub.guildId ?? ""}:${sub.channelId ?? ""}:${leagueId}`
        : `${sub.isDm}:${sub.guildId ?? ""}:${sub.channelId ?? ""}:${leagueId}`;
      const existing = work.get(k);
      if (!existing) {
        work.set(k, { sleeperUserId: sub.isDm ? sleeperUserId : null, leagueId, deliverAs: sub });
      } else {
        work.set(k, {
          sleeperUserId: sub.isDm ? sleeperUserId : null,
          leagueId,
          deliverAs: pickDeliverSub(existing.deliverAs, sub),
        });
      }
    }
  }

  const projections = await loadProjectionMap();
  for (const { sleeperUserId, leagueId, deliverAs } of work.values()) {
    if (deliverAs.isDm) {
      if (!sleeperUserId) continue;
      const outcome = await analyzeLineupForLeague(sleeperUserId, leagueId, { projections }).catch((e) => ({
        kind: "problem" as const,
        leagueId,
        leagueName: leagueId,
        detail: e instanceof Error ? e.message : String(e),
      }));
      if (outcome.kind !== "issues") continue;
      const msg = outcomeToCheckLineupMessage(outcome);
      await deliverNotification(client, deliverAs, { content: msg.slice(0, 2000) });
      continue;
    }

    const leagueWideMsg = await buildLeagueWideLineupAlertMessage(leagueId, projections, deliverAs.guildId);
    if (!leagueWideMsg) continue;
    await deliverNotification(client, deliverAs, { content: leagueWideMsg.slice(0, 2000) });
  }
  await prisma.appMeta.upsert({
    where: { key: metaKey },
    create: { key: metaKey, value: todayUtc },
    update: { value: todayUtc },
  });
}

async function buildLeagueWideLineupAlertMessage(
  leagueId: string,
  projections: Awaited<ReturnType<typeof loadProjectionMap>>,
  guildId: string | null,
): Promise<string | null> {
  const [league, rosters, users] = await Promise.all([
    getLeague(leagueId).catch(() => null),
    getLeagueRosters(leagueId).catch(() => []),
    getLeagueUsers(leagueId).catch(() => []),
  ]);
  const leagueName = league?.name ?? leagueId;
  const userLabels = new Map<string, string>();
  for (const u of users) {
    if (!u.user_id) continue;
    userLabels.set(u.user_id, u.username?.trim() || u.display_name?.trim() || u.user_id);
  }

  const issueLines: string[] = [];
  for (const r of rosters) {
    if (!r.owner_id) continue;
    const outcome = await analyzeLineupForLeague(r.owner_id, leagueId, { projections }).catch(() => null);
    if (!outcome || outcome.kind !== "issues") continue;
    let teamLabel = userLabels.get(r.owner_id) ?? r.owner_id;
    if (guildId) {
      const mention = await mentionForGuild(guildId, r.owner_id);
      if (mention) teamLabel = mention;
    }
    issueLines.push(`- **${teamLabel}**: ${outcome.issues.join("; ")}`);
  }

  if (!issueLines.length) return null;
  return (
    `**${leagueName}** lineup alerts\n` +
    `Teams with IR players in starters:\n` +
    `${issueLines.join("\n")}\n` +
    `${sleeperLeagueUrl(leagueId)}`
  );
}

/** Shared scan path so `/draft-check` can fan out newly-seen pick updates to followers. */
export async function triggerDraftNotificationScan(client: Client, leagueId: string): Promise<void> {
  const subs = await prisma.notificationSubscription.findMany({
    where: { user: { sleeperUserId: { not: null } } },
    include: { user: true },
  });
  if (!subs.length) return;
  const memberCache = new Map<string, Set<string>>();
  const interest = new Map<string, Set<string>>([[leagueId, new Set()]]);
  await processLeagueDrafts(client, subs as SubscriptionWithUser[], interest, memberCache, leagueId);
}

async function processLeagueTransactions(
  client: Client,
  subs: SubscriptionWithUser[],
  _interest: LeagueInterest,
  memberCache: Map<string, Set<string>>,
  leagueId: string,
  season: string,
  week: number,
  forceReplay: boolean,
): Promise<void> {
  let members = memberCache.get(leagueId);
  if (!members) {
    members = await loadMemberIds(leagueId);
    memberCache.set(leagueId, members);
  }

  let leagueName = leagueId;
  try {
    const lg = await getLeague(leagueId);
    leagueName = lg.name;
  } catch {
    /* */
  }

  let txs: SleeperTransaction[] = [];
  try {
    txs = await getLeagueTransactions(leagueId, week);
  } catch {
    return;
  }

  const cursor = await prisma.leaguePollCursor.findUnique({
    where: { leagueId_season_week: { leagueId, season, week } },
  });

  const maxCreated = txs.reduce((m, t) => Math.max(m, t.created ?? 0), 0);

  if (!cursor && !forceReplay) {
    log.info("poll_tx_baseline_init", { leagueId, season, week, maxCreated });
    await prisma.leaguePollCursor.create({
      data: {
        leagueId,
        season,
        week,
        lastTransactionCreatedMs: BigInt(maxCreated),
      },
    });
    return;
  }

  const baseline = cursor ? Number(cursor.lastTransactionCreatedMs) : 0;
  const newTxs = txs
    .filter((t) => t.status === "complete" && (t.created ?? 0) > baseline)
    .sort((a, b) => (a.created ?? 0) - (b.created ?? 0));
  log.info("poll_tx_scan", {
    leagueId,
    total: txs.length,
    baseline,
    newCount: newTxs.length,
  });

  const rosters = await getLeagueRosters(leagueId).catch(() => []);
  const labels = await loadSleeperTeamLabels(leagueId).catch(() => new Map<string, string>());
  const rosterLabels = new Map<number, string>();
  for (const r of rosters) {
    if (typeof r.roster_id !== "number") continue;
    const label = (r.owner_id && labels.get(r.owner_id)) || `roster ${r.roster_id}`;
    rosterLabels.set(r.roster_id, label);
  }
  const drafts = await getLeagueDrafts(leagueId).catch(() => []);
  const draftSlotsBySeason = new Map<string, Map<number, number>>();
  for (const d of drafts) {
    const seasonKey = d.season;
    if (!seasonKey || draftSlotsBySeason.has(seasonKey)) continue;
    const detail = await getDraft(d.draft_id).catch(() => null);
    if (!detail?.slot_to_roster_id) continue;
    const m = new Map<number, number>();
    for (const [slotRaw, rosterRaw] of Object.entries(detail.slot_to_roster_id)) {
      const slot = Number(slotRaw);
      const rosterId = Number(rosterRaw);
      if (Number.isFinite(slot) && Number.isFinite(rosterId)) m.set(rosterId, slot);
    }
    if (m.size) draftSlotsBySeason.set(seasonKey, m);
  }

  const pending = new Map<string, PendingTxDelivery>();
  const pendingKey = (sub: SubscriptionWithUser, category: string) =>
    `${sub.id}:${category}:${sub.isDm ? "dm" : "guild"}:${sub.guildId ?? ""}:${sub.channelId ?? ""}`;

  for (const tx of newTxs) {
    /** Sleeper may raise `created` on the same `transaction_id` when draft picks are enriched — avoid a second post. */
    if (!forceReplay) {
      const seen = await prisma.leagueTransactionNotified.findUnique({
        where: { leagueId_transactionId: { leagueId, transactionId: tx.transaction_id } },
      });
      if (seen) {
        log.info("poll_tx_skip_dedupe", { leagueId, transactionId: tx.transaction_id });
        continue;
      }
    }

    const cats = categoriesForTransaction(tx);
    const playerIds = [...new Set([...Object.keys(tx.adds ?? {}), ...Object.keys(tx.drops ?? {})])];
    const catalogRows =
      playerIds.length > 0
        ? await prisma.sleeperPlayer.findMany({
            where: { playerId: { in: playerIds } },
            select: { playerId: true, data: true },
          })
        : [];
    const playerLabels = new Map<string, string>();
    for (const row of catalogRows) {
      const label = playerLabelFromCatalog(row.data);
      if (label) playerLabels.set(row.playerId, label);
    }
    const missingIds = playerIds.filter((id) => !playerLabels.has(id));
    if (missingIds.length) {
      const fallback = await ensureFullPlayerCatalogCache();
      for (const id of missingIds) {
        const nm = fallback.get(id);
        if (nm) playerLabels.set(id, nm);
      }
    }
    const line = formatTransactionLine(tx, leagueName, playerLabels, rosterLabels, draftSlotsBySeason);
    const batchableWaiverFa = tx.type === "free_agent" || tx.type === "waiver";
    const catTargets = cats.map((cat) => ({
      cat,
      targets: dedupeSubsByDestination(
        subs.filter((s) => s.category === cat && subMatchesLeagueUser(s, leagueId, members!)),
      ),
    }));
    const categoriesEmitted = catTargets.filter((x) => x.targets.length > 0).map((x) => x.cat);
    const txEventKey = journalKeys.transaction(leagueId, tx.transaction_id);
    if (!forceReplay && categoriesEmitted.length > 0) {
      const claimed = await recordNotificationJournalEntry({
        eventKey: txEventKey,
        kind: "transaction",
        leagueId,
        transactionId: tx.transaction_id,
        season,
        week,
        targetCount: 0,
        meta: { categories: categoriesEmitted },
      });
      if (!claimed) {
        log.info("poll_tx_skip_claimed", { leagueId, transactionId: tx.transaction_id });
        continue;
      }
    }

    let targetDeliveries = 0;
    for (const { cat, targets } of catTargets) {
      log.info("poll_tx_emit", {
        leagueId,
        transactionId: tx.transaction_id,
        category: cat,
        targets: targets.length,
      });
      for (const sub of targets) {
        const k = pendingKey(sub, cat);
        const ex = pending.get(k);
        if (!ex) {
          pending.set(k, { sub, category: cat, leagueName, lines: [{ content: line, batchableWaiverFa }] });
        } else {
          ex.lines.push({ content: line, batchableWaiverFa });
        }
        targetDeliveries++;
      }
    }

    if (!forceReplay && categoriesEmitted.length > 0) {
      await finalizeNotificationJournalEntry(txEventKey, targetDeliveries, { categories: categoriesEmitted });
    }

    if (!forceReplay && targetDeliveries > 0) {
      await prisma.leagueTransactionNotified.upsert({
        where: { leagueId_transactionId: { leagueId, transactionId: tx.transaction_id } },
        create: { leagueId, transactionId: tx.transaction_id },
        update: {},
      });
    }
  }

  for (const p of pending.values()) {
    const batchableWaiverFaLines = p.lines.filter((ln) => ln.batchableWaiverFa).map((ln) => ln.content);
    if (batchableWaiverFaLines.length > 1) {
      const pages = buildWaiverBatchPages(p.leagueName, batchableWaiverFaLines, 6);
      for (const content of pages) {
        await deliverNotification(client, p.sub, { content: content.slice(0, 2000) });
      }
    }
    for (const ln of p.lines) {
      if (batchableWaiverFaLines.length > 1 && ln.batchableWaiverFa) continue;
      await deliverNotification(client, p.sub, { content: ln.content });
    }
  }

  const nextBaseline = Math.max(baseline, maxCreated, ...txs.map((t) => t.created ?? 0));
  await prisma.leaguePollCursor.upsert({
    where: { leagueId_season_week: { leagueId, season, week } },
    create: { leagueId, season, week, lastTransactionCreatedMs: BigInt(nextBaseline) },
    update: { lastTransactionCreatedMs: BigInt(nextBaseline) },
  });
}

async function processLeagueDrafts(
  client: Client,
  subs: SubscriptionWithUser[],
  _interest: LeagueInterest,
  memberCache: Map<string, Set<string>>,
  leagueId: string,
): Promise<void> {
  let members = memberCache.get(leagueId);
  if (!members) {
    members = await loadMemberIds(leagueId);
    memberCache.set(leagueId, members);
  }

  let leagueName = leagueId;
  try {
    const lg = await getLeague(leagueId);
    leagueName = lg.name;
  } catch {
    /* */
  }

  const labels = await loadSleeperTeamLabels(leagueId).catch(() => new Map<string, string>());
  const drafts = await getLeagueDrafts(leagueId).catch(() => []);

  for (const dref of drafts) {
    if (dref.status !== "drafting") continue;

    const draft = await getDraft(dref.draft_id).catch(() => null);
    if (!draft || draft.status !== "drafting") continue;

    const onClockType = draft.type?.toLowerCase();
    const onClockSupported =
      !onClockType || onClockType === "snake" || onClockType === "linear";
    if (!onClockSupported && !warnedUnsupportedOnClockDraftIds.has(dref.draft_id)) {
      warnedUnsupportedOnClockDraftIds.add(dref.draft_id);
      log.info("poll_draft_on_clock_unsupported_type", { draftId: dref.draft_id, draftType: draft.type });
    }

    const picks = await getDraftPicks(dref.draft_id).catch(() => []);
    const existing = await prisma.draftPollCursor.findUnique({ where: { draftId: dref.draft_id } });

    let lastSeen = existing?.lastSeenPickCount ?? 0;
    let lastOnClock = existing?.lastOnClockPickNo ?? 0;
    log.info("poll_draft_scan", {
      leagueId,
      draftId: dref.draft_id,
      picks: picks.length,
      lastSeen,
      lastOnClock,
    });

    if (picks.length > lastSeen) {
      const newPicks = picks.slice(lastSeen);
      // One notification per poll: latest pick only (avoid spam when many picks land between hourly ticks).
      const p = newPicks[newPicks.length - 1]!;
      const picker = labels.get(p.picked_by) ?? `\`${p.picked_by}\``;
      const currentOnClock = await resolveOnClockOwnerUserId(leagueId, draft, picks.length);
      const onClockName = currentOnClock ? labels.get(currentOnClock) ?? `\`${currentOnClock}\`` : "unknown";
      let msg = `**${leagueName}** draft · Pick ${p.pick_no}: ${playerSummary(p)} by **${picker}**`;
      if (newPicks.length > 1) {
        msg += ` _(${newPicks.length - 1} earlier pick(s) since last check skipped)_`;
      }
      msg += `\n_On the clock:_ **${onClockName}**`;
      msg += `\n${sleeperDraftUrl(dref.draft_id)} · ${sleeperLeagueUrl(leagueId)}`;
      const targets = dedupeSubsByDestination(
        subs.filter(
          (s) =>
            s.category === "draft_status" &&
            subMatchesLeagueUser(s, leagueId, members!) &&
            (!s.sleeperDraftId || s.sleeperDraftId === dref.draft_id),
        ),
      );
      const draftPickEventKey = journalKeys.draftPick(dref.draft_id, p.pick_no);
      let statusDeliveries = 0;
      if (targets.length > 0) {
        const claimed = await recordNotificationJournalEntry({
          eventKey: draftPickEventKey,
          kind: "draft_pick",
          leagueId,
          draftId: dref.draft_id,
          pickNo: p.pick_no,
          targetCount: 0,
          meta: { leagueName, skippedEarlierPicks: newPicks.length > 1 ? newPicks.length - 1 : 0 },
        });
        if (claimed) {
          for (const sub of targets) {
            await deliverNotification(client, sub, { content: msg.slice(0, 2000) });
            statusDeliveries++;
          }
          await finalizeNotificationJournalEntry(draftPickEventKey, statusDeliveries, {
            leagueName,
            skippedEarlierPicks: newPicks.length > 1 ? newPicks.length - 1 : 0,
          });
        } else {
          log.info("poll_draft_skip_pick_claimed", {
            leagueId,
            draftId: dref.draft_id,
            pickNo: p.pick_no,
          });
        }
      }
      log.info("poll_draft_emit_status", {
        leagueId,
        draftId: dref.draft_id,
        pickNo: p.pick_no,
        targets: statusDeliveries,
      });
      lastSeen = picks.length;
    }

    const nextIdx = picks.length;
    const onClock = await resolveOnClockOwnerUserId(leagueId, draft, nextIdx);
    const sequencePick = nextIdx + 1;

    if (onClock) {
      const allTurnSubs = dedupeSubsByDestination(
        subs.filter(
          (s) =>
            s.category === "draft_on_the_clock" &&
            subMatchesLeagueUser(s, leagueId, members!) &&
            (!s.sleeperDraftId || s.sleeperDraftId === dref.draft_id),
        ),
      );
      const dmTurnSubs = allTurnSubs.filter((s) => s.isDm && s.user.sleeperUserId === onClock);
      const guildTurnSubs = allTurnSubs.filter((s) => !s.isDm);
      if ((dmTurnSubs.length || guildTurnSubs.length) && sequencePick > lastOnClock) {
        const dmMsg =
          `**${leagueName}** — **your pick is on the clock** (pick ${sequencePick}).\n` +
          `${sleeperDraftUrl(dref.draft_id)} · ${sleeperLeagueUrl(leagueId)}`;
        let guildOnClockName = labels.get(onClock) ?? `\`${onClock}\``;
        if (guildTurnSubs.length && guildTurnSubs[0]?.guildId) {
          const mention = await mentionForGuild(guildTurnSubs[0].guildId, onClock);
          if (mention) guildOnClockName = mention;
        }
        const guildMsg =
          `**${leagueName}** — pick ${sequencePick} is on the clock: **${guildOnClockName}**.\n` +
          `${sleeperDraftUrl(dref.draft_id)} · ${sleeperLeagueUrl(leagueId)}`;
        const draftClockEventKey = journalKeys.draftOnClock(dref.draft_id, sequencePick);
        const claimed = await recordNotificationJournalEntry({
          eventKey: draftClockEventKey,
          kind: "draft_on_clock",
          leagueId,
          draftId: dref.draft_id,
          pickNo: sequencePick,
          targetCount: 0,
          meta: { leagueName },
        });
        let clockDeliveries = 0;
        if (claimed) {
          for (const sub of dmTurnSubs) {
            await deliverNotification(client, sub, { content: dmMsg });
            clockDeliveries++;
          }
          for (const sub of guildTurnSubs) {
            await deliverNotification(client, sub, { content: guildMsg });
            clockDeliveries++;
          }
          await finalizeNotificationJournalEntry(draftClockEventKey, clockDeliveries, { leagueName });
        } else {
          log.info("poll_draft_skip_clock_claimed", {
            leagueId,
            draftId: dref.draft_id,
            pickNo: sequencePick,
          });
        }
        log.info("poll_draft_emit_on_clock", {
          leagueId,
          draftId: dref.draft_id,
          pickNo: sequencePick,
          targets: clockDeliveries,
        });
        lastOnClock = sequencePick;
      }
    }

    await prisma.draftPollCursor.upsert({
      where: { draftId: dref.draft_id },
      create: {
        draftId: dref.draft_id,
        lastSeenPickCount: lastSeen,
        lastOnClockPickNo: lastOnClock,
      },
      update: {
        lastSeenPickCount: lastSeen,
        lastOnClockPickNo: lastOnClock,
      },
    });
  }
}

import type { Client } from "discord.js";
import { prisma } from "../../db.js";
import { fetchEspnLeagueSnapshot, espnEnabled } from "../../adapters/espn/index.js";
import { deliverNotification, type SubscriptionWithUser } from "./dispatch.js";
import { finalizeNotificationJournalEntry, recordNotificationJournalEntry } from "./eventJournal.js";
import { log } from "../../logging.js";
import { ALL_LEAGUES_SCOPE } from "../../domain/notifications.js";

const ESPN_SCOPE_PREFIX = "espn:";
const ESPN_ALL_SCOPE = `${ESPN_SCOPE_PREFIX}${ALL_LEAGUES_SCOPE}`;

function asUserEspn(user: unknown): { espnLeagueIds?: unknown; espnSeason?: unknown; espnS2?: unknown; espnSwid?: unknown } {
  return (user ?? {}) as { espnLeagueIds?: unknown; espnSeason?: unknown; espnS2?: unknown; espnSwid?: unknown };
}

function espnLeagueIdsForSub(sub: SubscriptionWithUser): string[] {
  const scope = sub.sleeperLeagueScope ?? "";
  if (scope.startsWith(ESPN_SCOPE_PREFIX) && scope !== ESPN_ALL_SCOPE) {
    return [scope.slice(ESPN_SCOPE_PREFIX.length)];
  }
  if (scope !== ESPN_ALL_SCOPE) return [];
  const u = asUserEspn(sub.user);
  return Array.isArray(u.espnLeagueIds)
    ? u.espnLeagueIds.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
}

const eventKey = {
  draft: (leagueId: string, pick: number | null) => `espn:v1:draft:${leagueId}:${pick ?? 0}`,
  activity: (leagueId: string, eventId: string) => `espn:v1:activity:${leagueId}:${eventId}`,
};

export async function runEspnNotificationPoll(client: Client, subs: SubscriptionWithUser[]): Promise<void> {
  if (!espnEnabled()) return;
  const espnSubs = subs.filter((s) => s.provider === "espn");
  if (!espnSubs.length) return;

  // Group routes by user and league scope.
  const byLeague = new Map<string, SubscriptionWithUser[]>();
  for (const sub of espnSubs) {
    for (const lid of espnLeagueIdsForSub(sub)) {
      if (!byLeague.has(lid)) byLeague.set(lid, []);
      byLeague.get(lid)!.push(sub);
    }
  }

  for (const [leagueId, leagueSubs] of byLeague.entries()) {
    const userCfg = asUserEspn(leagueSubs[0]?.user);
    const season =
      (typeof userCfg.espnSeason === "string" && userCfg.espnSeason.trim()) ||
      String(new Date().getUTCFullYear());
    const espnS2 = typeof userCfg.espnS2 === "string" ? userCfg.espnS2 : undefined;
    const swid = typeof userCfg.espnSwid === "string" ? userCfg.espnSwid : undefined;

    try {
      const snap = await fetchEspnLeagueSnapshot({ leagueId, season, espnS2, swid });

      // Step 1: roster normalization is available in snap.rosters for downstream consumers/logging.
      log.info("espn_roster_snapshot_loaded", {
        leagueId,
        teams: snap.rosters.length,
      });

      // Step 2: draft status with fallback inference.
      if (snap.draft.status === "drafting") {
        const targets = leagueSubs.filter((s) => s.category === "draft_status");
        if (targets.length) {
          const key = eventKey.draft(leagueId, snap.draft.currentPick ?? null);
          const claimed = await recordNotificationJournalEntry({
            eventKey: key,
            kind: "draft_pick",
            leagueId,
            pickNo: snap.draft.currentPick ?? undefined,
            targetCount: 0,
            meta: { provider: "espn", reason: snap.draft.reason },
          });
          if (claimed) {
            let deliveries = 0;
            const msg =
              `**${snap.league?.name ?? leagueId}** ESPN draft status\n` +
              `Status: drafting (${snap.draft.reason})\n` +
              `Current pick: ${snap.draft.currentPick ?? "unknown"}\n` +
              `On the clock: ${snap.draft.onTheClockTeam ?? "unknown"}`;
            for (const sub of targets) {
              await deliverNotification(client, sub, { content: msg.slice(0, 2000) });
              deliveries++;
            }
            await finalizeNotificationJournalEntry(key, deliveries, { provider: "espn" });
          }
        }
      }

      // Step 3: same fanout contract for transactions/waivers categories.
      for (const e of snap.recent) {
        const cat = e.type === "waiver" || e.type === "free_agent" ? "waivers" : "transactions";
        const targets = leagueSubs.filter((s) => s.category === cat);
        if (!targets.length) continue;
        const key = eventKey.activity(leagueId, e.eventId);
        const claimed = await recordNotificationJournalEntry({
          eventKey: key,
          kind: "transaction",
          leagueId,
          transactionId: e.eventId,
          targetCount: 0,
          meta: { provider: "espn", type: e.type },
        });
        if (!claimed) continue;
        let deliveries = 0;
        const msg =
          `**${snap.league?.name ?? leagueId}** — ESPN ${cat === "waivers" ? "Waiver/FA" : "Activity"}\n` +
          `${e.summary}`;
        for (const sub of targets) {
          await deliverNotification(client, sub, { content: msg.slice(0, 2000) });
          deliveries++;
        }
        await finalizeNotificationJournalEntry(key, deliveries, { provider: "espn", type: e.type });
      }
    } catch (err) {
      log.warn("espn_poll_league_failed", {
        leagueId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

import type { Client } from "discord.js";
import { prisma } from "../db.js";
import { log } from "../logging.js";
import { runNotificationPoll } from "../services/notifications/runPoll.js";
import {
  META_PLAYERS_SYNCED_AT,
  META_PROJECTIONS_SYNCED,
  parseProjectionsSyncMeta,
  syncNflPlayerCatalog,
  syncWeeklyProjections,
} from "../services/sleeperSync.js";
import { runMemberStartSnapshot } from "./memberStartSnapshot.js";
import { getNflState } from "../sleeper/client.js";

/**
 * Rule D: hourly batch — Sleeper transaction + draft polling for subscribed routes.
 * Also refreshes member-universe starter snapshots for VORP start rates (throttled below).
 */
let lastStartSnapshotAt = 0;
const START_SNAPSHOT_MIN_MS = 6 * 60 * 60 * 1000;
const PLAYERS_CATALOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PROJECTIONS_MAX_AGE_MS = 60 * 60 * 1000;

async function maybeSyncNflPlayerCatalog(): Promise<void> {
  const meta = await prisma.appMeta.findUnique({ where: { key: META_PLAYERS_SYNCED_AT } });
  const last = meta?.value ? Date.parse(String(meta.value)) : Number.NaN;
  if (Number.isFinite(last) && Date.now() - last < PLAYERS_CATALOG_MAX_AGE_MS) return;
  const { count } = await syncNflPlayerCatalog(prisma);
  log.info("players_catalog_synced", { count });
}

async function maybeSyncWeeklyProjections(): Promise<void> {
  const nfl = await getNflState();
  const season = String(nfl.league_season ?? nfl.season);
  const week = Math.max(1, nfl.display_week ?? nfl.week ?? 1);
  const meta = parseProjectionsSyncMeta(
    (await prisma.appMeta.findUnique({ where: { key: META_PROJECTIONS_SYNCED } }))?.value,
  );
  const last = meta?.at ? Date.parse(meta.at) : Number.NaN;
  const sameWeek = meta?.season === season && meta?.week === week && meta?.seasonType === "regular";
  if (sameWeek && Number.isFinite(last) && Date.now() - last < PROJECTIONS_MAX_AGE_MS) return;
  const { count } = await syncWeeklyProjections(prisma, season, week, "regular");
  log.info("projections_synced", { season, week, count });
}

export async function runHourlyDigest(client: Client): Promise<void> {
  log.info("hourly_poll_tick", { at: new Date().toISOString() });
  await runNotificationPoll(client);
  const now = Date.now();
  if (now - lastStartSnapshotAt >= START_SNAPSHOT_MIN_MS) {
    lastStartSnapshotAt = now;
    await runMemberStartSnapshot().catch((err) =>
      log.error("member_start_snapshot_failed", { err: err instanceof Error ? err.message : String(err) }),
    );
  }
  await maybeSyncNflPlayerCatalog().catch((err) =>
    log.error("players_catalog_sync_failed", { err: err instanceof Error ? err.message : String(err) }),
  );
  await maybeSyncWeeklyProjections().catch((err) =>
    log.error("projections_sync_failed", { err: err instanceof Error ? err.message : String(err) }),
  );
}

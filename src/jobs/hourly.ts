import type { Client } from "discord.js";
import { log } from "../logging.js";
import { runNotificationPoll } from "../services/notifications/runPoll.js";
import { runMemberStartSnapshot } from "./memberStartSnapshot.js";

/**
 * Rule D: hourly batch — Sleeper transaction + draft polling for subscribed routes.
 * Also refreshes member-universe starter snapshots for VORP start rates (throttled below).
 */
let lastStartSnapshotAt = 0;
const START_SNAPSHOT_MIN_MS = 6 * 60 * 60 * 1000;

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
}

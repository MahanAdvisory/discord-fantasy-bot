import type { Client } from "discord.js";
import { log } from "../logging.js";
import { runNotificationPoll } from "../services/notifications/runPoll.js";

/**
 * Rule D: hourly batch — Sleeper transaction + draft polling for subscribed routes.
 */
export async function runHourlyDigest(client: Client): Promise<void> {
  log.info("hourly_poll_tick", { at: new Date().toISOString() });
  await runNotificationPoll(client);
}

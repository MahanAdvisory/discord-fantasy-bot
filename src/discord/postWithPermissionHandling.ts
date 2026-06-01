import type { Client, MessageCreateOptions, TextChannel } from "discord.js";
import { prisma } from "../db.js";
import { log } from "../logging.js";

const PERMISSION_CODES = new Set([50001, 50013, 50007]);

/** Throttle repeated “still broken” logs when routes were already notified (hourly poll). */
const lastStaleChannelLogMs = new Map<string, number>();
const STALE_LOG_COOLDOWN_MS = 60 * 60 * 1000;

function isPermissionOrMissingAccess(code: number | undefined): boolean {
  if (code === undefined) return false;
  return PERMISSION_CODES.has(code) || (code >= 50001 && code <= 50013);
}

function shouldLogStaleChannelFailure(channelId: string): boolean {
  const now = Date.now();
  const prev = lastStaleChannelLogMs.get(channelId) ?? 0;
  if (now - prev < STALE_LOG_COOLDOWN_MS) return false;
  lastStaleChannelLogMs.set(channelId, now);
  return true;
}

/**
 * After any successful post to a channel, clear permission-warning flags so a future outage can DM again.
 * Also used by `/route-test` after a manual verification post.
 */
export async function clearPermissionNotifiedFlagsForChannel(channelId: string): Promise<number> {
  const r = await prisma.notificationSubscription.updateMany({
    where: { channelId, isDm: false },
    data: { permissionNotifiedAt: null },
  });
  return r.count;
}

/**
 * Rule F: if the bot cannot post, log and DM route owners once per channel (all categories share the same fix).
 * Discord 50001 = Missing Access (private channel, bot kicked, category permissions, etc.).
 */
export async function postToTextChannelWithHandling(
  client: Client,
  subscriptionId: string,
  channel: TextChannel,
  options: MessageCreateOptions,
): Promise<void> {
  const sub = await prisma.notificationSubscription.findUnique({
    where: { id: subscriptionId },
    include: { user: true },
  });
  if (!sub) return;

  try {
    await channel.send(options);
    await clearPermissionNotifiedFlagsForChannel(channel.id);
  } catch (e: unknown) {
    const err = e as { code?: number; message?: string };
    if (!isPermissionOrMissingAccess(err?.code)) {
      log.error("post_to_channel_failed", {
        subscriptionId,
        code: err?.code,
        err: err?.message ?? (e instanceof Error ? e.message : String(e)),
      });
      throw e;
    }

    const channelId = channel.id;
    const pending = await prisma.notificationSubscription.findMany({
      where: { channelId, isDm: false, permissionNotifiedAt: null },
      include: { user: true },
    });

    if (pending.length > 0) {
      await prisma.notificationSubscription.updateMany({
        where: { channelId, isDm: false, permissionNotifiedAt: null },
        data: { permissionNotifiedAt: new Date() },
      });
      const discordIds = [...new Set(pending.map((p) => p.user.discordUserId))];
      for (const setupDiscordId of discordIds) {
        if (!setupDiscordId) continue;
        try {
          const dm = await client.users.createDM(setupDiscordId);
          await dm.send({
            content:
              `I could not post in <#${channelId}> for notification route(s) you set up (**Missing Access** / permissions). ` +
              `Give the bot **View Channel** and **Send Messages** (and use the channel if it’s private). ` +
              `After fixing, run **/route-test** in that channel to verify and reset warning flags. ` +
              `Affected routes: ${pending.length}. Example id: \`${subscriptionId}\`.`,
          });
        } catch (dmErr) {
          log.error("post_to_channel_permission_dm_failed", {
            channelId,
            err: dmErr instanceof Error ? dmErr.message : String(dmErr),
          });
        }
      }
      log.warn("post_to_channel_missing_access_notified", {
        code: err?.code,
        channelId,
        usersDmCount: discordIds.length,
        subscriptionsFlagged: pending.length,
      });
      return;
    }

    if (shouldLogStaleChannelFailure(channelId)) {
      log.warn("post_to_channel_missing_access_stale", {
        code: err?.code,
        channelId,
      });
    }
  }
}

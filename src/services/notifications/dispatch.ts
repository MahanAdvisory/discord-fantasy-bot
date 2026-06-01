import {
  ChannelType,
  type Client,
  type MessageCreateOptions,
  type TextChannel,
} from "discord.js";
import type { NotificationSubscription, User } from "@prisma/client";
import { postToTextChannelWithHandling } from "../../discord/postWithPermissionHandling.js";
import { log } from "../../logging.js";

export type SubscriptionWithUser = NotificationSubscription & { user: User };

export async function deliverNotification(
  client: Client,
  sub: SubscriptionWithUser,
  options: MessageCreateOptions,
): Promise<void> {
  const content = options.content;
  if (!content || typeof content !== "string") {
    if (!options.embeds?.length) return;
  }

  if (sub.isDm || !sub.channelId) {
    if (!sub.user.discordUserId) return;
    try {
      const discordUser = await client.users.fetch(sub.user.discordUserId);
      const payload: MessageCreateOptions = {};
      if (typeof content === "string") payload.content = content.slice(0, 2000);
      if (options.embeds?.length) payload.embeds = options.embeds;
      if (!payload.content && !payload.embeds?.length) return;
      await discordUser.send(payload);
    } catch (e) {
      log.error("deliver_notification_dm_failed", {
        subscriptionId: sub.id,
        err: e instanceof Error ? e.message : String(e),
      });
    }
    return;
  }

  let ch;
  try {
    ch = await client.channels.fetch(sub.channelId);
  } catch (e) {
    log.warn("deliver_notification_channel_fetch_failed", {
      channelId: sub.channelId,
      err: e instanceof Error ? e.message : String(e),
    });
    return;
  }
  if (!ch?.isTextBased()) {
    log.warn("deliver_notification_channel_not_text", { channelId: sub.channelId });
    return;
  }
  if (ch.type !== ChannelType.GuildText && ch.type !== ChannelType.PublicThread) {
    return;
  }
  await postToTextChannelWithHandling(client, sub.id, ch as TextChannel, {
    content: typeof content === "string" ? content.slice(0, 2000) : undefined,
    embeds: options.embeds,
  });
}

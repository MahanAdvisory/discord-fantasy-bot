import {
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { prisma } from "../db.js";
import * as sleeper from "../sleeper/client.js";
import {
  DEFAULT_SUBSCRIPTION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABELS,
  NOTIFICATION_CATEGORIES,
  isNotificationCategory,
} from "../domain/notifications.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("link")
    .setDescription("Link your Discord account to a Sleeper username")
    .addStringOption((o) =>
      o.setName("sleeper_username").setDescription("Your Sleeper username").setRequired(true),
    ),
  new SlashCommandBuilder().setName("leagues").setDescription("List your Sleeper NFL leagues (this season)"),
  new SlashCommandBuilder().setName("drafts").setDescription("List your Sleeper drafts (this season)"),
  new SlashCommandBuilder()
    .setName("subscribe")
    .setDescription("Send alerts for a league to this channel (or configure categories)")
    .addStringOption((o) =>
      o
        .setName("sleeper_league_id")
        .setDescription("Optional Sleeper league_id; omit for all your leagues"),
    )
    .addStringOption((o) =>
      o
        .setName("categories")
        .setDescription(
          `Comma-separated: ${NOTIFICATION_CATEGORIES.join(", ")} (default: core set)`,
        ),
    ),
  new SlashCommandBuilder()
    .setName("post-summary")
    .setDescription("Post your leagues summary to this channel (for the server feed)"),
  new SlashCommandBuilder().setName("subscriptions").setDescription("List your notification subscriptions"),
].map((c) => c.toJSON());

function parseCategories(raw: string | null): string[] {
  if (!raw?.trim()) return [...DEFAULT_SUBSCRIPTION_CATEGORIES];
  const parts = raw.split(",").map((s) => s.trim().toLowerCase());
  const out: string[] = [];
  for (const p of parts) {
    if (isNotificationCategory(p)) out.push(p);
  }
  return out.length ? out : [...DEFAULT_SUBSCRIPTION_CATEGORIES];
}

export async function handleInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
  const { commandName } = interaction;
  if (
    !interaction.inGuild() &&
    commandName !== "link" &&
    commandName !== "leagues" &&
    commandName !== "drafts" &&
    commandName !== "subscriptions"
  ) {
    await interaction.reply({ content: "Use this command in a server.", ephemeral: true });
    return;
  }

  if (commandName === "link") {
    const username = interaction.options.getString("sleeper_username", true).trim();
    await interaction.deferReply({ ephemeral: true });
    const su = await sleeper.getUserByUsername(username);
    if (!su) {
      await interaction.editReply({ content: `No Sleeper user found for **${username}**.` });
      return;
    }
    await prisma.user.upsert({
      where: { discordUserId: interaction.user.id },
      create: {
        discordUserId: interaction.user.id,
        sleeperUsername: su.username,
        sleeperUserId: su.user_id,
      },
      update: { sleeperUsername: su.username, sleeperUserId: su.user_id },
    });
    await interaction.editReply({
      content: `Linked **${interaction.user.tag}** → Sleeper **${su.username}** (\`${su.user_id}\`).`,
    });
    return;
  }

  const user = await prisma.user.findUnique({ where: { discordUserId: interaction.user.id } });
  if (!user?.sleeperUserId) {
    await interaction.reply({ content: "Run `/link` with your Sleeper username first.", ephemeral: true });
    return;
  }

  if (commandName === "leagues" || commandName === "drafts") {
    await interaction.deferReply({ ephemeral: true });
    const state = await sleeper.getNflState();
    const season = state.league_season ?? state.season;
    try {
      if (commandName === "leagues") {
        const leagues = await sleeper.getUserLeagues(user.sleeperUserId, season);
        if (!leagues.length) {
          await interaction.editReply({ content: `No leagues for season **${season}**.` });
          return;
        }
        const lines = leagues.map(
          (l) => `• **${l.name}** — \`${l.league_id}\` — _${l.status}_`,
        );
        await interaction.editReply({
          content: `**Leagues (${season})**\n${lines.join("\n")}`,
        });
      } else {
        const drafts = await sleeper.getUserDrafts(user.sleeperUserId, season);
        if (!drafts.length) {
          await interaction.editReply({ content: `No drafts for season **${season}**.` });
          return;
        }
        const lines = drafts.map((d) => `• \`${d.draft_id}\` — _${d.status}_ — league \`${d.league_id}\``);
        await interaction.editReply({ content: `**Drafts (${season})**\n${lines.join("\n")}` });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sleeper request failed";
      await interaction.editReply({ content: msg });
    }
    return;
  }

  if (commandName === "subscribe") {
    if (!interaction.inGuild() || !interaction.channel) {
      await interaction.reply({ content: "Use `/subscribe` in a server text channel.", ephemeral: true });
      return;
    }
    if (interaction.channel.type !== ChannelType.GuildText && interaction.channel.type !== ChannelType.PublicThread) {
      await interaction.reply({ content: "Use a text channel or thread.", ephemeral: true });
      return;
    }
    const leagueId = interaction.options.getString("sleeper_league_id");
    if (leagueId) {
      try {
        await sleeper.getLeague(leagueId);
      } catch {
        await interaction.reply({ content: `League \`${leagueId}\` not found.`, ephemeral: true });
        return;
      }
    }
    const categories = parseCategories(interaction.options.getString("categories"));
    await prisma.notificationSubscription.create({
      data: {
        userId: user.id,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        isDm: false,
        sleeperLeagueId: leagueId,
        categories,
      },
    });
    const catLines = categories.map((c) => NOTIFICATION_CATEGORY_LABELS[c as keyof typeof NOTIFICATION_CATEGORY_LABELS] ?? c);
    await interaction.reply({
      ephemeral: true,
      content:
        `Subscribed <#${interaction.channelId}> for **${leagueId ?? "all leagues"}**.\n` +
        `Categories: ${catLines.join(", ")}`,
    });
    return;
  }

  if (commandName === "subscriptions") {
    await interaction.deferReply({ ephemeral: true });
    const subs = await prisma.notificationSubscription.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    if (!subs.length) {
      await interaction.editReply({ content: "No subscriptions yet. Use `/subscribe` in a channel." });
      return;
    }
    const lines = subs.map(
      (s) =>
        `• ${s.guildId ? `<#${s.channelId}>` : "DM"} — league \`${s.sleeperLeagueId ?? "*all*"}\` — ${s.categories.join(", ")}`,
    );
    await interaction.editReply({ content: lines.join("\n") });
    return;
  }

  if (commandName === "post-summary") {
    if (!interaction.inGuild() || !interaction.channelId) {
      await interaction.reply({ content: "Use this in a server channel.", ephemeral: true });
      return;
    }
    const me = interaction.guild?.members.me;
    const ch = interaction.channel;
    if (ch && ch.isTextBased() && "permissionsFor" in ch && me) {
      const perms = ch.permissionsFor(me);
      if (!perms?.has(PermissionFlagsBits.SendMessages)) {
        await interaction.reply({ content: "I need permission to send messages in this channel.", ephemeral: true });
        return;
      }
    }
    await interaction.deferReply({ ephemeral: true });
    const state = await sleeper.getNflState();
    const season = state.league_season ?? state.season;
    const leagues = await sleeper.getUserLeagues(user.sleeperUserId, season);
    const embed = new EmbedBuilder()
      .setTitle(`Sleeper leagues — ${interaction.user.username} (${season})`)
      .setDescription(
        leagues.length
          ? leagues.map((l) => `**${l.name}** (\`${l.league_id}\`) — ${l.status}`).join("\n")
          : "No leagues this season.",
      )
      .setFooter({ text: `Week ${state.display_week ?? state.week} · ${state.season_type}` });
    await interaction.channel?.send({ embeds: [embed] });
    await interaction.editReply({ content: "Posted." });
  }
}

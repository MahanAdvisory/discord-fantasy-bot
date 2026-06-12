import {
  ApplicationIntegrationType,
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { prisma } from "../db.js";
import { espnTeamByLeagueFromJson } from "../espn/linkedLeagues.js";
import * as sleeper from "../sleeper/client.js";
import {
  ALL_LEAGUES_SCOPE,
  DEFAULT_SUBSCRIPTION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABELS,
  isNotificationCategory,
  routeNamespaceDm,
  routeNamespaceGuild,
} from "../domain/notifications.js";
import {
  buildDraftCheckDmPages,
  buildDraftCheckGuildPages,
  buildDraftStatusDmPages,
  buildDraftStatusGuildPages,
  draftStatusCountsLine,
  linesForDraftsListEntry,
  orderDraftsForSlashList,
} from "../services/draftCheckSummary.js";
import { buildLeagueUpdatesSummary } from "../services/updatesSummary.js";
import { clearPermissionNotifiedFlagsForChannel } from "../discord/postWithPermissionHandling.js";
import { truncateDiscordReply } from "../discord/contentLimits.js";
import { log } from "../logging.js";
import {
  describePollReadiness,
  runNotificationPoll,
  triggerDraftNotificationScan,
} from "../services/notifications/runPoll.js";
import { buildFlexCheckSlashPages, runFlexCheckAcrossLeagues } from "../services/flexSlotCheck.js";
import {
  buildCheckLineupSlashPages,
  resolveLineupLeagueIdsForUser,
  runLineupCheckAcrossLeagues,
} from "../services/lineupCheck.js";

/**
 * Discord now expects `contexts` + `integration_types` on slash commands. Without them, newer apps
 * often omit commands from the picker (including `/draft-check` / `/draft-status`) in guilds and DMs.
 */
const slashCommandBuilders = [
  new SlashCommandBuilder()
    .setName("link")
    .setDescription("Link your Discord account to a Sleeper username")
    .addStringOption((o) =>
      o.setName("sleeper_username").setDescription("Your Sleeper username").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("How to link Sleeper and ESPN accounts + command quick reference"),
  new SlashCommandBuilder()
    .setName("link-espn")
    .setDescription("Save ESPN league info to your account for future ESPN adapter notifications")
    .addStringOption((o) =>
      o.setName("league_id").setDescription("ESPN league id from URL").setRequired(true),
    )
    .addStringOption((o) =>
      o.setName("season").setDescription("Season year, e.g. 2025 (optional)"),
    )
    .addIntegerOption((o) =>
      o
        .setName("team_id")
        .setDescription("Your ESPN team id in this league (optional; from roster URL teamId=)"),
    ),
  new SlashCommandBuilder()
    .setName("unlink-espn")
    .setDescription("Remove one ESPN league id from your saved ESPN links")
    .addStringOption((o) =>
      o.setName("league_id").setDescription("ESPN league id to remove").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("subscribe-espn")
    .setDescription("Subscribe this destination to ESPN league notifications")
    .addStringOption((o) =>
      o
        .setName("league_id")
        .setDescription("Optional in DM (defaults to all linked ESPN leagues); required in server"),
    )
    .addStringOption((o) =>
      o
        .setName("categories")
        .setDescription("Comma-separated category ids (transactions, waivers, draft_status, ...). Optional."),
    ),
  new SlashCommandBuilder()
    .setName("unsubscribe-espn")
    .setDescription("Remove ESPN routes (DM all/filtered, or this server channel)")
    .addStringOption((o) =>
      o.setName("league_id").setDescription("Optional league id to narrow removal"),
    )
    .addStringOption((o) =>
      o
        .setName("categories")
        .setDescription("Comma-separated category ids. Omit for all ESPN categories."),
    ),
  new SlashCommandBuilder().setName("leagues").setDescription("List your Sleeper NFL leagues (this season)"),
  new SlashCommandBuilder().setName("drafts").setDescription("List your drafts; live ones show pick # and on-the-clock team"),
  new SlashCommandBuilder()
    .setName("subscribe")
    .setDescription(
      "In a server: league id + categories. In DM: alerts for all your leagues go to your DMs",
    )
    .addStringOption((o) =>
      o
        .setName("sleeper_league_id")
        .setDescription("Required in a server (from /leagues). Not used in DM — there, all leagues are included"),
    )
    .addStringOption((o) =>
      o
        .setName("categories")
        .setDescription(
          "Comma-separated category ids (waivers, transactions, draft_on_the_clock, …). Optional.",
        ),
    ),
  new SlashCommandBuilder()
    .setName("updates")
    .setDescription("Show a snapshot of your Sleeper leagues and drafts (on-demand)"),
  new SlashCommandBuilder()
    .setName("check-lineup")
    .setDescription("Check your lineup for issues (IR in starters) and suggest a replacement")
    .addStringOption((o) =>
      o
        .setName("sleeper_league_id")
        .setDescription("Optional in server (uses channel default); in DM, optional filter to one league"),
    ),
  new SlashCommandBuilder()
    .setName("flex-check")
    .setDescription(
      "FLEX/Superflex vs dedicated slot by kickoff; suggest a swap if flex plays earlier",
    )
    .addStringOption((o) =>
      o
        .setName("sleeper_league_id")
        .setDescription("Optional in server (uses channel default); in DM, optional filter to one league"),
    ),
  new SlashCommandBuilder()
    .setName("draft-check")
    .setDescription("Fresh draft status (snake on-clock or auction block/bids); DM = all leagues")
    .addStringOption((o) =>
      o
        .setName("sleeper_league_id")
        .setDescription("Optional in server (uses channel default); in DM, optional filter to one league"),
    ),
  new SlashCommandBuilder()
    .setName("draft-status")
    .setDescription("Live drafts: pick/on-clock (snake) or auction block, high bid, last won")
    .addStringOption((o) =>
      o
        .setName("sleeper_league_id")
        .setDescription("Optional in server (uses channel default); in DM, optional filter to one league"),
    ),
  new SlashCommandBuilder()
    .setName("post-summary")
    .setDescription("Post your leagues summary to this channel (for the server feed)"),
  new SlashCommandBuilder().setName("subscriptions").setDescription("List your notification routes"),
  new SlashCommandBuilder()
    .setName("map-mention")
    .setDescription("Map a Sleeper username to a Discord user id for server alert mentions")
    .addStringOption((o) => o.setName("sleeper_username").setDescription("Sleeper username").setRequired(true))
    .addStringOption((o) => o.setName("discord_user_id").setDescription("Discord user id (or @mention)").setRequired(true)),
  new SlashCommandBuilder()
    .setName("unmap-mention")
    .setDescription("Remove Sleeper-to-Discord mention mapping for this server")
    .addStringOption((o) => o.setName("sleeper_username").setDescription("Sleeper username").setRequired(true)),
  new SlashCommandBuilder()
    .setName("unsubscribe")
    .setDescription("Remove routes: in DM (all or one league); in a server, routes for this channel")
    .addStringOption((o) =>
      o
        .setName("sleeper_league_id")
        .setDescription("Only remove routes for this league id; omit to remove all in DM or this channel"),
    )
    .addStringOption((o) =>
      o
        .setName("categories")
        .setDescription("Comma-separated category ids (e.g. transactions); omit = all categories matching above"),
    ),
  new SlashCommandBuilder()
    .setName("route-test")
    .setDescription("Post a test message here; clears permission-warning flags after a prior error"),
  new SlashCommandBuilder()
    .setName("poll-now")
    .setDescription("Run one notification poll cycle now (DM ok; server needs Manage Server)")
    .addBooleanOption((o) =>
      o
        .setName("replay")
        .setDescription("Reset poll cursor before running (replays latest week transactions)"),
    )
    .addStringOption((o) =>
      o
        .setName("sleeper_league_id")
        .setDescription("Optional league id for replay reset scope; omit to reset all leagues"),
    ),
];

export const commands = slashCommandBuilders.map((b) =>
  b
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    )
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
    .toJSON(),
);

function parseCategories(raw: string | null): string[] {
  if (!raw?.trim()) return [...DEFAULT_SUBSCRIPTION_CATEGORIES];
  const parts = raw.split(",").map((s) => s.trim().toLowerCase());
  const out: string[] = [];
  for (const p of parts) {
    if (isNotificationCategory(p)) out.push(p);
  }
  return out.length ? out : [...DEFAULT_SUBSCRIPTION_CATEGORIES];
}

/**
 * Slash in a DM: `interaction.channel` is sometimes missing even though `guildId` is null.
 * `inGuild()` is the reliable discriminator for routing subscribe / draft-check|draft-status / unsubscribe.
 */
function slashIsDm(interaction: ChatInputCommandInteraction): boolean {
  return !interaction.inGuild();
}

/** Ephemeral in guilds only; DMs use normal (non-ephemeral) responses. */
export function slashEphemeral(interaction: ChatInputCommandInteraction): { flags: MessageFlags.Ephemeral } | Record<string, never> {
  return interaction.inGuild() ? { flags: MessageFlags.Ephemeral } : {};
}

function parseCategoriesFilter(
  raw: string | null,
): { ok: true; categories: string[] | null } | { ok: false; error: string } {
  if (!raw?.trim()) return { ok: true, categories: null };
  const parts = raw.split(",").map((s) => s.trim().toLowerCase());
  const out: string[] = [];
  for (const p of parts) {
    if (isNotificationCategory(p)) out.push(p);
  }
  if (out.length === 0) {
    return {
      ok: false,
      error:
        "No valid category ids in `categories`. Examples: `transactions`, `draft_status`, `draft_on_the_clock`.",
    };
  }
  return { ok: true, categories: out };
}

async function resolveGuildDefaultLeagueForChannel(
  guildId: string,
  channelId: string,
): Promise<{ leagueId: string | null; ambiguous: string[] }> {
  const rows = await prisma.notificationSubscription.findMany({
    where: {
      isDm: false,
      guildId,
      channelId,
      sleeperLeagueScope: { not: ALL_LEAGUES_SCOPE },
    },
    select: { sleeperLeagueScope: true },
  });
  const unique = [...new Set(rows.map((r) => r.sleeperLeagueScope).filter(Boolean))];
  if (!unique.length) return { leagueId: null, ambiguous: [] };
  if (unique.length === 1) return { leagueId: unique[0], ambiguous: [] };
  return { leagueId: null, ambiguous: unique };
}

export async function handleInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
  const { commandName } = interaction;
  let user: Awaited<ReturnType<typeof prisma.user.findUnique>> = null;
  if (
    !interaction.inGuild() &&
    commandName !== "link" &&
    commandName !== "help" &&
    commandName !== "link-espn" &&
    commandName !== "unlink-espn" &&
    commandName !== "subscribe-espn" &&
    commandName !== "unsubscribe-espn" &&
    commandName !== "leagues" &&
    commandName !== "drafts" &&
    commandName !== "subscriptions" &&
    commandName !== "map-mention" &&
    commandName !== "unmap-mention" &&
    commandName !== "subscribe" &&
    commandName !== "unsubscribe" &&
    commandName !== "updates" &&
    commandName !== "check-lineup" &&
    commandName !== "flex-check" &&
    commandName !== "draft-check" &&
    commandName !== "draft-status" &&
    commandName !== "poll-now"
  ) {
    await interaction.reply({ content: "Use this command in a server.", ...slashEphemeral(interaction) });
    return;
  }

  if (commandName === "route-test") {
    if (!interaction.inGuild() || !interaction.channel) {
      await interaction.reply({
        ...slashEphemeral(interaction),
        content: "Use **/route-test** in a server text channel (where notifications should post).",
      });
      return;
    }
    const ch = interaction.channel;
    if (ch.type !== ChannelType.GuildText && ch.type !== ChannelType.PublicThread) {
      await interaction.reply({ content: "Use a text channel or thread.", ...slashEphemeral(interaction) });
      return;
    }
    const me = interaction.guild?.members.me;
    if (ch.isTextBased() && "permissionsFor" in ch && me) {
      const perms = ch.permissionsFor(me);
      if (!perms?.has(PermissionFlagsBits.SendMessages)) {
        await interaction.reply({
          ...slashEphemeral(interaction),
          content: "I don’t have **Send Messages** in this channel yet.",
        });
        return;
      }
    }
    await interaction.deferReply({ ...slashEphemeral(interaction) });
    const flagsBefore = await prisma.notificationSubscription.count({
      where: { channelId: ch.id, isDm: false, permissionNotifiedAt: { not: null } },
    });
    try {
      await ch.send({
        content:
          "**Notification route test** — delivery works. You can delete this message. " +
          "_(Permission-warning flags for this channel were cleared.)_",
      });
    } catch (e) {
      const err = e as { code?: number; message?: string };
      await interaction.editReply({
        content:
          `Could not post here (**${err?.code ?? "?"}** ${err?.message ?? String(e)}). ` +
          `If this is a private channel, add the bot (or its role) under channel permissions.`,
      });
      return;
    }
    await clearPermissionNotifiedFlagsForChannel(ch.id);
    const routesHere = await prisma.notificationSubscription.count({
      where: { channelId: ch.id, isDm: false },
    });
    await interaction.editReply({
      content:
        `**Success.** Test message posted. Cleared **${flagsBefore}** permission-warning flag(s); ` +
        `**${routesHere}** route(s) target this channel. The next delivery failure will DM route owners again.`,
    });
    return;
  }

  if (commandName === "poll-now") {
    const isDm = slashIsDm(interaction);
    if (!isDm) {
      const canRun = Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
      if (!canRun) {
        await interaction.reply({
          ...slashEphemeral(interaction),
          content: "You need **Manage Server** to run this command in a server. You can also run it in a **DM** with the bot.",
        });
        return;
      }
    }
    await interaction.deferReply({ ...slashEphemeral(interaction) });
    const started = Date.now();
    try {
      const before = await describePollReadiness();
      const replay = interaction.options.getBoolean("replay") ?? false;
      const replayLeagueId = interaction.options.getString("sleeper_league_id")?.trim() ?? null;
      let resetCount = 0;
      if (replay) {
        const state = await sleeper.getNflState();
        const season = state.league_season ?? state.season;
        const week = Math.max(1, state.leg ?? state.display_week ?? state.week ?? 1);
        const result = await prisma.leaguePollCursor.deleteMany({
          where: {
            season,
            week,
            ...(replayLeagueId ? { leagueId: replayLeagueId } : {}),
          },
        });
        resetCount = result.count;
      }
      await runNotificationPoll(interaction.client, {
        forceReplayLeagueIds: replay ? new Set(replayLeagueId ? [replayLeagueId] : []) : undefined,
      });
      const ms = Date.now() - started;
      const readiness =
        `**Poll readiness** (Sleeper NFL ${before.season} week ${before.week}): ` +
        `**${before.subscriptionCount}** route(s) (${before.dmRouteCount} DM, ${before.channelRouteCount} channel), ` +
        `**${before.leagueCount}** league(s) to scan` +
        (before.sampleLeagueIds.length
          ? ` (e.g. \`${before.sampleLeagueIds.join("`, `")}\`)`
          : "") +
        ".\n";
      const replayNote = replay
        ? `Replay reset removed **${resetCount}** cursor row(s)` +
          `${replayLeagueId ? ` for league \`${replayLeagueId}\`` : " across all leagues"}.`
        : "";
      await interaction.editReply({
        content:
          readiness +
          `Poll cycle completed in **${ms}ms**. ${replayNote}\n` +
          (before.subscriptionCount === 0
            ? "No routes in this database — run **/link** and **/subscribe** on this bot (Railway uses a separate DB from local dev)."
            : before.leagueCount === 0
              ? "Routes exist but no Sleeper leagues resolved — confirm **/link** username and NFL season."
              : isDm
                ? "If nothing landed in your DMs, check Railway logs for `poll_tx_scan`, `poll_tx_emit`, and `deliver_notification_dm_failed`."
                : "If nothing posted, check Railway logs for `poll_tx_scan` (new activity) vs `poll_tx_emit` (fan-out) vs `deliver_notification_*_failed` (Discord delivery)."),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await interaction.editReply({
        content: `Poll cycle failed: ${msg}`.slice(0, 2000),
      });
    }
    return;
  }

  if (commandName === "link") {
    const username = interaction.options.getString("sleeper_username", true).trim();
    await interaction.deferReply({ ...slashEphemeral(interaction) });
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

  if (commandName === "help") {
    const appBase = process.env.BILLING_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const helpUrl = `${appBase.replace(/\/$/, "")}/help`;
    const lines = [
      "**Account linking help**",
      "",
      "1) Sleeper: run `/link sleeper_username:<your sleeper username>`",
      "2) ESPN: run `/link-espn league_id:<id> season:<year> team_id:<id>` (season / team_id optional)",
      "3) Web form: open " + helpUrl + " to save Sleeper/ESPN details in one place",
      "",
      "**Useful commands**",
      "• `/subscriptions` — view your active routes",
      "• `/subscribe` / `/unsubscribe` — manage league/category notifications",
      "• `/subscribe-espn` / `/unsubscribe-espn` — manage ESPN routes",
      "• `/unlink-espn league_id:<id>` — remove saved ESPN league",
    ];
    await interaction.reply({ content: lines.join("\n").slice(0, 2000), ...slashEphemeral(interaction) });
    return;
  }

  if (commandName === "link-espn") {
    user = await prisma.user.upsert({
      where: { discordUserId: interaction.user.id },
      create: { discordUserId: interaction.user.id },
      update: {},
    });
    const leagueId = interaction.options.getString("league_id", true).trim();
    const seasonOpt = interaction.options.getString("season")?.trim();
    const season = seasonOpt && /^\d{4}$/.test(seasonOpt) ? seasonOpt : undefined;
    const teamIdOpt = interaction.options.getInteger("team_id");
    const current = (user as { espnLeagueIds?: unknown }).espnLeagueIds;
    const existing = Array.isArray(current) ? current.filter((x): x is string => typeof x === "string") : [];
    const next = [...new Set([...existing, leagueId])];
    const teamMap = espnTeamByLeagueFromJson((user as { espnTeamByLeague?: unknown }).espnTeamByLeague);
    if (teamIdOpt != null) teamMap[leagueId] = teamIdOpt;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        espnLeagueIds: next,
        ...(season ? { espnSeason: season } : {}),
        ...(teamIdOpt != null ? { espnTeamByLeague: teamMap } : {}),
      },
    });
    await interaction.reply({
      ...slashEphemeral(interaction),
      content:
        `Saved ESPN league \`${leagueId}\`${season ? ` for season **${season}**` : ""}` +
        (teamIdOpt != null ? ` · team **${teamIdOpt}**` : "") +
        `. You now have ${next.length} ESPN league id(s) linked.`,
    });
    return;
  }

  if (commandName === "unlink-espn") {
    user = await prisma.user.upsert({
      where: { discordUserId: interaction.user.id },
      create: { discordUserId: interaction.user.id },
      update: {},
    });
    const leagueId = interaction.options.getString("league_id", true).trim();
    const current = (user as { espnLeagueIds?: unknown }).espnLeagueIds;
    const existing = Array.isArray(current) ? current.filter((x): x is string => typeof x === "string") : [];
    const next = existing.filter((id) => id !== leagueId);
    const teamMap = espnTeamByLeagueFromJson((user as { espnTeamByLeague?: unknown }).espnTeamByLeague);
    delete teamMap[leagueId];
    await prisma.user.update({
      where: { id: user.id },
      data: { espnLeagueIds: next, espnTeamByLeague: teamMap },
    });
    await interaction.reply({
      ...slashEphemeral(interaction),
      content: `Removed ESPN league \`${leagueId}\`. Remaining linked ESPN league ids: **${next.length}**.`,
    });
    return;
  }

  if (commandName === "subscribe-espn") {
    user = await prisma.user.upsert({
      where: { discordUserId: interaction.user.id },
      create: { discordUserId: interaction.user.id },
      update: {},
    });
    const isDm = slashIsDm(interaction);
    const ch = interaction.channel;
    if (!isDm) {
      if (!ch) {
        await interaction.reply({ ...slashEphemeral(interaction), content: "Could not resolve this channel." });
        return;
      }
      if (ch.type !== ChannelType.GuildText && ch.type !== ChannelType.PublicThread) {
        await interaction.reply({ content: "Use a text channel or thread.", ...slashEphemeral(interaction) });
        return;
      }
    }
    const leagueOpt = interaction.options.getString("league_id")?.trim() ?? null;
    const categories = parseCategories(interaction.options.getString("categories"));
    const userEspn = user as unknown as { espnLeagueIds?: unknown };
    const linkedEspnLeagueIds = Array.isArray(userEspn.espnLeagueIds)
      ? userEspn.espnLeagueIds.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : [];
    if (!linkedEspnLeagueIds.length) {
      await interaction.reply({
        ...slashEphemeral(interaction),
        content: "No ESPN leagues linked yet. Use `/link-espn` or `/help` and web help page first.",
      });
      return;
    }
    if (!isDm && !leagueOpt) {
      await interaction.reply({
        ...slashEphemeral(interaction),
        content: "In a server, `league_id` is required for `/subscribe-espn`.",
      });
      return;
    }
    const scopeRaw = leagueOpt ?? ALL_LEAGUES_SCOPE;
    if (leagueOpt && !linkedEspnLeagueIds.includes(leagueOpt)) {
      await interaction.reply({
        ...slashEphemeral(interaction),
        content: `League \`${leagueOpt}\` is not in your saved ESPN league ids. Link it with \`/link-espn\` first.`,
      });
      return;
    }
    const scope = `espn:${scopeRaw}`;
    const routeNs = isDm ? routeNamespaceDm(user.id) : routeNamespaceGuild(interaction.guildId!);
    const guildId = isDm ? null : interaction.guildId!;
    const channelId = isDm ? null : interaction.channelId;
    const created: string[] = [];
    const skipped: string[] = [];
    for (const cat of categories) {
      const existing = await prisma.notificationSubscription.findUnique({
        where: {
          routeNamespace_sleeperLeagueScope_category: {
            routeNamespace: routeNs,
            sleeperLeagueScope: scope,
            category: cat,
          },
        },
      });
      if (existing) {
        skipped.push(cat);
        continue;
      }
      await prisma.notificationSubscription.create({
        data: {
          userId: user.id,
          guildId,
          channelId,
          isDm,
          routeNamespace: routeNs,
          provider: "espn",
          sleeperLeagueScope: scope,
          category: cat,
        },
      });
      created.push(cat);
    }
    const scopeLabel = scopeRaw === ALL_LEAGUES_SCOPE ? "*all linked ESPN leagues*" : `\`${scopeRaw}\``;
    await interaction.reply({
      ...slashEphemeral(interaction),
      content:
        `ESPN routes updated for ${isDm ? "DM" : `<#${channelId}>`} · scope ${scopeLabel}\n` +
        (created.length ? `Added: ${created.join(", ")}\n` : "") +
        (skipped.length ? `Already set: ${skipped.join(", ")}` : ""),
    });
    return;
  }

  if (commandName === "unsubscribe-espn") {
    user = await prisma.user.upsert({
      where: { discordUserId: interaction.user.id },
      create: { discordUserId: interaction.user.id },
      update: {},
    });
    const isDm = slashIsDm(interaction);
    const catParsed = parseCategoriesFilter(interaction.options.getString("categories"));
    if (!catParsed.ok) {
      await interaction.reply({ content: catParsed.error, ...slashEphemeral(interaction) });
      return;
    }
    const leagueOpt = interaction.options.getString("league_id")?.trim() ?? null;
    const scope = leagueOpt ? `espn:${leagueOpt}` : undefined;
    const result = await prisma.notificationSubscription.deleteMany({
      where: {
        userId: user.id,
        provider: "espn",
        isDm,
        ...(isDm ? {} : { guildId: interaction.guildId!, channelId: interaction.channelId }),
        ...(scope ? { sleeperLeagueScope: scope } : {}),
        ...(catParsed.categories ? { category: { in: catParsed.categories } } : {}),
      },
    });
    await interaction.reply({
      ...slashEphemeral(interaction),
      content: `Removed **${result.count}** ESPN route(s).`,
    });
    return;
  }

  /** Discord requires an initial response within ~3s; Prisma can exceed that on cold start or slow DB. */
  const deferBeforeUserLookup =
    commandName === "check-lineup" || commandName === "flex-check" || commandName === "updates";
  if (deferBeforeUserLookup) {
    await interaction.deferReply({ ...slashEphemeral(interaction) });
  }

  if (!user) {
    user = await prisma.user.findUnique({ where: { discordUserId: interaction.user.id } });
  }
  if (!user?.sleeperUserId) {
    if (deferBeforeUserLookup) {
      await interaction.editReply({ content: "Run `/link` with your Sleeper username first." });
    } else {
      await interaction.reply({ content: "Run `/link` with your Sleeper username first.", ...slashEphemeral(interaction) });
    }
    return;
  }
  const sleeperUserId = user.sleeperUserId;

  if (commandName === "updates") {
    try {
      const summary = await buildLeagueUpdatesSummary(sleeperUserId);
      await interaction.editReply({
        content: truncateDiscordReply("", summary.split("\n")),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load updates";
      await interaction.editReply({ content: msg });
    }
    return;
  }

  if (commandName === "check-lineup") {
    const isDm = slashIsDm(interaction);
    const leagueOpt = interaction.options.getString("sleeper_league_id")?.trim() ?? null;
    try {
      let leagueIds: string[] = [];
      if (leagueOpt) {
        leagueIds = [leagueOpt];
      } else {
        const resolved = await resolveLineupLeagueIdsForUser({
          userId: user.id,
          sleeperUserId,
          isDm,
          guildId: interaction.guildId,
          channelId: interaction.channelId,
        });
        if (resolved.ambiguous.length) {
          await interaction.editReply({
            content:
              "This channel has multiple notification routes with different Sleeper leagues, so `sleeper_league_id` is required for `/check-lineup`. " +
              `Found: ${resolved.ambiguous.map((id) => `\`${id}\``).join(", ")}`,
          });
          return;
        }
        leagueIds = resolved.leagueIds;
      }

      if (!leagueIds.length) {
        await interaction.editReply({
          content:
            "No league notification routes found for this destination yet (or none that apply to lineup checks). " +
            "Run `/subscribe` from **DM** (all your leagues) or from a **server channel** with `sleeper_league_id`.",
        });
        return;
      }

      const report = await runLineupCheckAcrossLeagues(sleeperUserId, leagueIds);
      const pages = buildCheckLineupSlashPages(report);
      const first = truncateDiscordReply("", (pages[0] ?? "_No lineup information to show._").split("\n"));
      await interaction.editReply({ content: first });
      for (const page of pages.slice(1)) {
        await interaction.followUp({
          content: truncateDiscordReply("", page.split("\n")),
          ...slashEphemeral(interaction),
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Lineup check failed";
      await interaction.editReply({ content: msg });
    }
    return;
  }

  if (commandName === "flex-check") {
    const isDm = slashIsDm(interaction);
    const leagueOpt = interaction.options.getString("sleeper_league_id")?.trim() ?? null;
    try {
      const nfl = await sleeper.getNflState();
      const week = Math.max(0, nfl.display_week ?? nfl.leg ?? nfl.week ?? 0);
      if (nfl.season_type !== "regular" || week < 1) {
        await interaction.editReply({
          content:
            "**`/flex-check`** uses live NFL kickoff times and only applies during the **regular season** when games are scheduled.",
        });
        return;
      }

      let leagueIds: string[] = [];
      if (leagueOpt) {
        leagueIds = [leagueOpt];
      } else {
        const resolved = await resolveLineupLeagueIdsForUser({
          userId: user.id,
          sleeperUserId,
          isDm,
          guildId: interaction.guildId,
          channelId: interaction.channelId,
        });
        if (resolved.ambiguous.length) {
          await interaction.editReply({
            content:
              "This channel has multiple notification routes with different Sleeper leagues, so `sleeper_league_id` is required for `/flex-check`. " +
              `Found: ${resolved.ambiguous.map((id) => `\`${id}\``).join(", ")}`,
          });
          return;
        }
        leagueIds = resolved.leagueIds;
      }

      if (!leagueIds.length) {
        await interaction.editReply({
          content:
            "No league notification routes found for this destination yet. Run `/subscribe` from **DM** or a **server channel** with `sleeper_league_id`.",
        });
        return;
      }

      const report = await runFlexCheckAcrossLeagues(sleeperUserId, leagueIds, nfl);
      const pages = buildFlexCheckSlashPages(report);
      const first = truncateDiscordReply("", (pages[0] ?? "_No flex check results._").split("\n"));
      await interaction.editReply({ content: first });
      for (const page of pages.slice(1)) {
        await interaction.followUp({
          content: truncateDiscordReply("", page.split("\n")),
          ...slashEphemeral(interaction),
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Flex check failed";
      await interaction.editReply({ content: msg });
    }
    return;
  }

  if (commandName === "draft-check" || commandName === "draft-status") {
    const isDm = slashIsDm(interaction);
    const leagueOpt = interaction.options.getString("sleeper_league_id")?.trim() ?? null;
    let leagueId = leagueOpt;

    if (!isDm) {
      if (!leagueId) {
        const fallback = await resolveGuildDefaultLeagueForChannel(interaction.guildId!, interaction.channelId);
        if (fallback.ambiguous.length) {
          await interaction.reply({
            ...slashEphemeral(interaction),
            content:
              "This channel has multiple league routes configured, so `sleeper_league_id` is required for this command. " +
              `Found: ${fallback.ambiguous.map((id) => `\`${id}\``).join(", ")}`,
          });
          return;
        }
        if (!fallback.leagueId) {
          await interaction.reply({
            ...slashEphemeral(interaction),
            content:
              "No default league is routed to this channel yet. Run `/subscribe sleeper_league_id:<id>` first, or pass `sleeper_league_id` directly.",
          });
          return;
        }
        leagueId = fallback.leagueId;
      }
    }

    await interaction.deferReply({ ...slashEphemeral(interaction) });
    try {
      const canBypassMembership =
        !isDm && Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
      const sendPagedReply = async (pages: string[]): Promise<void> => {
        const first = truncateDiscordReply("", (pages[0] ?? "_No draft information to show._").split("\n"));
        await interaction.editReply({ content: first });
        for (const p of pages.slice(1)) {
          const content = truncateDiscordReply("", p.split("\n"));
          await interaction.followUp({ content, ...slashEphemeral(interaction) });
        }
      };
      if (commandName === "draft-status") {
        const pages = isDm
          ? await buildDraftStatusDmPages(sleeperUserId, leagueId, 4)
          : await buildDraftStatusGuildPages(sleeperUserId, leagueId!, {
              allowNonMember: canBypassMembership,
              activePerPage: 4,
            });
        await sendPagedReply(pages);
      } else {
        const pages = isDm
          ? await buildDraftCheckDmPages(sleeperUserId, leagueId, 4)
          : await buildDraftCheckGuildPages(sleeperUserId, leagueId!, {
              allowNonMember: canBypassMembership,
              activePerPage: 4,
            });
        await sendPagedReply(pages);
      }
      if (commandName === "draft-check") {
        const state = await sleeper.getNflState();
        const season = state.league_season ?? state.season;
        if (isDm) {
          const leagueIds = leagueId
            ? [leagueId]
            : [...new Set((await sleeper.getUserLeagues(sleeperUserId, season)).map((l) => l.league_id))];
          for (const lid of leagueIds) {
            await triggerDraftNotificationScan(interaction.client, lid).catch((err) =>
              log.error("draft_check_fanout_failed", {
                leagueId: lid,
                err: err instanceof Error ? err.message : String(err),
              }),
            );
          }
        } else if (leagueId) {
          await triggerDraftNotificationScan(interaction.client, leagueId).catch((err) =>
            log.error("draft_check_fanout_failed", {
              leagueId,
              err: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      }
    } catch (e) {
      log.error("draft_check_command_failed", { err: e instanceof Error ? e.message : String(e) });
      const msg = e instanceof Error ? e.message : "Draft check failed";
      await interaction.editReply({
        content: msg.slice(0, 2000) || "Draft check failed — see bot logs.",
      });
    }
    return;
  }

  if (commandName === "leagues" || commandName === "drafts") {
    await interaction.deferReply({ ...slashEphemeral(interaction) });
    const state = await sleeper.getNflState();
    const season = state.league_season ?? state.season;
    try {
      if (commandName === "leagues") {
        const leagues = await sleeper.getUserLeagues(sleeperUserId, season);
        if (!leagues.length) {
          await interaction.editReply({ content: `No leagues for season **${season}**.` });
          return;
        }
        const lines = leagues.map(
          (l) => `• **${l.name}** — \`${l.league_id}\` — _${l.status}_`,
        );
        await interaction.editReply({
          content: truncateDiscordReply(`**Leagues (${season})**`, lines),
        });
      } else {
        const drafts = await sleeper.getUserDrafts(sleeperUserId, season);
        if (!drafts.length) {
          await interaction.editReply({ content: `No drafts for season **${season}**.` });
          return;
        }
        const ordered = await orderDraftsForSlashList(drafts, sleeperUserId);
        const lineGroups = await Promise.all(
          ordered.map(({ draft, onClock }) =>
            linesForDraftsListEntry(draft, sleeperUserId, { onClock }),
          ),
        );
        const lines = lineGroups.flat();
        const footer = draftStatusCountsLine(drafts);
        if (footer) {
          lines.push("");
          lines.push(footer);
        }
        await interaction.editReply({
          content: truncateDiscordReply(`**Drafts (${season})**`, lines),
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sleeper request failed";
      await interaction.editReply({ content: msg });
    }
    return;
  }

  if (commandName === "subscribe") {
    const isDm = slashIsDm(interaction);
    const ch = interaction.channel;

    if (!isDm) {
      if (!ch) {
        await interaction.reply({
          ...slashEphemeral(interaction),
          content: "Could not resolve this channel. Try `/subscribe` again from a server **text channel**.",
        });
        return;
      }
      if (ch.type !== ChannelType.GuildText && ch.type !== ChannelType.PublicThread) {
        await interaction.reply({ content: "Use a text channel or thread.", ...slashEphemeral(interaction) });
        return;
      }
    }

    const leagueOpt = interaction.options.getString("sleeper_league_id");
    const categories = parseCategories(interaction.options.getString("categories"));

    let scope: string;
    let routeNs: string;
    let guildId: string | null = null;
    let channelId: string | null = null;
    let usingModLeagueBypass = false;

    if (isDm) {
      scope = leagueOpt?.trim() || ALL_LEAGUES_SCOPE;
      routeNs = routeNamespaceDm(user.id);
      if (scope !== ALL_LEAGUES_SCOPE) {
        try {
          await sleeper.getLeague(scope);
        } catch {
          await interaction.reply({ content: `League \`${scope}\` not found on Sleeper.`, ...slashEphemeral(interaction) });
          return;
        }
      }
    } else {
      const state = await sleeper.getNflState();
      const season = state.league_season ?? state.season;
      const userLeagues = await sleeper.getUserLeagues(sleeperUserId, season);
      const leagueIds = new Set(userLeagues.map((l) => l.league_id));

      const canSubscribeForeignLeague =
        interaction.inGuild() && Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));

      if (!leagueOpt?.trim()) {
        await interaction.reply({
          ...slashEphemeral(interaction),
          content:
            "In a server, **sleeper_league_id** is required. Run `/leagues`, copy your league id, then e.g. `/subscribe sleeper_league_id:289646328504385536 categories:transactions,waivers`",
        });
        return;
      }
      scope = leagueOpt.trim();
      usingModLeagueBypass = !leagueIds.has(scope) && canSubscribeForeignLeague;
      if (!leagueIds.has(scope) && !canSubscribeForeignLeague) {
        await interaction.reply({
          ...slashEphemeral(interaction),
          content:
            `You are not in league \`${scope}\` for season **${season}**. Use \`/leagues\` to verify. ` +
            `Members with **Manage Server** can subscribe this channel to any **existing** Sleeper league id (shared feed / fans / alt accounts).`,
        });
        return;
      }
      try {
        await sleeper.getLeague(scope);
      } catch {
        await interaction.reply({ content: `League \`${scope}\` not found on Sleeper.`, ...slashEphemeral(interaction) });
        return;
      }
      guildId = interaction.guildId!;
      channelId = interaction.channelId;
      routeNs = routeNamespaceGuild(guildId);
    }

    const created: string[] = [];
    const skipped: string[] = [];
    const blocked: string[] = [];

    for (const cat of categories) {
      const existing = await prisma.notificationSubscription.findUnique({
        where: {
          routeNamespace_sleeperLeagueScope_category: {
            routeNamespace: routeNs,
            sleeperLeagueScope: scope,
            category: cat,
          },
        },
      });
      if (existing) {
        if (isDm) {
          skipped.push(cat);
          continue;
        }
        if (existing.channelId === channelId) {
          skipped.push(cat);
        } else {
          blocked.push(
            `${NOTIFICATION_CATEGORY_LABELS[cat as keyof typeof NOTIFICATION_CATEGORY_LABELS] ?? cat} → <#${existing.channelId}>`,
          );
        }
        continue;
      }
      await prisma.notificationSubscription.create({
        data: {
          userId: user.id,
          guildId,
          channelId,
          isDm: isDm,
          routeNamespace: routeNs,
          sleeperLeagueScope: scope,
          category: cat,
        },
      });
      created.push(cat);
    }

    const catLabels = (c: string) => NOTIFICATION_CATEGORY_LABELS[c as keyof typeof NOTIFICATION_CATEGORY_LABELS] ?? c;
    const destLabel = isDm ? "your DMs" : `<#${channelId}>`;
    const scopeLabel = scope === ALL_LEAGUES_SCOPE ? "*all your leagues*" : `\`${scope}\``;
    let msg =
      `**Routes** → ${destLabel} · scope ${scopeLabel}\n` +
      (created.length ? `Added: ${created.map(catLabels).join(", ")}\n` : "") +
      (skipped.length ? `Already set: ${skipped.map(catLabels).join(", ")}\n` : "");
    if (blocked.length) {
      msg +=
        `\n**Conflict:** these categories already route to another channel in this server:\n` +
        blocked.map((b) => `• ${b}`).join("\n");
    }
    if (!isDm && usingModLeagueBypass) {
      msg +=
        "\n_Note: this Sleeper league is not on your linked account; **Manage Server** was used to authorize the route._";
    }
    await interaction.reply({ content: msg.slice(0, 2000), ...slashEphemeral(interaction) });
    return;
  }

  if (commandName === "unsubscribe") {
    const isDm = slashIsDm(interaction);
    const ch = interaction.channel;

    if (!isDm) {
      if (!ch) {
        await interaction.reply({
          ...slashEphemeral(interaction),
          content:
            "Could not resolve this channel. Try `/unsubscribe` again from a server **text channel** or in **DM** with the bot.",
        });
        return;
      }
      if (ch.type !== ChannelType.GuildText && ch.type !== ChannelType.PublicThread) {
        await interaction.reply({ content: "Use a text channel or thread.", ...slashEphemeral(interaction) });
        return;
      }
    }

    const leagueOpt = interaction.options.getString("sleeper_league_id");
    const catParsed = parseCategoriesFilter(interaction.options.getString("categories"));
    if (!catParsed.ok) {
      await interaction.reply({ content: catParsed.error, ...slashEphemeral(interaction) });
      return;
    }

    const where: {
      userId: string;
      isDm: boolean;
      guildId?: string | null;
      channelId?: string | null;
      sleeperLeagueScope?: string;
      category?: { in: string[] };
    } = {
      userId: user.id,
      isDm,
    };

    if (!isDm) {
      where.guildId = interaction.guildId!;
      where.channelId = interaction.channelId;
    }

    if (leagueOpt?.trim()) {
      where.sleeperLeagueScope = leagueOpt.trim();
    }

    if (catParsed.categories) {
      where.category = { in: catParsed.categories };
    }

    const result = await prisma.notificationSubscription.deleteMany({ where });

    const leagueHint = leagueOpt?.trim() ? `league \`${leagueOpt.trim()}\`` : "all leagues / scopes";
    const catHint = catParsed.categories?.length
      ? `categories: ${catParsed.categories.join(", ")}`
      : "all categories";
    const place = isDm ? "your **DM** routes" : `this channel (<#${interaction.channelId}>)`;

    await interaction.reply({
      ...slashEphemeral(interaction),
      content:
        `Removed **${result.count}** route(s) from ${place} (${leagueHint}; ${catHint}). ` +
        `Use \`/subscriptions\` to see what’s left.`,
    });
    return;
  }

  if (commandName === "subscriptions") {
    await interaction.deferReply({ ...slashEphemeral(interaction) });
    const subs = await prisma.notificationSubscription.findMany({
      where: { userId: user.id },
      orderBy: [{ guildId: "asc" }, { sleeperLeagueScope: "asc" }, { category: "asc" }],
    });
    if (!subs.length) {
      await interaction.editReply({ content: "No routes yet. Use `/subscribe` (channel or DM)." });
      return;
    }
    const lines = subs.map((s) => {
      const dest = s.isDm ? "DM" : s.channelId ? `<#${s.channelId}>` : "?";
      const scope =
        s.sleeperLeagueScope === ALL_LEAGUES_SCOPE
          ? "*all leagues*"
          : s.sleeperLeagueScope === `espn:${ALL_LEAGUES_SCOPE}`
            ? "*all ESPN leagues*"
            : `\`${s.sleeperLeagueScope}\``;
      const label = NOTIFICATION_CATEGORY_LABELS[s.category as keyof typeof NOTIFICATION_CATEGORY_LABELS] ?? s.category;
      return `• [${s.provider}] ${label} → ${dest} · league ${scope}`;
    });
    await interaction.editReply({
      content: truncateDiscordReply("**Your notification routes**", lines),
    });
    return;
  }

  if (commandName === "map-mention" || commandName === "unmap-mention") {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: "Use this command in a server.", ...slashEphemeral(interaction) });
      return;
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: "You need **Manage Server** for this command.", ...slashEphemeral(interaction) });
      return;
    }
    const sleeperUsername = interaction.options.getString("sleeper_username", true).trim();
    const sleeperUser = await sleeper.getUserByUsername(sleeperUsername);
    if (!sleeperUser?.user_id) {
      await interaction.reply({ content: `No Sleeper user found for **${sleeperUsername}**.`, ...slashEphemeral(interaction) });
      return;
    }
    if (commandName === "unmap-mention") {
      await prisma.sleeperMentionMapping.deleteMany({
        where: { guildId: interaction.guildId!, sleeperUserId: sleeperUser.user_id },
      });
      await interaction.reply({
        ...slashEphemeral(interaction),
        content: `Removed mapping for Sleeper **${sleeperUser.username}** in this server.`,
      });
      return;
    }
    const rawDiscord = interaction.options.getString("discord_user_id", true).trim();
    const discordUserId = rawDiscord.replace(/[<@!>]/g, "");
    if (!/^\d{8,}$/.test(discordUserId)) {
      await interaction.reply({ ...slashEphemeral(interaction), content: "Provide a valid Discord user id or mention." });
      return;
    }
    await prisma.sleeperMentionMapping.upsert({
      where: {
        guildId_sleeperUserId: {
          guildId: interaction.guildId!,
          sleeperUserId: sleeperUser.user_id,
        },
      },
      create: {
        userId: user.id,
        guildId: interaction.guildId!,
        sleeperUserId: sleeperUser.user_id,
        discordUserId,
      },
      update: { discordUserId, userId: user.id },
    });
    await interaction.reply({
      ...slashEphemeral(interaction),
      content: `Mapped Sleeper **${sleeperUser.username}** to <@${discordUserId}> for this server.`,
    });
    return;
  }

  if (commandName === "post-summary") {
    if (!interaction.inGuild() || !interaction.channelId) {
      await interaction.reply({ content: "Use this in a server channel.", ...slashEphemeral(interaction) });
      return;
    }
    const me = interaction.guild?.members.me;
    const ch = interaction.channel;
    if (ch && ch.isTextBased() && "permissionsFor" in ch && me) {
      const perms = ch.permissionsFor(me);
      if (!perms?.has(PermissionFlagsBits.SendMessages)) {
        await interaction.reply({
          content: "I need permission to send messages in this channel.",
          ...slashEphemeral(interaction),
        });
        return;
      }
    }
    await interaction.deferReply({ ...slashEphemeral(interaction) });
    const state = await sleeper.getNflState();
    const season = state.league_season ?? state.season;
    const leagues = await sleeper.getUserLeagues(sleeperUserId, season);
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

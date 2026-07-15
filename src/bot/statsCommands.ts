import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
  type AutocompleteInteraction,
} from "discord.js";
import {
  autocompletePlayerNames,
  findPlayerStats,
  queryLeaderboard,
  scoringFromOptions,
} from "../services/stats/leaderboardQuery.js";
import {
  LEADER_METRICS,
  buildLeadersEmbed,
  buildPlayerStatsEmbed,
  type PlayerStatsScope,
} from "../services/stats/discordReports.js";
import { log } from "../logging.js";

function replyFlags(visibility: string | null): { flags?: MessageFlags.Ephemeral } {
  const wantPrivate = (visibility ?? "private").toLowerCase() === "private";
  if (wantPrivate) return { flags: MessageFlags.Ephemeral };
  return {};
}

export const playerStatsCommand = new SlashCommandBuilder()
  .setName("player-stats")
  .setDescription("nflverse fantasy stats for one player (receiving / rushing / passing / summary)")
  .addStringOption((o) =>
    o.setName("player").setDescription("Player name").setRequired(true).setAutocomplete(true),
  )
  .addIntegerOption((o) => o.setName("season").setDescription("Season year (e.g. 2025)").setRequired(true))
  .addStringOption((o) =>
    o
      .setName("scope")
      .setDescription("Which stat package to show")
      .addChoices(
        { name: "Receiving", value: "receiving" },
        { name: "Rushing", value: "rushing" },
        { name: "Passing", value: "passing" },
        { name: "Summary", value: "summary" },
      ),
  )
  .addIntegerOption((o) => o.setName("week").setDescription("Optional week number; omit for full season"))
  .addStringOption((o) =>
    o
      .setName("scoring")
      .setDescription("Reception scoring")
      .addChoices(
        { name: "PPR", value: "ppr" },
        { name: "Half PPR", value: "half_ppr" },
        { name: "Standard", value: "standard" },
      ),
  )
  .addIntegerOption((o) =>
    o
      .setName("pass_td")
      .setDescription("Passing TD points")
      .addChoices({ name: "4 pt", value: 4 }, { name: "6 pt", value: 6 }),
  )
  .addBooleanOption((o) => o.setName("te_premium").setDescription("TE premium (+0.5 per reception)"))
  .addStringOption((o) =>
    o
      .setName("visibility")
      .setDescription("Where to post the reply")
      .addChoices({ name: "This channel", value: "channel" }, { name: "Only you", value: "private" }),
  );

export const statsLeadersCommand = new SlashCommandBuilder()
  .setName("stats-leaders")
  .setDescription("Top players by an nflverse fantasy metric")
  .addStringOption((o) =>
    o
      .setName("metric")
      .setDescription("Leaderboard metric")
      .setRequired(true)
      .addChoices(...LEADER_METRICS.map((m) => ({ name: m.name, value: m.value }))),
  )
  .addStringOption((o) =>
    o
      .setName("position")
      .setDescription("Position group")
      .setRequired(true)
      .addChoices(
        { name: "QB", value: "QB" },
        { name: "RB", value: "RB" },
        { name: "WR", value: "WR" },
        { name: "TE", value: "TE" },
        { name: "FLEX", value: "FLEX" },
        { name: "Superflex", value: "SUPERFLEX" },
      ),
  )
  .addIntegerOption((o) => o.setName("season").setDescription("Season year (e.g. 2025)").setRequired(true))
  .addIntegerOption((o) => o.setName("week").setDescription("Optional week; omit for full season"))
  .addIntegerOption((o) =>
    o.setName("limit").setDescription("How many rows (default 10, max 25)").setMinValue(3).setMaxValue(25),
  )
  .addStringOption((o) =>
    o
      .setName("scoring")
      .setDescription("Reception scoring")
      .addChoices(
        { name: "PPR", value: "ppr" },
        { name: "Half PPR", value: "half_ppr" },
        { name: "Standard", value: "standard" },
      ),
  )
  .addIntegerOption((o) =>
    o
      .setName("pass_td")
      .setDescription("Passing TD points")
      .addChoices({ name: "4 pt", value: 4 }, { name: "6 pt", value: 6 }),
  )
  .addBooleanOption((o) => o.setName("te_premium").setDescription("TE premium (+0.5 per reception)"))
  .addStringOption((o) =>
    o
      .setName("visibility")
      .setDescription("Where to post the reply")
      .addChoices({ name: "This channel", value: "channel" }, { name: "Only you", value: "private" }),
  );

export async function handlePlayerStatsAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== "player") {
    await interaction.respond([]);
    return;
  }
  const season = interaction.options.getInteger("season") ?? new Date().getFullYear();
  try {
    const choices = await autocompletePlayerNames({ season, query: focused.value });
    await interaction.respond(choices.slice(0, 25));
  } catch (e) {
    log.error("player_stats_autocomplete_failed", { err: e instanceof Error ? e.message : String(e) });
    await interaction.respond([]);
  }
}

export async function handlePlayerStatsCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const player = interaction.options.getString("player", true);
  const season = interaction.options.getInteger("season", true);
  const weekRaw = interaction.options.getInteger("week");
  const week = weekRaw != null && weekRaw > 0 ? weekRaw : null;
  const scope = (interaction.options.getString("scope") ?? "summary") as PlayerStatsScope;
  const visibility = interaction.options.getString("visibility");
  const scoring = scoringFromOptions({
    scoring: interaction.options.getString("scoring"),
    passTd: interaction.options.getInteger("pass_td"),
    tePremium: interaction.options.getBoolean("te_premium"),
  });
  const flags = replyFlags(visibility);
  await interaction.deferReply(flags);

  const found = await findPlayerStats({ playerQuery: player, season, week, scoring });
  if (!found) {
    await interaction.editReply({ content: `No stats found for **${player}** in ${season}${week != null ? ` week ${week}` : ""}.` });
    return;
  }
  const embed = buildPlayerStatsEmbed({
    player: found.player,
    season,
    week,
    scope,
    scoring,
  });
  let content: string | undefined;
  if (found.matches.length > 1) {
    const others = found.matches
      .slice(0, 5)
      .map((m) => `${m.name}${m.team ? ` (${m.team})` : ""}`)
      .join(", ");
    content = `_Showing best match. Also matched: ${others}_`;
  }
  await interaction.editReply({ content, embeds: [embed] });
}

export async function handleStatsLeadersCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const metric = interaction.options.getString("metric", true);
  const position = interaction.options.getString("position", true);
  const season = interaction.options.getInteger("season", true);
  const weekRaw = interaction.options.getInteger("week");
  const week = weekRaw != null && weekRaw > 0 ? weekRaw : null;
  const limit = interaction.options.getInteger("limit") ?? 10;
  const visibility = interaction.options.getString("visibility");
  const scoring = scoringFromOptions({
    scoring: interaction.options.getString("scoring"),
    passTd: interaction.options.getInteger("pass_td"),
    tePremium: interaction.options.getBoolean("te_premium"),
  });
  const flags = replyFlags(visibility);
  await interaction.deferReply(flags);

  const board = await queryLeaderboard({
    season,
    week,
    position,
    sort: metric,
    dir: "desc",
    limit,
    scoring,
  });
  const embed = buildLeadersEmbed({
    players: board.players,
    season,
    week,
    position,
    metric,
    scoring,
  });
  await interaction.editReply({ embeds: [embed] });
}

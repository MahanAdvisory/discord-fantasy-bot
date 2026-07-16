import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type AutocompleteInteraction,
} from "discord.js";
import {
  autocompletePlayerNames,
  findPlayerStats,
  findPlayerStatsWindow,
  normalizeNflTeam,
  queryLeaderboard,
  scoringFromOptions,
} from "../services/stats/leaderboardQuery.js";
import {
  LEADER_METRICS,
  buildPlayerCompareEmbed,
  buildLeadersEmbed,
  buildMultiYearPlayerStatsEmbed,
  buildPlayerStatsEmbed,
  type PlayerStatsScope,
} from "../services/stats/discordReports.js";
import {
  leadersScatterConfig,
  renderLeadersImage,
  renderLeadersScatterImage,
  renderPlayerCompareImage,
  renderPlayerStatsImage,
} from "../services/stats/statsImage.js";
import { log } from "../logging.js";

type StatsFormat = "auto" | "text" | "image";

function replyFlags(visibility: string | null): { flags?: MessageFlags.Ephemeral } {
  const wantPrivate = (visibility ?? "channel").toLowerCase() === "private";
  if (wantPrivate) return { flags: MessageFlags.Ephemeral };
  return {};
}

function useImageFormat(format: StatsFormat, dataColumns: number): boolean {
  return format === "image" || (format === "auto" && dataColumns > 2);
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
      .setName("window")
      .setDescription("Season window ending in the selected season")
      .addChoices(
        { name: "1 season", value: "1" },
        { name: "3 seasons", value: "3" },
        { name: "5 seasons", value: "5" },
      ),
  )
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
      .setName("format")
      .setDescription("Output format (Auto uses image for more than 2 columns)")
      .addChoices({ name: "Auto", value: "auto" }, { name: "Text", value: "text" }, { name: "Image", value: "image" }),
  )
  .addStringOption((o) =>
    o
      .setName("visibility")
      .setDescription("Where to post the reply (defaults to this channel)")
      .addChoices({ name: "This channel", value: "channel" }, { name: "Only you", value: "private" }),
  );

export const playerStatsMobileCommand = new SlashCommandBuilder()
  .setName("player-stats-mobile")
  .setDescription("Mobile-friendly PNG player stats card")
  .addStringOption((o) =>
    o.setName("player").setDescription("Player name").setRequired(true).setAutocomplete(true),
  )
  .addIntegerOption((o) => o.setName("season").setDescription("Season year (e.g. 2025)").setRequired(true))
  .addStringOption((o) =>
    o
      .setName("window")
      .setDescription("Season window ending in the selected season")
      .addChoices(
        { name: "1 season", value: "1" },
        { name: "3 seasons", value: "3" },
        { name: "5 seasons", value: "5" },
      ),
  )
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
      .setDescription("Where to post the reply (defaults to this channel)")
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
  .addStringOption((o) =>
    o
      .setName("extra_1")
      .setDescription("Optional additional stat to display")
      .addChoices(...LEADER_METRICS.map((m) => ({ name: m.name, value: m.value }))),
  )
  .addStringOption((o) =>
    o
      .setName("extra_2")
      .setDescription("Optional additional stat to display")
      .addChoices(...LEADER_METRICS.map((m) => ({ name: m.name, value: m.value }))),
  )
  .addStringOption((o) =>
    o
      .setName("extra_3")
      .setDescription("Optional additional stat to display")
      .addChoices(...LEADER_METRICS.map((m) => ({ name: m.name, value: m.value }))),
  )
  .addIntegerOption((o) => o.setName("week").setDescription("Optional week; omit for full season"))
  .addIntegerOption((o) =>
    o
      .setName("min_volume")
      .setDescription("Override minimum routes, targets, or snaps (0 disables)")
      .setMinValue(0)
      .setMaxValue(1000),
  )
  .addStringOption((o) => o.setName("team").setDescription("Optional NFL team code (e.g. KC, SF, BUF)"))
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
      .setName("format")
      .setDescription("Output format (Auto uses image for more than 2 metrics)")
      .addChoices({ name: "Auto", value: "auto" }, { name: "Text", value: "text" }, { name: "Image", value: "image" }),
  )
  .addStringOption((o) =>
    o
      .setName("visibility")
      .setDescription("Where to post the reply (defaults to this channel)")
      .addChoices({ name: "This channel", value: "channel" }, { name: "Only you", value: "private" }),
  );

export const playerCompareCommand = new SlashCommandBuilder()
  .setName("player-compare")
  .setDescription("Compare two or three nflverse players side-by-side")
  .addStringOption((o) =>
    o.setName("player_1").setDescription("First player").setRequired(true).setAutocomplete(true),
  )
  .addStringOption((o) =>
    o.setName("player_2").setDescription("Second player").setRequired(true).setAutocomplete(true),
  )
  .addIntegerOption((o) => o.setName("season").setDescription("Season year (e.g. 2025)").setRequired(true))
  .addStringOption((o) => o.setName("player_3").setDescription("Optional third player").setAutocomplete(true))
  .addIntegerOption((o) => o.setName("week").setDescription("Optional week number; omit for full season"))
  .addStringOption((o) =>
    o
      .setName("scope")
      .setDescription("Which stat package to compare")
      .addChoices(
        { name: "Summary", value: "summary" },
        { name: "Receiving", value: "receiving" },
        { name: "Rushing", value: "rushing" },
        { name: "Passing", value: "passing" },
      ),
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
      .setName("format")
      .setDescription("Output format (Auto uses image for more than 2 columns)")
      .addChoices({ name: "Auto", value: "auto" }, { name: "Text", value: "text" }, { name: "Image", value: "image" }),
  )
  .addStringOption((o) =>
    o
      .setName("visibility")
      .setDescription("Where to post the reply (defaults to this channel)")
      .addChoices({ name: "This channel", value: "channel" }, { name: "Only you", value: "private" }),
  );

export async function handlePlayerStatsAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (!["player", "player_1", "player_2", "player_3"].includes(focused.name)) {
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
  const window = Number(interaction.options.getString("window") ?? "1") as 1 | 3 | 5;
  const weekRaw = interaction.options.getInteger("week");
  const week = window === 1 && weekRaw != null && weekRaw > 0 ? weekRaw : null;
  const scope = (interaction.options.getString("scope") ?? "summary") as PlayerStatsScope;
  const format = (interaction.options.getString("format") ?? "auto") as StatsFormat;
  const visibility = interaction.options.getString("visibility");
  const scoring = scoringFromOptions({
    scoring: interaction.options.getString("scoring"),
    passTd: interaction.options.getInteger("pass_td"),
    tePremium: interaction.options.getBoolean("te_premium"),
  });
  const flags = replyFlags(visibility);
  await interaction.deferReply(flags);

  if (window > 1) {
    const found = await findPlayerStatsWindow({ playerQuery: player, endSeason: season, years: window === 3 ? 3 : 5, scoring });
    if (!found) {
      await interaction.editReply({ content: `No stats found for **${player}** in ${season}.` });
      return;
    }
    const content = weekRaw != null
      ? `_Week is ignored when using a ${window}-season window._`
      : undefined;
    if (useImageFormat(format, found.seasons.length + 2)) {
      const image = renderPlayerStatsImage({
        playerName: found.playerName,
        playerTeam: found.playerTeam,
        playerPosition: found.playerPosition,
        seasons: found.seasons,
        scope,
        scoring,
      });
      const embed = new EmbedBuilder()
        .setTitle(`${found.playerName} — stats`)
        .setDescription(`${window}-season window ending ${season} · ${scope.toUpperCase()} · ${scoring.receptions.replace("_", " ")}`)
        .setImage("attachment://stats.png");
      await interaction.editReply({ content, embeds: [embed], files: [{ attachment: image, name: "stats.png" }] });
      return;
    }
    const embed = buildMultiYearPlayerStatsEmbed({
      playerName: found.playerName,
      playerTeam: found.playerTeam,
      playerPosition: found.playerPosition,
      seasons: found.seasons,
      scope,
      scoring,
    });
    await interaction.editReply({ content, embeds: [embed] });
    return;
  }
  const found = await findPlayerStats({ playerQuery: player, season, week, scoring });
  if (!found) {
    await interaction.editReply({ content: `No stats found for **${player}** in ${season}${week != null ? ` week ${week}` : ""}.` });
    return;
  }
  let content: string | undefined;
  if (found.matches.length > 1) {
    const others = found.matches
      .slice(0, 5)
      .map((m) => `${m.name}${m.team ? ` (${m.team})` : ""}`)
      .join(", ");
    content = `_Showing best match. Also matched: ${others}_`;
  }
  if (useImageFormat(format, 1)) {
    const image = renderPlayerStatsImage({
      playerName: found.player.playerName ?? player,
      playerTeam: found.player.team,
      playerPosition: found.player.position,
      seasons: [{ season, player: found.player }],
      scope,
      scoring,
      week,
    });
    const embed = new EmbedBuilder()
      .setTitle(`${found.player.playerName ?? player} — stats`)
      .setDescription(`${week == null ? `${season} season` : `${season} week ${week}`} · ${scope.toUpperCase()} · ${scoring.receptions.replace("_", " ")}`)
      .setImage("attachment://stats.png");
    await interaction.editReply({ content, embeds: [embed], files: [{ attachment: image, name: "stats.png" }] });
    return;
  }
  const embed = buildPlayerStatsEmbed({
    player: found.player,
    season,
    week,
    scope,
    scoring,
  });
  await interaction.editReply({ content, embeds: [embed] });
}

export async function handlePlayerStatsMobileCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const player = interaction.options.getString("player", true);
  const season = interaction.options.getInteger("season", true);
  const window = Number(interaction.options.getString("window") ?? "1") as 1 | 3 | 5;
  const weekRaw = interaction.options.getInteger("week");
  const week = window === 1 && weekRaw != null && weekRaw > 0 ? weekRaw : null;
  const scope = (interaction.options.getString("scope") ?? "summary") as PlayerStatsScope;
  const scoring = scoringFromOptions({
    scoring: interaction.options.getString("scoring"),
    passTd: interaction.options.getInteger("pass_td"),
    tePremium: interaction.options.getBoolean("te_premium"),
  });
  await interaction.deferReply(replyFlags(interaction.options.getString("visibility")));

  if (window > 1) {
    const found = await findPlayerStatsWindow({
      playerQuery: player,
      endSeason: season,
      years: window === 3 ? 3 : 5,
      scoring,
    });
    if (!found) {
      await interaction.editReply({ content: `No stats found for **${player}** in ${season}.` });
      return;
    }
    const image = renderPlayerStatsImage({
      playerName: found.playerName,
      playerTeam: found.playerTeam,
      playerPosition: found.playerPosition,
      seasons: found.seasons,
      scope,
      scoring,
    });
    const embed = new EmbedBuilder()
      .setTitle(`${found.playerName} — mobile stats`)
      .setDescription(`${window}-season window ending ${season} · ${scope.toUpperCase()} · ${scoring.receptions.replace("_", " ")}`)
      .setImage("attachment://stats.png");
    await interaction.editReply({
      content: weekRaw != null ? `_Week is ignored when using a ${window}-season window._` : undefined,
      embeds: [embed],
      files: [{ attachment: image, name: "stats.png" }],
    });
    return;
  }

  const found = await findPlayerStats({ playerQuery: player, season, week, scoring });
  if (!found) {
    await interaction.editReply({ content: `No stats found for **${player}** in ${season}${week != null ? ` week ${week}` : ""}.` });
    return;
  }
  const image = renderPlayerStatsImage({
    playerName: found.player.playerName ?? player,
    playerTeam: found.player.team,
    playerPosition: found.player.position,
    seasons: [{ season, player: found.player }],
    scope,
    scoring,
    week,
  });
  const embed = new EmbedBuilder()
    .setTitle(`${found.player.playerName ?? player} — mobile stats`)
    .setDescription(`${week == null ? `${season} season` : `${season} week ${week}`} · ${scope.toUpperCase()} · ${scoring.receptions.replace("_", " ")}`)
    .setImage("attachment://stats.png");
  const content = found.matches.length > 1
    ? `_Showing best match. Also matched: ${found.matches.slice(0, 5).map((match) => `${match.name}${match.team ? ` (${match.team})` : ""}`).join(", ")}_`
    : undefined;
  await interaction.editReply({ content, embeds: [embed], files: [{ attachment: image, name: "stats.png" }] });
}

export async function handleStatsLeadersCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const metric = interaction.options.getString("metric", true);
  const position = interaction.options.getString("position", true);
  const season = interaction.options.getInteger("season", true);
  const weekRaw = interaction.options.getInteger("week");
  const week = weekRaw != null && weekRaw > 0 ? weekRaw : null;
  const limit = interaction.options.getInteger("limit") ?? 10;
  const minVolume = interaction.options.getInteger("min_volume");
  const teamRaw = interaction.options.getString("team");
  const team = teamRaw ? normalizeNflTeam(teamRaw) : null;
  const extraMetrics = ["extra_1", "extra_2", "extra_3"]
    .map((name) => interaction.options.getString(name))
    .filter((candidate): candidate is string => candidate != null && candidate !== metric)
    .filter((candidate, index, metrics) => metrics.indexOf(candidate) === index);
  const format = (interaction.options.getString("format") ?? "auto") as StatsFormat;
  const visibility = interaction.options.getString("visibility");
  const scoring = scoringFromOptions({
    scoring: interaction.options.getString("scoring"),
    passTd: interaction.options.getInteger("pass_td"),
    tePremium: interaction.options.getBoolean("te_premium"),
  });
  const flags = replyFlags(visibility);
  if (teamRaw && !team) {
    await interaction.reply({
      content: `Unknown NFL team \`${teamRaw}\`. Use a team code such as \`KC\`, \`SF\`, or \`BUF\`.`,
      ...flags,
    });
    return;
  }
  await interaction.deferReply(flags);

  const board = await queryLeaderboard({
    season,
    week,
    position,
    sort: metric,
    dir: "desc",
    limit,
    scoring,
    team,
    minVolume,
  });
  const embed = buildLeadersEmbed({
    players: board.players,
    season,
    week,
    position,
    metric,
    extraMetrics,
    scoring,
    team,
    minimumVolume: board.minimumVolume,
  });
  if (useImageFormat(format, 1 + extraMetrics.length)) {
    const scatter = leadersScatterConfig(metric);
    if (scatter) {
      const cohort = await queryLeaderboard({
        season,
        week,
        position,
        sort: scatter.x.metric,
        dir: "desc",
        limit: 100,
        scoring,
        // Preserve the full positional cohort; team-filtered board players are highlights.
        minimumVolumeFilter: board.minimumVolume,
      });
      const image = renderLeadersScatterImage({
        cohort: cohort.players,
        highlights: board.players,
        season,
        week,
        position,
        metric,
        scoring,
        team,
        minimumVolume: board.minimumVolume,
      });
      embed.setImage("attachment://leaders.png");
      await interaction.editReply({ embeds: [embed], files: [{ attachment: image, name: "leaders.png" }] });
      return;
    }
    const image = renderLeadersImage({
      players: board.players,
      season,
      week,
      position,
      metric,
      extraMetrics,
      scoring,
      team,
      minimumVolume: board.minimumVolume,
    });
    embed.setImage("attachment://leaders.png");
    embed.setDescription(`${week == null ? `${season} season` : `${season} week ${week}`} · ${scoring.receptions.replace("_", " ")} · ${1 + extraMetrics.length} displayed metric${extraMetrics.length ? "s" : ""}`);
    await interaction.editReply({ embeds: [embed], files: [{ attachment: image, name: "leaders.png" }] });
    return;
  }
  await interaction.editReply({ embeds: [embed] });
}

export async function handlePlayerCompareCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const playerQueries = [
    interaction.options.getString("player_1", true),
    interaction.options.getString("player_2", true),
    interaction.options.getString("player_3"),
  ].filter((player): player is string => Boolean(player?.trim()));
  const season = interaction.options.getInteger("season", true);
  const weekRaw = interaction.options.getInteger("week");
  const week = weekRaw != null && weekRaw > 0 ? weekRaw : null;
  const scope = (interaction.options.getString("scope") ?? "summary") as PlayerStatsScope;
  const format = (interaction.options.getString("format") ?? "auto") as StatsFormat;
  const flags = replyFlags(interaction.options.getString("visibility"));
  const scoring = scoringFromOptions({
    scoring: interaction.options.getString("scoring"),
    passTd: interaction.options.getInteger("pass_td"),
    tePremium: interaction.options.getBoolean("te_premium"),
  });
  await interaction.deferReply(flags);

  const found = await Promise.all(playerQueries.map((playerQuery) => findPlayerStats({ playerQuery, season, week, scoring })));
  const missing = playerQueries.filter((player, i) => !found[i]);
  if (missing.length) {
    await interaction.editReply({
      content: `No stats found for **${missing.join(", ")}** in ${season}${week != null ? ` week ${week}` : ""}.`,
    });
    return;
  }
  const players = found.map((result) => result!.player);
  if (useImageFormat(format, players.length)) {
    const image = renderPlayerCompareImage({ players, season, week, scope, scoring });
    const embed = new EmbedBuilder()
      .setTitle("Player comparison")
      .setDescription(`${week == null ? `${season} season` : `${season} week ${week}`} · ${scope.toUpperCase()} · ${scoring.receptions.replace("_", " ")}`)
      .setImage("attachment://stats.png");
    await interaction.editReply({ embeds: [embed], files: [{ attachment: image, name: "stats.png" }] });
    return;
  }
  const embed = buildPlayerCompareEmbed({ players, season, week, scope, scoring });
  await interaction.editReply({ embeds: [embed] });
}

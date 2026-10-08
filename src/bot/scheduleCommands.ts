import {
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { LEADER_METRICS } from "../services/stats/discordReports.js";
import { normalizeNflTeam } from "../services/stats/leaderboardQuery.js";
import {
  WEEKDAY_NAMES,
  describeScheduledReport,
  etClock,
  formatEtTime,
  formatScheduleLine,
  parseScheduledReport,
  type ScheduledReportParams,
} from "../services/stats/reportSchedule.js";

const METRIC_CHOICES = LEADER_METRICS.map((metric) => ({ name: metric.name, value: metric.value }));
const POSITION_CHOICES = [
  { name: "QB", value: "QB" },
  { name: "RB", value: "RB" },
  { name: "WR", value: "WR" },
  { name: "TE", value: "TE" },
  { name: "FLEX", value: "FLEX" },
  { name: "Superflex", value: "SUPERFLEX" },
];
const WEEK_CHOICES = [
  { name: "Most recent week", value: "most_recent" },
  { name: "Prior week", value: "prior_week" },
  ...Array.from({ length: 18 }, (_, index) => ({ name: `Week ${index + 1}`, value: String(index + 1) })),
];
const WEEK_OR_SEASON_CHOICES = [{ name: "Full season", value: "season" }, ...WEEK_CHOICES];
const SCOPE_CHOICES = [
  { name: "Summary", value: "summary" },
  { name: "Receiving", value: "receiving" },
  { name: "Rushing", value: "rushing" },
  { name: "Passing", value: "passing" },
];
const FORMAT_CHOICES = [
  { name: "Image", value: "image" },
  { name: "Text", value: "text" },
  { name: "Auto", value: "auto" },
];

function addWhen(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return sub
    .addStringOption((o) =>
      o
        .setName("day")
        .setDescription("Day of the week, US Eastern")
        .setRequired(true)
        .addChoices(
          { name: "Sunday", value: "0" },
          { name: "Monday", value: "1" },
          { name: "Tuesday", value: "2" },
          { name: "Wednesday", value: "3" },
          { name: "Thursday", value: "4" },
          { name: "Friday", value: "5" },
          { name: "Saturday", value: "6" },
        ),
    )
    .addIntegerOption((o) =>
      o
        .setName("hour")
        .setDescription("Hour in US Eastern, 0–23 (9 = 9:00am)")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(23),
    );
}

function addClockExtras(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return sub
    .addIntegerOption((o) =>
      o.setName("minute").setDescription("Minute, US Eastern (default 0)").setMinValue(0).setMaxValue(59),
    )
    .addIntegerOption((o) =>
      o
        .setName("season")
        .setDescription("Season year. Omit to use the current NFL season each time it runs")
        .setMinValue(1999)
        .setMaxValue(2100),
    );
}

function addScoring(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return sub
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
    .addBooleanOption((o) => o.setName("te_premium").setDescription("TE premium (+0.5 per reception)"));
}

export const scheduleReportCommand = new SlashCommandBuilder()
  .setName("schedule-report")
  .setDescription("Schedule a recurring stats report in this channel (Manage Server)")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    addScoring(
      addClockExtras(
        addWhen(sub)
          .setName("growth")
          .setDescription("Post /stats-growth every week. One comparison per schedule.")
          .addStringOption((o) =>
            o.setName("metric").setDescription("Stat to compare").setRequired(true).addChoices(...METRIC_CHOICES),
          )
          .addStringOption((o) =>
            o.setName("position").setDescription("Position group").setRequired(true).addChoices(...POSITION_CHOICES),
          )
          .addStringOption((o) =>
            o
              .setName("start_week")
              .setDescription("First week: a week number, most recent, or prior week")
              .setRequired(true)
              .addChoices(...WEEK_CHOICES),
          )
          .addStringOption((o) =>
            o
              .setName("end_week")
              .setDescription("Second week: a week number, most recent, or prior week")
              .setRequired(true)
              .addChoices(...WEEK_CHOICES),
          ),
      )
        .addStringOption((o) =>
          o
            .setName("direction")
            .setDescription("Which changes to rank (default: biggest gains)")
            .addChoices({ name: "Biggest gains", value: "gain" }, { name: "Biggest drops", value: "drop" }),
        )
        .addIntegerOption((o) =>
          o.setName("limit").setDescription("How many rows (default 10, max 25)").setMinValue(3).setMaxValue(25),
        )
        .addIntegerOption((o) =>
          o
            .setName("min_volume")
            .setDescription("Override minimum routes, targets, snaps, carries, or attempts in each week")
            .setMinValue(0)
            .setMaxValue(1000),
        ),
    ),
  )
  .addSubcommand((sub) =>
    addScoring(
      addClockExtras(
        addWhen(sub)
          .setName("leaders")
          .setDescription("Post /stats-leaders every week")
          .addStringOption((o) =>
            o.setName("metric").setDescription("Leaderboard metric").setRequired(true).addChoices(...METRIC_CHOICES),
          )
          .addStringOption((o) =>
            o.setName("position").setDescription("Position group").setRequired(true).addChoices(...POSITION_CHOICES),
          )
          .addStringOption((o) =>
            o
              .setName("week")
              .setDescription("Week, most recent, prior week, or full season")
              .setRequired(true)
              .addChoices(...WEEK_OR_SEASON_CHOICES),
          ),
      )
        .addIntegerOption((o) =>
          o.setName("limit").setDescription("How many rows (default 10, max 25)").setMinValue(3).setMaxValue(25),
        )
        .addIntegerOption((o) =>
          o
            .setName("min_volume")
            .setDescription("Override minimum routes, targets, or snaps (0 disables)")
            .setMinValue(0)
            .setMaxValue(1000),
        )
        .addStringOption((o) => o.setName("team").setDescription("Optional NFL team code (e.g. KC, SF, BUF)"))
        .addStringOption((o) =>
          o.setName("extra_1").setDescription("Optional additional stat to display").addChoices(...METRIC_CHOICES),
        )
        .addStringOption((o) =>
          o.setName("extra_2").setDescription("Optional additional stat to display").addChoices(...METRIC_CHOICES),
        )
        .addStringOption((o) =>
          o.setName("extra_3").setDescription("Optional additional stat to display").addChoices(...METRIC_CHOICES),
        )
        .addStringOption((o) =>
          o
            .setName("format")
            .setDescription("Output format (default Image, with a chart when one exists)")
            .addChoices(...FORMAT_CHOICES),
        ),
    ),
  )
  .addSubcommand((sub) =>
    addScoring(
      addClockExtras(
        addWhen(sub)
          .setName("player")
          .setDescription("Post /player-stats every week, including image cards")
          .addStringOption((o) =>
            o.setName("player").setDescription("Player name").setRequired(true).setAutocomplete(true),
          ),
      )
        .addStringOption((o) =>
          o
            .setName("week")
            .setDescription("Week, most recent, prior week, or full season (default)")
            .addChoices(...WEEK_OR_SEASON_CHOICES),
        )
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
        .addStringOption((o) => o.setName("scope").setDescription("Which stat package to show").addChoices(...SCOPE_CHOICES))
        .addStringOption((o) =>
          o.setName("format").setDescription("Output format (default Image)").addChoices(...FORMAT_CHOICES),
        ),
    ),
  )
  .addSubcommand((sub) =>
    addScoring(
      addClockExtras(
        addWhen(sub)
          .setName("weekly")
          .setDescription("Post /player-stats-weekly every week")
          .addStringOption((o) =>
            o.setName("player").setDescription("Player name").setRequired(true).setAutocomplete(true),
          ),
      )
        .addStringOption((o) => o.setName("scope").setDescription("Which stat package to show").addChoices(...SCOPE_CHOICES))
        .addStringOption((o) =>
          o.setName("chart").setDescription("Trend chart metric (default FPTS)").addChoices(...METRIC_CHOICES),
        ),
    ),
  )
  .addSubcommand((sub) =>
    addScoring(
      addClockExtras(
        addWhen(sub)
          .setName("compare")
          .setDescription("Post /player-compare every week")
          .addStringOption((o) =>
            o.setName("player_1").setDescription("First player").setRequired(true).setAutocomplete(true),
          )
          .addStringOption((o) =>
            o.setName("player_2").setDescription("Second player").setRequired(true).setAutocomplete(true),
          ),
      )
        .addStringOption((o) => o.setName("player_3").setDescription("Optional third player").setAutocomplete(true))
        .addStringOption((o) =>
          o
            .setName("week")
            .setDescription("Week, most recent, prior week, or full season (default)")
            .addChoices(...WEEK_OR_SEASON_CHOICES),
        )
        .addStringOption((o) => o.setName("scope").setDescription("Which stat package to compare").addChoices(...SCOPE_CHOICES))
        .addStringOption((o) =>
          o.setName("format").setDescription("Output format (default Image)").addChoices(...FORMAT_CHOICES),
        ),
    ),
  )
  .addSubcommand((sub) => sub.setName("list").setDescription("Show recurring reports scheduled in this channel"))
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("Delete a recurring report from this channel")
      .addStringOption((o) =>
        o.setName("id").setDescription("Schedule id from /schedule-report list").setRequired(true),
      ),
  );

function ephemeral(): { flags: MessageFlags.Ephemeral } {
  return { flags: MessageFlags.Ephemeral };
}

function readTiming(interaction: ChatInputCommandInteraction): { weekday: number; hour: number; minute: number } {
  return {
    weekday: Number(interaction.options.getString("day", true)),
    hour: interaction.options.getInteger("hour", true),
    minute: interaction.options.getInteger("minute") ?? 0,
  };
}

function readScoring(interaction: ChatInputCommandInteraction) {
  return {
    scoring: interaction.options.getString("scoring"),
    passTd: interaction.options.getInteger("pass_td"),
    tePremium: interaction.options.getBoolean("te_premium"),
  };
}

function savedMessage(params: ScheduledReportParams, weekday: number, hour: number, minute: number): string {
  const lines = [
    `Scheduled in this channel for **${WEEKDAY_NAMES[weekday]} at ${formatEtTime(hour, minute)} ET**.`,
    `**Report:** ${describeScheduledReport(params)}`,
    "The season follows the current NFL season unless you set one. Most recent and prior week are chosen when the report runs.",
  ];
  if (params.report === "stats-growth") {
    lines.push(
      "Each schedule is one comparison. For week 1 → most recent and prior week → most recent, create a second schedule at the same day and time.",
    );
  }
  lines.push("`/schedule-report list` shows schedules here. `/schedule-report remove` deletes one.");
  return lines.join("\n");
}

async function saveSchedule(
  interaction: ChatInputCommandInteraction,
  draft: Record<string, unknown>,
): Promise<void> {
  const params = parseScheduledReport(draft);
  if (!params) {
    const sameWeek =
      draft.report === "stats-growth" &&
      typeof draft.startWeek === "string" &&
      draft.startWeek === draft.endWeek;
    await interaction.reply({
      content: sameWeek ? "Pick two different weeks." : "Those options don't make a valid report.",
      ...ephemeral(),
    });
    return;
  }
  const { weekday, hour, minute } = readTiming(interaction);
  const clock = etClock();
  const slotAlreadyPassed =
    clock.weekday === weekday && clock.hour * 60 + clock.minute >= hour * 60 + minute;
  const saved = await prisma.scheduledReport.create({
    data: {
      guildId: interaction.guildId!,
      channelId: interaction.channelId,
      createdByDiscordUserId: interaction.user.id,
      report: params.report,
      weekday,
      hour,
      minute,
      params: params as unknown as Prisma.InputJsonValue,
      lastFiredOn: slotAlreadyPassed ? clock.date : null,
    },
  });
  const firstRun = slotAlreadyPassed ? "\nToday's time has already passed, so the first post is next week." : "";
  await interaction.reply({
    content: `${savedMessage(params, weekday, hour, minute)}${firstRun}\nId: \`${saved.id.slice(0, 8)}\``,
    ...ephemeral(),
  });
}

export async function handleScheduleReportCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.channelId) {
    await interaction.reply({ content: "Use this command in a server channel.", ...ephemeral() });
    return;
  }
  const permissions = interaction.memberPermissions;
  if (!permissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: "You need Manage Server to schedule reports in this channel.",
      ...ephemeral(),
    });
    return;
  }

  const sub = interaction.options.getSubcommand();
  if (sub === "list") {
    const rows = await prisma.scheduledReport.findMany({
      where: { guildId: interaction.guildId, channelId: interaction.channelId, enabled: true },
      orderBy: { createdAt: "asc" },
    });
    if (!rows.length) {
      await interaction.reply({ content: "No reports are scheduled in this channel.", ...ephemeral() });
      return;
    }
    const lines = ["**Scheduled reports in this channel**", ...rows.map((row) => formatScheduleLine(row))];
    await interaction.reply({ content: lines.join("\n").slice(0, 2000), ...ephemeral() });
    return;
  }

  if (sub === "remove") {
    const id = interaction.options.getString("id", true).trim();
    if (id.length < 4) {
      await interaction.reply({
        content: "Use at least 4 characters of the id from `/schedule-report list`.",
        ...ephemeral(),
      });
      return;
    }
    const rows = await prisma.scheduledReport.findMany({
      where: { guildId: interaction.guildId, channelId: interaction.channelId, enabled: true },
    });
    const matches = rows.filter((row) => row.id === id || row.id.startsWith(id));
    if (matches.length === 0) {
      await interaction.reply({ content: "No schedule in this channel matches that id.", ...ephemeral() });
      return;
    }
    if (matches.length > 1) {
      await interaction.reply({
        content: `That id matches ${matches.length} schedules. Use a longer id.`,
        ...ephemeral(),
      });
      return;
    }
    await prisma.scheduledReport.delete({ where: { id: matches[0]!.id } });
    await interaction.reply({
      content: `Removed ${formatScheduleLine(matches[0]!)}.`,
      ...ephemeral(),
    });
    return;
  }

  const scoring = readScoring(interaction);
  const season = interaction.options.getInteger("season");
  if (sub === "growth") {
    const startWeek = interaction.options.getString("start_week", true);
    const endWeek = interaction.options.getString("end_week", true);
    await saveSchedule(interaction, {
      report: "stats-growth",
      metric: interaction.options.getString("metric", true),
      position: interaction.options.getString("position", true),
      season,
      startWeek,
      endWeek,
      direction: interaction.options.getString("direction") ?? "gain",
      limit: interaction.options.getInteger("limit") ?? 10,
      minVolume: interaction.options.getInteger("min_volume"),
      ...scoring,
    });
    return;
  }

  if (sub === "leaders") {
    const teamRaw = interaction.options.getString("team");
    const team = teamRaw ? normalizeNflTeam(teamRaw) : null;
    if (teamRaw && !team) {
      await interaction.reply({
        content: `Unknown NFL team \`${teamRaw}\`. Use a team code such as \`KC\`, \`SF\`, or \`BUF\`.`,
        ...ephemeral(),
      });
      return;
    }
    const metric = interaction.options.getString("metric", true);
    const extraMetrics = ["extra_1", "extra_2", "extra_3"]
      .map((name) => interaction.options.getString(name))
      .filter((candidate): candidate is string => candidate != null && candidate !== metric)
      .filter((candidate, index, metrics) => metrics.indexOf(candidate) === index);
    await saveSchedule(interaction, {
      report: "stats-leaders",
      metric,
      position: interaction.options.getString("position", true),
      season,
      week: interaction.options.getString("week", true),
      limit: interaction.options.getInteger("limit") ?? 10,
      minVolume: interaction.options.getInteger("min_volume"),
      team,
      extraMetrics,
      format: interaction.options.getString("format") ?? "image",
      ...scoring,
    });
    return;
  }

  if (sub === "player") {
    const window = Number(interaction.options.getString("window") ?? "1");
    await saveSchedule(interaction, {
      report: "player-stats",
      player: interaction.options.getString("player", true),
      season,
      window,
      scope: interaction.options.getString("scope") ?? "summary",
      week: interaction.options.getString("week") ?? "season",
      format: interaction.options.getString("format") ?? "image",
      ...scoring,
    });
    return;
  }

  if (sub === "weekly") {
    await saveSchedule(interaction, {
      report: "player-stats-weekly",
      player: interaction.options.getString("player", true),
      season,
      scope: interaction.options.getString("scope") ?? "summary",
      chart: interaction.options.getString("chart") ?? "fpts",
      ...scoring,
    });
    return;
  }

  if (sub === "compare") {
    const players = [
      interaction.options.getString("player_1", true),
      interaction.options.getString("player_2", true),
      interaction.options.getString("player_3"),
    ].filter((player): player is string => Boolean(player?.trim()));
    await saveSchedule(interaction, {
      report: "player-compare",
      players,
      season,
      week: interaction.options.getString("week") ?? "season",
      scope: interaction.options.getString("scope") ?? "summary",
      format: interaction.options.getString("format") ?? "image",
      ...scoring,
    });
  }
}

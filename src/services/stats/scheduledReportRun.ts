import { EmbedBuilder, type Client } from "discord.js";
import { prisma } from "../../db.js";
import { log } from "../../logging.js";
import { getNflState } from "../../sleeper/client.js";
import {
  findPlayerStats,
  findPlayerStatsWindow,
  findPlayerWeeklyStats,
  metricValue,
  minimumVolumeForMetric,
  normalizeNflTeam,
  playerVolume,
  queryLeaderboard,
  routeCountsAvailable,
  scoringFromOptions,
} from "./leaderboardQuery.js";
import {
  applyStatsSourceFooter,
  buildLeadersEmbed,
  buildMultiYearPlayerStatsEmbed,
  buildPlayerCompareEmbed,
  buildPlayerStatsEmbed,
  buildStatsGrowthEmbed,
  type PlayerStatsScope,
} from "./discordReports.js";
import {
  leadersScatterConfig,
  renderLeadersImage,
  renderLeadersScatterImage,
  renderPlayerCompareImage,
  renderPlayerStatsImage,
  renderPlayerWeeklyImage,
} from "./statsImage.js";
import { rankWeekChanges, type WeekChangeDirection } from "./weekOverWeek.js";
import {
  etClock,
  fallbackNflSeason,
  isRelativeWeek,
  isReportDue,
  parseScheduledReport,
  resolveWeekToken,
  type CompareSchedule,
  type GrowthSchedule,
  type LeadersSchedule,
  type PlayerSchedule,
  type ScheduledReportParams,
  type WeeklySchedule,
} from "./reportSchedule.js";

type ReportFile = { attachment: Buffer; name: string };

export type RenderedReport =
  | { status: "ready"; content?: string; embeds?: EmbedBuilder[]; files?: ReportFile[] }
  | { status: "wait"; reason: string };

type WeekResolution =
  | { status: "week"; week: number }
  | { status: "season" }
  | { status: "wait" }
  | { status: "note"; note: string };

/** A week counts once a real cohort is loaded, so a partial ingest is not "most recent". */
const MIN_PLAYERS_FOR_WEEK = 20;

export async function resolveSeasonYear(season: number | null): Promise<number> {
  if (season != null) return season;
  try {
    const nfl = await getNflState();
    const year = Number(nfl.league_season ?? nfl.season);
    if (Number.isInteger(year) && year >= 1999 && year <= 2100) return year;
  } catch (err) {
    log.warn("scheduled_report_nfl_state_failed", { err: err instanceof Error ? err.message : String(err) });
  }
  return fallbackNflSeason(etClock());
}

export async function latestLoadedRegularWeek(season: number): Promise<number | null> {
  const grouped = await prisma.nflPlayerWeekStat.groupBy({
    by: ["week"],
    where: {
      season,
      grain: "week",
      week: { gt: 0, lte: 18 },
      seasonType: { in: ["REG", "reg"] },
    },
    _count: { _all: true },
  });
  const weeks = grouped.filter((row) => row._count._all >= MIN_PLAYERS_FOR_WEEK).map((row) => row.week);
  return weeks.length ? Math.max(...weeks) : null;
}

function resolveScheduleWeek(token: string, latest: number | null): WeekResolution {
  if (token === "season") return { status: "season" };
  if (isRelativeWeek(token) && latest == null) return { status: "wait" };
  if (token === "prior_week" && latest != null && latest <= 1) {
    return { status: "note", note: `Prior week isn't available yet. The latest week with stats is week ${latest}.` };
  }
  const week = resolveWeekToken(token, latest);
  if (week == null) return { status: "note", note: `Couldn't resolve week "${token}".` };
  return { status: "week", week };
}

function scoringOf(params: ScheduledReportParams) {
  return scoringFromOptions({
    scoring: params.scoring,
    passTd: params.passTd,
    tePremium: params.tePremium,
  });
}

function useImageFormat(format: "auto" | "text" | "image", dataColumns: number): boolean {
  return format === "image" || (format === "auto" && dataColumns > 2);
}

async function renderGrowth(params: GrowthSchedule): Promise<RenderedReport> {
  const season = await resolveSeasonYear(params.season);
  const latest = await latestLoadedRegularWeek(season);
  const start = resolveScheduleWeek(params.startWeek, latest);
  const end = resolveScheduleWeek(params.endWeek, latest);
  if (start.status === "wait" || end.status === "wait") {
    return { status: "wait", reason: `no regular-season week loaded for ${season}` };
  }
  if (start.status === "note") return { status: "ready", content: start.note };
  if (end.status === "note") return { status: "ready", content: end.note };
  if (start.status !== "week" || end.status !== "week") {
    return { status: "ready", content: "Growth reports need two weeks." };
  }
  if (start.week === end.week) {
    return { status: "ready", content: `Both weeks resolved to week ${start.week}, so there is nothing to compare.` };
  }
  const scoring = scoringOf(params);
  const direction = params.direction as WeekChangeDirection;
  const [startBoard, endBoard] = await Promise.all([
    queryLeaderboard({ season, week: start.week, position: params.position, sort: "fpts", limit: 2000, scoring }),
    queryLeaderboard({ season, week: end.week, position: params.position, sort: "fpts", limit: 2000, scoring }),
  ]);
  const defaultMinimum = minimumVolumeForMetric(params.metric, start.week);
  const requestedMinimum =
    defaultMinimum == null
      ? null
      : {
          ...defaultMinimum,
          value: params.minVolume ?? defaultMinimum.value,
          isDefault: params.minVolume == null,
        };
  const routesMissing =
    requestedMinimum?.unit === "routes" &&
    (!routeCountsAvailable(startBoard.players) || !routeCountsAvailable(endBoard.players));
  const minimum = routesMissing ? null : requestedMinimum;
  const endByKey = new Map(endBoard.players.map((player) => [player.playerKey, player]));
  const volumeUnit = minimum?.unit;
  const samples = [];
  for (const startPlayer of startBoard.players) {
    const endPlayer = endByKey.get(startPlayer.playerKey);
    if (!endPlayer) continue;
    samples.push({
      playerKey: endPlayer.playerKey,
      playerName: endPlayer.playerName ?? startPlayer.playerName,
      team: endPlayer.team ?? startPlayer.team,
      position: endPlayer.position ?? startPlayer.position,
      startValue: metricValue(startPlayer, params.metric),
      endValue: metricValue(endPlayer, params.metric),
      startVolume: volumeUnit ? playerVolume(startPlayer, volumeUnit) : 0,
      endVolume: volumeUnit ? playerVolume(endPlayer, volumeUnit) : 0,
    });
  }
  const changes = rankWeekChanges(samples, {
    direction,
    minVolume: minimum?.value ?? 0,
    limit: params.limit,
  });
  const embed = buildStatsGrowthEmbed({
    changes,
    season,
    startWeek: start.week,
    endWeek: end.week,
    position: params.position,
    metric: params.metric,
    direction,
    scoring,
    minimumVolume: minimum,
  });
  return { status: "ready", embeds: [embed] };
}

async function renderLeaders(params: LeadersSchedule): Promise<RenderedReport> {
  const season = await resolveSeasonYear(params.season);
  const latest = await latestLoadedRegularWeek(season);
  const resolved = resolveScheduleWeek(params.week, latest);
  if (resolved.status === "wait") return { status: "wait", reason: `no regular-season week loaded for ${season}` };
  if (resolved.status === "note") return { status: "ready", content: resolved.note };
  const week = resolved.status === "week" ? resolved.week : null;
  const scoring = scoringOf(params);
  const team = params.team ? normalizeNflTeam(params.team) : null;
  if (params.team && !team) return { status: "ready", content: `Unknown NFL team \`${params.team}\`.` };
  const board = await queryLeaderboard({
    season,
    week,
    position: params.position,
    sort: params.metric,
    dir: "desc",
    limit: params.limit,
    scoring,
    team,
    minVolume: params.minVolume,
  });
  const extraMetrics = params.extraMetrics;
  const embed = buildLeadersEmbed({
    players: board.players,
    season,
    week,
    position: params.position,
    metric: params.metric,
    extraMetrics,
    scoring,
    team,
    minimumVolume: board.minimumVolume,
  });
  if (!useImageFormat(params.format, 1 + extraMetrics.length)) return { status: "ready", embeds: [embed] };
  const tableImage = renderLeadersImage({
    players: board.players,
    season,
    week,
    position: params.position,
    metric: params.metric,
    extraMetrics,
    scoring,
    team,
    minimumVolume: board.minimumVolume,
  });
  const files: ReportFile[] = [{ attachment: tableImage, name: "leaders.png" }];
  const scatter = leadersScatterConfig(params.metric);
  let hasChart = false;
  if (scatter) {
    const cohort = await queryLeaderboard({
      season,
      week,
      position: params.position,
      sort: scatter.x.metric,
      dir: "desc",
      limit: 100,
      scoring,
      minimumVolumeFilter: board.minimumVolume,
    });
    const chartImage = renderLeadersScatterImage({
      cohort: cohort.players,
      highlights: board.players,
      season,
      week,
      position: params.position,
      metric: params.metric,
      scoring,
      team,
      minimumVolume: board.minimumVolume,
    });
    files.push({ attachment: chartImage, name: "leaders-chart.png" });
    hasChart = true;
  }
  const when = week == null ? `${season} season` : `${season} week ${week}`;
  embed.setDescription(
    `${when} · ${scoring.receptions.replace("_", " ")} · ${1 + extraMetrics.length} displayed metric${extraMetrics.length ? "s" : ""}` +
      (hasChart ? "\n_Chart attached below._" : ""),
  );
  embed.setImage("attachment://leaders.png");
  return { status: "ready", embeds: [embed], files };
}

async function renderPlayer(params: PlayerSchedule): Promise<RenderedReport> {
  const season = await resolveSeasonYear(params.season);
  const scoring = scoringOf(params);
  const scope = params.scope as PlayerStatsScope;
  if (params.window > 1) {
    const found = await findPlayerStatsWindow({
      playerQuery: params.player,
      endSeason: season,
      years: params.window === 3 ? 3 : 5,
      scoring,
    });
    if (!found) return { status: "ready", content: `No stats found for **${params.player}** in ${season}.` };
    const content = params.week !== "season" ? `_Week is ignored when using a ${params.window}-season window._` : undefined;
    if (useImageFormat(params.format, found.seasons.length + 2)) {
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
        .setDescription(`${params.window}-season window ending ${season} · ${scope.toUpperCase()} · ${scoring.receptions.replace("_", " ")}`)
        .setImage("attachment://stats.png");
      applyStatsSourceFooter(embed);
      return { status: "ready", content, embeds: [embed], files: [{ attachment: image, name: "stats.png" }] };
    }
    const embed = buildMultiYearPlayerStatsEmbed({
      playerName: found.playerName,
      playerTeam: found.playerTeam,
      playerPosition: found.playerPosition,
      seasons: found.seasons,
      scope,
      scoring,
    });
    return { status: "ready", content, embeds: [embed] };
  }
  const latest = await latestLoadedRegularWeek(season);
  const resolved = resolveScheduleWeek(params.week, latest);
  if (resolved.status === "wait") return { status: "wait", reason: `no regular-season week loaded for ${season}` };
  if (resolved.status === "note") return { status: "ready", content: resolved.note };
  const week = resolved.status === "week" ? resolved.week : null;
  const found = await findPlayerStats({ playerQuery: params.player, season, week, scoring });
  if (!found) {
    return {
      status: "ready",
      content: `No stats found for **${params.player}** in ${season}${week != null ? ` week ${week}` : ""}.`,
    };
  }
  const content =
    found.matches.length > 1
      ? `_Showing best match. Also matched: ${found.matches
          .slice(0, 5)
          .map((match) => `${match.name}${match.team ? ` (${match.team})` : ""}`)
          .join(", ")}_`
      : undefined;
  if (useImageFormat(params.format, 1)) {
    const image = renderPlayerStatsImage({
      playerName: found.player.playerName ?? params.player,
      playerTeam: found.player.team,
      playerPosition: found.player.position,
      seasons: [{ season, player: found.player }],
      scope,
      scoring,
      week,
    });
    const embed = new EmbedBuilder()
      .setTitle(`${found.player.playerName ?? params.player} — stats`)
      .setDescription(
        `${week == null ? `${season} season` : `${season} week ${week}`} · ${scope.toUpperCase()} · ${scoring.receptions.replace("_", " ")}`,
      )
      .setImage("attachment://stats.png");
    applyStatsSourceFooter(embed);
    return { status: "ready", content, embeds: [embed], files: [{ attachment: image, name: "stats.png" }] };
  }
  const embed = buildPlayerStatsEmbed({
    player: found.player,
    season,
    week,
    scope,
    scoring,
  });
  return { status: "ready", content, embeds: [embed] };
}

async function renderWeekly(params: WeeklySchedule): Promise<RenderedReport> {
  const season = await resolveSeasonYear(params.season);
  const scoring = scoringOf(params);
  const found = await findPlayerWeeklyStats({ playerQuery: params.player, season, scoring });
  if (!found) return { status: "ready", content: `No stats found for **${params.player}** in ${season}.` };
  if (!found.weeks.length) {
    return { status: "ready", content: `No regular-season weeks found for **${found.playerName}** in ${season}.` };
  }
  const image = renderPlayerWeeklyImage({
    playerName: found.playerName,
    playerTeam: found.playerTeam,
    playerPosition: found.playerPosition,
    season,
    scope: params.scope,
    scoring,
    weeks: found.weeks,
    chartMetric: params.chart,
  });
  const embed = new EmbedBuilder()
    .setTitle(`${found.playerName} — week by week`)
    .setDescription(`${season} · ${params.scope.toUpperCase()} · ${found.weeks.length} weeks · ${scoring.receptions.replace("_", " ")}`)
    .setImage("attachment://weekly.png");
  applyStatsSourceFooter(embed);
  const content =
    found.matches.length > 1
      ? `_Showing best match. Also matched: ${found.matches
          .slice(0, 5)
          .map((match) => `${match.name}${match.team ? ` (${match.team})` : ""}`)
          .join(", ")}_`
      : undefined;
  return { status: "ready", content, embeds: [embed], files: [{ attachment: image, name: "weekly.png" }] };
}

async function renderCompare(params: CompareSchedule): Promise<RenderedReport> {
  const season = await resolveSeasonYear(params.season);
  const scoring = scoringOf(params);
  const latest = await latestLoadedRegularWeek(season);
  const resolved = resolveScheduleWeek(params.week, latest);
  if (resolved.status === "wait") return { status: "wait", reason: `no regular-season week loaded for ${season}` };
  if (resolved.status === "note") return { status: "ready", content: resolved.note };
  const week = resolved.status === "week" ? resolved.week : null;
  const found = await Promise.all(
    params.players.map((player) => findPlayerStats({ playerQuery: player, season, week, scoring })),
  );
  const missing = params.players.filter((_, index) => !found[index]);
  if (missing.length) {
    return {
      status: "ready",
      content: `No stats found for **${missing.join(", ")}** in ${season}${week != null ? ` week ${week}` : ""}.`,
    };
  }
  const players = found.map((result) => result!.player);
  if (useImageFormat(params.format, players.length)) {
    const image = renderPlayerCompareImage({ players, season, week, scope: params.scope, scoring });
    const embed = new EmbedBuilder()
      .setTitle("Player comparison")
      .setDescription(
        `${week == null ? `${season} season` : `${season} week ${week}`} · ${params.scope.toUpperCase()} · ${scoring.receptions.replace("_", " ")}`,
      )
      .setImage("attachment://stats.png");
    applyStatsSourceFooter(embed);
    return { status: "ready", embeds: [embed], files: [{ attachment: image, name: "stats.png" }] };
  }
  const embed = buildPlayerCompareEmbed({ players, season, week, scope: params.scope, scoring });
  return { status: "ready", embeds: [embed] };
}

export async function renderScheduledReport(params: ScheduledReportParams): Promise<RenderedReport> {
  if (params.report === "stats-growth") return renderGrowth(params);
  if (params.report === "stats-leaders") return renderLeaders(params);
  if (params.report === "player-stats") return renderPlayer(params);
  if (params.report === "player-stats-weekly") return renderWeekly(params);
  return renderCompare(params);
}

type ChannelWithSend = {
  send: (options: { content?: string; embeds?: EmbedBuilder[]; files?: ReportFile[] }) => Promise<unknown>;
};

function asSendable(channel: unknown): ChannelWithSend | null {
  if (!channel || typeof channel !== "object") return null;
  const candidate = channel as {
    isTextBased?: () => boolean;
    isDMBased?: () => boolean;
    send?: ChannelWithSend["send"];
  };
  if (typeof candidate.isTextBased !== "function" || !candidate.isTextBased()) return null;
  if (typeof candidate.isDMBased === "function" && candidate.isDMBased()) return null;
  if (typeof candidate.send !== "function") return null;
  return { send: candidate.send.bind(candidate) };
}

function discordErrorCode(err: unknown): number | undefined {
  if (err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "number") {
    return (err as { code: number }).code;
  }
  return undefined;
}

export async function runDueScheduledReports(client: Client, now = new Date()): Promise<void> {
  const clock = etClock(now);
  const schedules = await prisma.scheduledReport.findMany({ where: { enabled: true } });
  for (const schedule of schedules) {
    if (!isReportDue(schedule, clock)) continue;
    const params = parseScheduledReport(schedule.params);
    if (!params) {
      log.error("scheduled_report_invalid", { id: schedule.id, report: schedule.report });
      await prisma.scheduledReport.update({ where: { id: schedule.id }, data: { enabled: false } });
      continue;
    }
    try {
      const rendered = await renderScheduledReport(params);
      if (rendered.status === "wait") {
        log.info("scheduled_report_waiting", { id: schedule.id, reason: rendered.reason });
        continue;
      }
      const channel = asSendable(await client.channels.fetch(schedule.channelId).catch(() => null));
      if (!channel) {
        log.warn("scheduled_report_channel_missing", { id: schedule.id, channelId: schedule.channelId });
        await prisma.scheduledReport.update({ where: { id: schedule.id }, data: { enabled: false } });
        continue;
      }
      await channel.send({
        content: rendered.content,
        embeds: rendered.embeds,
        files: rendered.files,
      });
      await prisma.scheduledReport.update({
        where: { id: schedule.id },
        data: { lastFiredOn: clock.date },
      });
      log.info("scheduled_report_posted", { id: schedule.id, channelId: schedule.channelId, report: params.report });
    } catch (err) {
      const code = discordErrorCode(err);
      if (code === 10003) {
        await prisma.scheduledReport.update({ where: { id: schedule.id }, data: { enabled: false } });
      }
      log.error("scheduled_report_failed", {
        id: schedule.id,
        code,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

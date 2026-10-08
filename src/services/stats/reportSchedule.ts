import { LEADER_METRIC_LABELS, LEADER_METRICS, type PlayerStatsScope } from "./discordReports.js";

const METRIC_VALUES = new Set<string>(LEADER_METRICS.map((metric) => metric.value));
const POSITIONS = new Set(["QB", "RB", "WR", "TE", "FLEX", "SUPERFLEX"]);
const SCOPES = new Set<PlayerStatsScope>(["summary", "receiving", "rushing", "passing"]);
const FORMATS = new Set(["auto", "text", "image"]);

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export type EtClock = {
  weekday: number;
  /** YYYY-MM-DD in America/New_York. */
  date: string;
  hour: number;
  minute: number;
};

export type ScoringFields = {
  scoring: string | null;
  passTd: number | null;
  tePremium: boolean | null;
};

export type GrowthSchedule = ScoringFields & {
  report: "stats-growth";
  metric: string;
  position: string;
  /** Null follows the current NFL season each time the report runs. */
  season: number | null;
  startWeek: string;
  endWeek: string;
  direction: "gain" | "drop";
  limit: number;
  minVolume: number | null;
};

export type LeadersSchedule = ScoringFields & {
  report: "stats-leaders";
  metric: string;
  position: string;
  season: number | null;
  week: string;
  limit: number;
  minVolume: number | null;
  team: string | null;
  extraMetrics: string[];
  format: "auto" | "text" | "image";
};

export type PlayerSchedule = ScoringFields & {
  report: "player-stats";
  player: string;
  season: number | null;
  window: 1 | 3 | 5;
  scope: PlayerStatsScope;
  week: string;
  format: "auto" | "text" | "image";
};

export type WeeklySchedule = ScoringFields & {
  report: "player-stats-weekly";
  player: string;
  season: number | null;
  scope: PlayerStatsScope;
  chart: string;
};

export type CompareSchedule = ScoringFields & {
  report: "player-compare";
  players: string[];
  season: number | null;
  week: string;
  scope: PlayerStatsScope;
  format: "auto" | "text" | "image";
};

export type ScheduledReportParams =
  | GrowthSchedule
  | LeadersSchedule
  | PlayerSchedule
  | WeeklySchedule
  | CompareSchedule;

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function etClock(now = new Date()): EtClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = WEEKDAY_INDEX[get("weekday")];
  if (weekday == null) throw new Error(`Unexpected Eastern weekday "${get("weekday")}"`);
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0;
  return {
    weekday,
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour,
    minute: Number(get("minute")),
  };
}

/** September–December use the calendar year. January–August fall back to the prior season. */
export function fallbackNflSeason(clock: EtClock): number {
  const year = Number(clock.date.slice(0, 4));
  const month = Number(clock.date.slice(5, 7));
  return month >= 9 ? year : year - 1;
}

export function isReportDue(
  schedule: { enabled: boolean; weekday: number; hour: number; minute: number; lastFiredOn: string | null },
  now: EtClock,
): boolean {
  if (!schedule.enabled) return false;
  if (now.weekday !== schedule.weekday) return false;
  if (schedule.lastFiredOn === now.date) return false;
  return now.hour * 60 + now.minute >= schedule.hour * 60 + schedule.minute;
}

export function formatEtTime(hour: number, minute: number): string {
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 ? "AM" : "PM";
  return `${hour12}:${minute.toString().padStart(2, "0")} ${suffix}`;
}

export function weekTokenLabel(token: string): string {
  if (token === "most_recent") return "most recent";
  if (token === "prior_week") return "prior week";
  if (token === "season") return "full season";
  return `W${token}`;
}

/**
 * `most_recent` is the latest regular-season week that already has stats.
 * `prior_week` is the week before that. A numeric token is that week number.
 * `season` resolves to null (full season). Prior week is null when the latest week is 1.
 */
export function resolveWeekToken(token: string, latestWeek: number | null): number | null {
  if (token === "season") return null;
  if (token === "most_recent") return latestWeek;
  if (token === "prior_week") return latestWeek != null && latestWeek > 1 ? latestWeek - 1 : null;
  const week = Number(token);
  return Number.isInteger(week) && week >= 1 && week <= 18 ? week : null;
}

export function isRelativeWeek(token: string): boolean {
  return token === "most_recent" || token === "prior_week";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(obj: Record<string, unknown>, key: string): number | null {
  const value = obj[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(obj: Record<string, unknown>, key: string): boolean | null {
  const value = obj[key];
  return typeof value === "boolean" ? value : null;
}

function readSeason(obj: Record<string, unknown>): number | null {
  const season = readNumber(obj, "season");
  if (season == null) return null;
  return Number.isInteger(season) && season >= 1999 && season <= 2100 ? season : null;
}

function readWeekToken(value: string | null, allowSeason: boolean): string | null {
  if (!value) return null;
  const token = value.trim().toLowerCase();
  if (token === "most_recent" || token === "prior_week") return token;
  if (token === "season") return allowSeason ? token : null;
  if (/^\d+$/.test(token)) {
    const week = Number(token);
    if (week >= 1 && week <= 18) return String(week);
  }
  return null;
}

function readScoring(obj: Record<string, unknown>): ScoringFields {
  const scoring = readString(obj, "scoring");
  const passTd = readNumber(obj, "passTd");
  return {
    scoring: scoring === "ppr" || scoring === "half_ppr" || scoring === "standard" ? scoring : null,
    passTd: passTd === 4 || passTd === 6 ? passTd : null,
    tePremium: readBoolean(obj, "tePremium"),
  };
}

function readLimit(obj: Record<string, unknown>): number {
  const limit = readNumber(obj, "limit");
  if (limit == null) return 10;
  return Math.min(25, Math.max(3, Math.round(limit)));
}

function readMinVolume(obj: Record<string, unknown>): number | null {
  const minVolume = readNumber(obj, "minVolume");
  if (minVolume == null) return null;
  return Math.min(1000, Math.max(0, Math.round(minVolume)));
}

function readExtraMetrics(obj: Record<string, unknown>, primary: string): string[] {
  const raw = obj.extraMetrics;
  if (!Array.isArray(raw)) return [];
  const metrics: string[] = [];
  for (const candidate of raw) {
    if (typeof candidate !== "string" || !METRIC_VALUES.has(candidate) || candidate === primary) continue;
    if (!metrics.includes(candidate)) metrics.push(candidate);
  }
  return metrics.slice(0, 3);
}

function readFormat(obj: Record<string, unknown>): "auto" | "text" | "image" {
  const format = readString(obj, "format");
  return format && FORMATS.has(format) ? (format as "auto" | "text" | "image") : "image";
}

function readScope(obj: Record<string, unknown>): PlayerStatsScope {
  const scope = readString(obj, "scope");
  return scope && SCOPES.has(scope as PlayerStatsScope) ? (scope as PlayerStatsScope) : "summary";
}

function readMetric(obj: Record<string, unknown>): string | null {
  const metric = readString(obj, "metric");
  return metric && METRIC_VALUES.has(metric) ? metric : null;
}

function readPosition(obj: Record<string, unknown>): string | null {
  const position = readString(obj, "position")?.toUpperCase() ?? null;
  return position && POSITIONS.has(position) ? position : null;
}

export function parseScheduledReport(value: unknown): ScheduledReportParams | null {
  const obj = asRecord(value);
  if (!obj) return null;
  const report = readString(obj, "report");
  const scoring = readScoring(obj);
  if (report === "stats-growth") {
    const metric = readMetric(obj);
    const position = readPosition(obj);
    const startWeek = readWeekToken(readString(obj, "startWeek"), false);
    const endWeek = readWeekToken(readString(obj, "endWeek"), false);
    const direction = readString(obj, "direction") === "drop" ? "drop" : "gain";
    if (!metric || !position || !startWeek || !endWeek) return null;
    if (startWeek === endWeek) return null;
    return {
      report,
      metric,
      position,
      season: readSeason(obj),
      startWeek,
      endWeek,
      direction,
      limit: readLimit(obj),
      minVolume: readMinVolume(obj),
      ...scoring,
    };
  }
  if (report === "stats-leaders") {
    const metric = readMetric(obj);
    const position = readPosition(obj);
    const week = readWeekToken(readString(obj, "week"), true);
    if (!metric || !position || !week) return null;
    const team = readString(obj, "team");
    return {
      report,
      metric,
      position,
      season: readSeason(obj),
      week,
      limit: readLimit(obj),
      minVolume: readMinVolume(obj),
      team: team ? team.toUpperCase() : null,
      extraMetrics: readExtraMetrics(obj, metric),
      format: readFormat(obj),
      ...scoring,
    };
  }
  if (report === "player-stats") {
    const player = readString(obj, "player");
    const week = readWeekToken(readString(obj, "week") ?? "season", true);
    const windowRaw = readNumber(obj, "window");
    const window = windowRaw === 3 || windowRaw === 5 ? windowRaw : 1;
    if (!player || !week) return null;
    return {
      report,
      player,
      season: readSeason(obj),
      window,
      scope: readScope(obj),
      week,
      format: readFormat(obj),
      ...scoring,
    };
  }
  if (report === "player-stats-weekly") {
    const player = readString(obj, "player");
    const chart = readString(obj, "chart");
    if (!player || !chart || !METRIC_VALUES.has(chart)) return null;
    return {
      report,
      player,
      season: readSeason(obj),
      scope: readScope(obj),
      chart,
      ...scoring,
    };
  }
  if (report === "player-compare") {
    const playersRaw = obj.players;
    const players = Array.isArray(playersRaw)
      ? playersRaw.filter((player): player is string => typeof player === "string" && player.trim().length > 0).map((player) => player.trim())
      : [];
    const week = readWeekToken(readString(obj, "week") ?? "season", true);
    if (players.length < 2 || players.length > 3 || !week) return null;
    return {
      report,
      players,
      season: readSeason(obj),
      week,
      scope: readScope(obj),
      format: readFormat(obj),
      ...scoring,
    };
  }
  return null;
}

function metricLabel(metric: string): string {
  return LEADER_METRIC_LABELS[metric] ?? metric.toUpperCase();
}

export function describeScheduledReport(value: unknown): string {
  const params = parseScheduledReport(value);
  if (!params) return "Unknown report";
  if (params.report === "stats-growth") {
    const direction = params.direction === "drop" ? "drops" : "gains";
    return `${params.position} ${metricLabel(params.metric)} ${direction}, ${weekTokenLabel(params.startWeek)} → ${weekTokenLabel(params.endWeek)}`;
  }
  if (params.report === "stats-leaders") {
    const team = params.team ? ` ${params.team}` : "";
    const extras = params.extraMetrics.length ? ` + ${params.extraMetrics.map(metricLabel).join(", ")}` : "";
    return `${params.position}${team} ${metricLabel(params.metric)}${extras}, ${weekTokenLabel(params.week)}`;
  }
  if (params.report === "player-stats") {
    const span = params.window > 1 ? `${params.window} seasons` : weekTokenLabel(params.week);
    return `${params.player} ${params.scope}, ${span}`;
  }
  if (params.report === "player-stats-weekly") {
    return `${params.player} week by week, ${params.scope}, chart ${metricLabel(params.chart)}`;
  }
  return `${params.players.join(" vs ")} ${params.scope}, ${weekTokenLabel(params.week)}`;
}

export function formatScheduleLine(row: {
  id: string;
  weekday: number;
  hour: number;
  minute: number;
  params: unknown;
}): string {
  const day = WEEKDAY_NAMES[row.weekday] ?? "Unknown day";
  return `**${row.id.slice(0, 8)}** · ${day} ${formatEtTime(row.hour, row.minute)} ET · ${describeScheduledReport(row.params)}`;
}

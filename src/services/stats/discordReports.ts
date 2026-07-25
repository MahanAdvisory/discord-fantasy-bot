import { EmbedBuilder } from "discord.js";
import type { ScoringPreset } from "../../domain/fantasyScoring.js";
import type { LeaderboardMinimumVolume, StatsPlayerRow } from "./leaderboardQuery.js";

function n(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v
    .toFixed(digits)
    .replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1");
}

function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

function scoringLabel(s: ScoringPreset): string {
  const rec = s.receptions === "half_ppr" ? "Half-PPR" : s.receptions === "standard" ? "Std" : "PPR";
  return `${rec}, ${s.passTd}pt pass TD${s.tePremium ? `, TE+${s.tePremium}` : ""}`;
}

function discordText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Shared attribution shown on every Discord stats report (embed footer / image caption). */
export const STATS_SOURCE_FOOTER = "Data: nflverse / nflfastR · ffopportunity · FTN when present";

export function applyStatsSourceFooter(embed: EmbedBuilder, extra?: string | null): EmbedBuilder {
  const suffix = extra?.trim();
  return embed.setFooter({ text: suffix ? `${STATS_SOURCE_FOOTER} · ${suffix}` : STATS_SOURCE_FOOTER });
}

/** Label matches underlying source: member start-rate vs FantasyPros rostered%. */
function ownershipRateLabel(p: StatsPlayerRow): string {
  return p.startRateSource === "fantasypros_fallback" ? "Rostered%" : "Start%";
}

export type PlayerStatsScope = "receiving" | "rushing" | "passing" | "summary";

function hasMeaningfulValue(...values: Array<number | null | undefined>): boolean {
  return values.some((value) => value != null && value !== 0);
}

function hasPassing(p: StatsPlayerRow): boolean {
  return hasMeaningfulValue(
    p.box.completions,
    p.box.attempts,
    p.box.passingYards,
    p.box.passingTds,
    p.box.interceptions,
  );
}

function hasRushing(p: StatsPlayerRow): boolean {
  return hasMeaningfulValue(
    p.box.carries,
    p.box.rushingYards,
    p.box.rushingTds,
    p.box.rushingFirstDowns,
  );
}

function hasReceiving(p: StatsPlayerRow): boolean {
  return hasMeaningfulValue(
    p.box.targets,
    p.box.receptions,
    p.box.receivingYards,
    p.box.receivingTds,
    p.box.receivingFirstDowns,
  );
}

type StatsMetric = {
  label: string;
  kind: "count" | "rate";
  value: (player: StatsPlayerRow) => number | null;
  format?: (value: number) => string;
};

const value = (v: number | null | undefined): number | null => (v != null && Number.isFinite(v) ? v : null);
const integer = (v: number): string => String(Math.round(v));

/** Discord table labels: each remains at five characters or fewer. */
const TABLE_METRIC_LABELS = {
  games: "G",
  fpts: "FPTS",
  fptsPerGame: "FPG",
  xfp: "xFP",
  fpoe: "FPOE",
  vorp: "VORP",
  startRate: "Start",
  completions: "Cmp",
  attempts: "Att",
  yards: "Yds",
  touchdowns: "TD",
  interceptions: "INT",
  firstDowns: "1D",
  firstDownsPerCarry: "FD/C",
  yardsPerCarry: "YPC",
  epa: "EPA",
  targets: "Tgt",
  receptions: "Rec",
  targetShare: "Tgt%",
  targetsPerRoute: "TPRR",
  yprr: "YPRR",
  firstDownsPerRoute: "FD/RR",
  adot: "aDOT",
  airYards: "Air",
  yac: "YAC",
  routes: "Rts",
  snapRate: "Snap%",
} as const;

const SUMMARY_METRICS: StatsMetric[] = [
  { label: TABLE_METRIC_LABELS.games, kind: "count", value: (p) => p.games, format: integer },
  { label: TABLE_METRIC_LABELS.fpts, kind: "count", value: (p) => p.fpts },
  { label: TABLE_METRIC_LABELS.fptsPerGame, kind: "rate", value: (p) => p.fptsPerGame },
  { label: TABLE_METRIC_LABELS.xfp, kind: "count", value: (p) => p.xfp },
  { label: TABLE_METRIC_LABELS.fpoe, kind: "count", value: (p) => p.fpoe },
  { label: TABLE_METRIC_LABELS.vorp, kind: "count", value: (p) => p.vorp },
  { label: TABLE_METRIC_LABELS.startRate, kind: "rate", value: (p) => p.startRate, format: (v) => pct(v) },
];
const PASSING_METRICS: StatsMetric[] = [
  { label: TABLE_METRIC_LABELS.completions, kind: "count", value: (p) => value(p.box.completions), format: integer },
  { label: TABLE_METRIC_LABELS.attempts, kind: "count", value: (p) => value(p.box.attempts), format: integer },
  { label: TABLE_METRIC_LABELS.yards, kind: "count", value: (p) => value(p.box.passingYards), format: integer },
  { label: TABLE_METRIC_LABELS.touchdowns, kind: "count", value: (p) => value(p.box.passingTds), format: integer },
  { label: TABLE_METRIC_LABELS.interceptions, kind: "count", value: (p) => value(p.box.interceptions), format: integer },
];
const RUSHING_METRICS: StatsMetric[] = [
  { label: TABLE_METRIC_LABELS.attempts, kind: "count", value: (p) => value(p.box.carries), format: integer },
  { label: TABLE_METRIC_LABELS.yards, kind: "count", value: (p) => value(p.box.rushingYards), format: integer },
  { label: TABLE_METRIC_LABELS.yardsPerCarry, kind: "rate", value: (p) => p.yardsPerCarry, format: (v) => n(v, 2) },
  { label: TABLE_METRIC_LABELS.touchdowns, kind: "count", value: (p) => value(p.box.rushingTds), format: integer },
  { label: TABLE_METRIC_LABELS.firstDowns, kind: "count", value: (p) => value(p.box.rushingFirstDowns), format: integer },
  { label: TABLE_METRIC_LABELS.firstDownsPerCarry, kind: "rate", value: (p) => p.firstDownsPerCarry, format: (v) => n(v, 2) },
  { label: TABLE_METRIC_LABELS.epa, kind: "rate", value: (p) => p.rushingEpa, format: (v) => n(v, 2) },
];
const RECEIVING_METRICS: StatsMetric[] = [
  { label: TABLE_METRIC_LABELS.targets, kind: "count", value: (p) => value(p.box.targets), format: integer },
  { label: TABLE_METRIC_LABELS.receptions, kind: "count", value: (p) => value(p.box.receptions), format: integer },
  { label: TABLE_METRIC_LABELS.yards, kind: "count", value: (p) => value(p.box.receivingYards), format: integer },
  { label: TABLE_METRIC_LABELS.touchdowns, kind: "count", value: (p) => value(p.box.receivingTds), format: integer },
  { label: TABLE_METRIC_LABELS.firstDowns, kind: "count", value: (p) => value(p.box.receivingFirstDowns), format: integer },
  { label: TABLE_METRIC_LABELS.targetShare, kind: "rate", value: (p) => p.targetShare, format: (v) => pct(v) },
  { label: TABLE_METRIC_LABELS.targetsPerRoute, kind: "rate", value: (p) => p.targetsPerRoute, format: (v) => pct(v) },
  { label: TABLE_METRIC_LABELS.yprr, kind: "rate", value: (p) => p.yprr, format: (v) => n(v, 2) },
  { label: TABLE_METRIC_LABELS.firstDownsPerRoute, kind: "rate", value: (p) => p.firstDownsPerRoute, format: (v) => n(v, 2) },
  { label: TABLE_METRIC_LABELS.adot, kind: "rate", value: (p) => p.adot, format: (v) => n(v, 1) },
  { label: TABLE_METRIC_LABELS.airYards, kind: "count", value: (p) => p.airYards, format: integer },
  { label: TABLE_METRIC_LABELS.yac, kind: "count", value: (p) => p.yac, format: integer },
  { label: TABLE_METRIC_LABELS.routes, kind: "count", value: (p) => p.routesRun, format: integer },
  { label: TABLE_METRIC_LABELS.snapRate, kind: "rate", value: (p) => p.offenseSnapPct, format: (v) => pct(v) },
];

function metricText(metric: StatsMetric, player: StatsPlayerRow): string {
  const raw = metric.value(player);
  return raw == null ? "—" : formatMetricValue(metric, raw);
}

function formatMetricValue(metric: StatsMetric, raw: number): string {
  return (metric.format ?? (metric.kind === "count" ? integer : (v: number) => n(v)))(raw);
}

function table(rows: Array<{ label: string; values: string[] }>, headers: string[]): string {
  const widths = [
    Math.max(...rows.map((row) => row.label.length)),
    ...headers.map((header, i) => Math.max(header.length, ...rows.map((row) => row.values[i]!.length))),
  ];
  // One space between right-aligned cols: readable columns without the wide left-pad tables.
  const format = ([label, ...values]: string[]) =>
    `${label.padEnd(widths[0]!)} ${values.map((cell, i) => cell.padStart(widths[i + 1]!)).join(" ")}`.trimEnd();
  return `\`\`\`\n${format(["", ...headers])}\n${rows.map((row) => format([row.label, ...row.values])).join("\n")}\n\`\`\``;
}

const PLAYER_NICKNAMES: Record<string, string> = {
  ezekiel: "Zeke",
};

function playerHeaderBase(player: StatsPlayerRow): string {
  const words = (player.playerName ?? "Player").trim().split(/\s+/);
  const firstName = words[0]!.toLowerCase();
  if (PLAYER_NICKNAMES[firstName]) return PLAYER_NICKNAMES[firstName]!;
  const surname = [...words].reverse().find((word) => !/^(jr|sr|ii|iii|iv)\.?$/i.test(word)) ?? words[words.length - 1]!;
  return surname.replace(/[^a-z]/gi, "").slice(0, 4) || "Player";
}

function playerHeaders(players: StatsPlayerRow[]): string[] {
  const bases = players.map(playerHeaderBase);
  return bases.map((base, index) => {
    if (bases.filter((other) => other.toLowerCase() === base.toLowerCase()).length === 1) return base;
    const words = (players[index]!.playerName ?? "Player").trim().split(/\s+/);
    const disambiguated = `${words[0]![0] ?? ""}${base.slice(0, 3)}`;
    const matching = bases.filter((other, otherIndex) =>
      otherIndex !== index && `${(players[otherIndex]!.playerName ?? "Player").trim()[0] ?? ""}${other.slice(0, 3)}`.toLowerCase() === disambiguated.toLowerCase(),
    );
    return matching.length ? `${base.slice(0, 3)}${index + 1}` : disambiguated;
  });
}

function playerLegend(players: StatsPlayerRow[], headers: string[]): string {
  return headers
    .map((header, index) => {
      const player = players[index]!;
      const detail = `${player.playerName ?? "Player"}${player.team ? ` (${player.team})` : ""}${player.position ? ` ${player.position}` : ""}`;
      return `${header} = ${detail}`;
    })
    .join(" · ");
}

function addTableFields(
  embed: EmbedBuilder,
  name: string,
  rows: Array<{ label: string; values: string[] }>,
  headers: string[],
): void {
  const chunks: Array<Array<{ label: string; values: string[] }>> = [];
  for (const row of rows) {
    const chunk = chunks.at(-1) ?? [];
    if (chunk.length && table([...chunk, row], headers).length > 1_024) chunks.push([row]);
    else if (chunk.length) chunk.push(row);
    else chunks.push([row]);
  }
  chunks.forEach((chunk, index) => {
    embed.addFields({ name: chunks.length > 1 ? `${name} (${index + 1}/${chunks.length})` : name, value: table(chunk, headers), inline: false });
  });
}

function reportGroups(players: StatsPlayerRow[], scope: PlayerStatsScope): Array<{ name: string; metrics: StatsMetric[] }> {
  const groups: Array<{ name: string; metrics: StatsMetric[] }> = [];
  const include = (name: string, metrics: StatsMetric[], present: boolean) => {
    const available = metrics.filter((metric) => players.some((player) => metric.value(player) != null));
    if (present && available.length) groups.push({ name, metrics: available });
  };
  if (scope === "summary") {
    include("Summary", SUMMARY_METRICS, true);
    include("Passing", PASSING_METRICS, players.some(hasPassing));
    include("Rushing", RUSHING_METRICS, players.some(hasRushing));
    include("Receiving", RECEIVING_METRICS, players.some(hasReceiving));
  } else if (scope === "passing") include("Passing", PASSING_METRICS, players.some(hasPassing));
  else if (scope === "rushing") include("Rushing", RUSHING_METRICS, players.some(hasRushing));
  else include("Receiving", RECEIVING_METRICS, players.some(hasReceiving));
  return groups;
}

export function buildPlayerStatsEmbed(args: {
  player: StatsPlayerRow;
  season: number;
  week: number | null;
  scope: PlayerStatsScope;
  scoring: ScoringPreset;
}): EmbedBuilder {
  const { player: p, season, week, scope, scoring } = args;
  const when = week == null ? `${season} season` : `${season} · week ${week}`;
  const title = discordText(
    `${p.playerName ?? "Player"}${p.team ? ` (${p.team})` : ""}${p.position ? ` · ${p.position}` : ""}`,
    256,
  );
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(`**${scope.toUpperCase()}** · ${when}\n_Scoring: ${scoringLabel(scoring)}_`);
  applyStatsSourceFooter(embed);
  const groups = reportGroups([p], scope);
  if (!groups.length) embed.setDescription(`${embed.data.description}\n\n_No ${scope} statistics recorded for this period._`);
  for (const group of groups) {
    addTableFields(embed, group.name, group.metrics.map((metric) => ({ label: metric.label, values: [metricText(metric, p)] })), ["Value"]);
  }
  return embed;
}

export const LEADER_METRIC_LABELS: Record<string, string> = {
  fpts: "FPTS",
  fpts_g: "FPTS/G",
  xfp: "xFP",
  fpoe: "FPOE",
  vorp: "VORP",
  tgt_pct: "Tgt%",
  tprr: "TPRR",
  yprr: "YPRR",
  adot: "aDOT",
  rec_epa: "Rec EPA",
  rush_epa: "Rush EPA",
  att: "Carries",
  ypc: "YPC",
  rush_fd: "Rush First Downs",
  rec_fd: "Rec First Downs",
  fd_carry: "FD/Carry",
  fd_rr: "FD/RR",
  tgt: "Targets",
  rec: "Receptions",
  rec_yds: "Rec Yards",
  rush_yds: "Rush Yards",
  pass_yds: "Pass Yards",
  air_yds: "Air Yards",
  routes: "Routes",
  snap_pct: "Snap%",
};

export function formatLeaderMetricValue(p: StatsPlayerRow, metric: string): string {
  switch (metric) {
    case "fpts":
      return n(p.fpts);
    case "fpts_g":
      return n(p.fptsPerGame);
    case "xfp":
      return n(p.xfp);
    case "fpoe":
      return n(p.fpoe);
    case "vorp":
      return n(p.vorp);
    case "tgt_pct":
      return pct(p.targetShare);
    case "tprr":
      return pct(p.targetsPerRoute);
    case "yprr":
      return n(p.yprr, 2);
    case "adot":
      return n(p.adot, 1);
    case "rec_epa":
      return n(p.receivingEpa, 2);
    case "rush_epa":
      return n(p.rushingEpa, 2);
    case "fd":
      return String(p.firstDowns ?? "—");
    case "rush_fd":
      return String(p.box.rushingFirstDowns ?? "—");
    case "rec_fd":
      return String(p.box.receivingFirstDowns ?? "—");
    case "fd_carry":
      return n(p.firstDownsPerCarry, 2);
    case "ypc":
      return n(p.yardsPerCarry, 2);
    case "fd_rr":
      return n(p.firstDownsPerRoute, 2);
    case "tgt":
      return String(p.box.targets ?? 0);
    case "rec":
      return String(p.box.receptions ?? 0);
    case "rec_yds":
      return String(p.box.receivingYards ?? 0);
    case "rush_yds":
      return String(p.box.rushingYards ?? 0);
    case "rush_td":
      return String(p.box.rushingTds ?? 0);
    case "att":
      return String(p.box.carries ?? 0);
    case "pass_yds":
      return String(p.box.passingYards ?? 0);
    case "air_yds":
      return String(p.airYards ?? "—");
    case "routes":
      return String(p.routesRun ?? "—");
    case "snap_pct":
      return pct(p.offenseSnapPct);
    default:
      return n(p.fpts);
  }
}

export function buildLeadersEmbed(args: {
  players: StatsPlayerRow[];
  season: number;
  week: number | null;
  position: string;
  metric: string;
  scoring: ScoringPreset;
  extraMetrics?: string[];
  team?: string | null;
  minimumVolume?: LeaderboardMinimumVolume | null;
}): EmbedBuilder {
  const { players, season, week, position, metric, scoring, extraMetrics = [], team, minimumVolume } = args;
  const when = week == null ? `${season} season` : `${season} W${week}`;
  const label = LEADER_METRIC_LABELS[metric] ?? metric.toUpperCase();
  const displayedMetrics = [metric, ...extraMetrics.filter((candidate) => candidate !== metric)]
    .filter((candidate, index, metrics) => metrics.indexOf(candidate) === index);
  const lines: string[] = [];
  for (const [i, p] of players.entries()) {
    const playerLabel = discordText(
      `${p.playerName ?? "?"}${p.team ? ` (${p.team})` : ""}${p.position ? ` ${p.position}` : ""}`,
      100,
    );
    const values = displayedMetrics.map((displayMetric, metricIndex) => {
      const value = `${formatLeaderMetricValue(p, displayMetric)} ${LEADER_METRIC_LABELS[displayMetric] ?? displayMetric.toUpperCase()}`;
      return metricIndex === 0 ? `**${value}**` : value;
    });
    const line = `**${i + 1}.** ${playerLabel} — ${values.join(" · ")}`;
    if (lines.join("\n").length + line.length + 1 > 3_800) break;
    lines.push(line);
  }
  const embed = new EmbedBuilder()
    .setTitle(discordText(`Top ${players.length} ${team ? `${team} ` : ""}${position} by ${label}`, 256))
    .setDescription(discordText(`**${when}** · ${scoringLabel(scoring)}\n\n${lines.join("\n") || "_No players_"}`, 4_096));
  const extras = [
    minimumVolume ? `min ${minimumVolume.value} ${minimumVolume.unit}` : null,
    team ? `${team} filter; rows without team data are excluded` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return applyStatsSourceFooter(embed, extras || null);
}

export function buildPlayerCompareEmbed(args: {
  players: StatsPlayerRow[];
  season: number;
  week: number | null;
  scope: PlayerStatsScope;
  scoring: ScoringPreset;
}): EmbedBuilder {
  const { players, season, week, scope, scoring } = args;
  const when = week == null ? `${season} season` : `${season} · week ${week}`;
  const embed = new EmbedBuilder()
    .setTitle("Player comparison")
    .setDescription(`**${scope.toUpperCase()}** · ${when}\n_Scoring: ${scoringLabel(scoring)}_`);
  applyStatsSourceFooter(embed);

  const headers = playerHeaders(players);
  embed.setDescription(discordText(`${embed.data.description}\n**Legend:** ${playerLegend(players, headers)}`, 4_096));
  for (const group of reportGroups(players, scope)) {
    addTableFields(embed, group.name, group.metrics.map((metric) => ({ label: metric.label, values: players.map((player) => metricText(metric, player)) })), headers);
  }
  if (!embed.data.fields?.length) embed.setDescription(`${embed.data.description}\n\n_No ${scope} statistics recorded for this period._`);
  return embed;
}

export function buildMultiYearPlayerStatsEmbed(args: {
  playerName: string;
  playerTeam: string | null;
  playerPosition: string | null;
  seasons: Array<{ season: number; player: StatsPlayerRow | null }>;
  scope: PlayerStatsScope;
  scoring: ScoringPreset;
}): EmbedBuilder {
  const { playerName, playerTeam, playerPosition, seasons, scope, scoring } = args;
  const players = seasons.flatMap((entry) => (entry.player ? [entry.player] : []));
  const embed = new EmbedBuilder()
    .setTitle(discordText(`${playerName}${playerTeam ? ` (${playerTeam})` : ""}${playerPosition ? ` · ${playerPosition}` : ""}`, 256))
    .setDescription(
      `**${scope.toUpperCase()}** · ${seasons[0]!.season}–${seasons.at(-1)!.season}\n` +
      `_Scoring: ${scoringLabel(scoring)}_\n` +
      `_Av = average · 17 = combined totals ÷ combined G × 17 (rates use Av only)_\n` +
      `**Seasons:** ${seasons.map((entry) => `${String(entry.season).slice(-2)}=${entry.season}`).join(" · ")}`,
    );
  applyStatsSourceFooter(embed);
  const headers = [...seasons.map((entry) => String(entry.season).slice(-2)), "Av", "17"];
  for (const group of reportGroups(players, scope)) {
    const rows = group.metrics.map((metric) => {
      const values = seasons.map((entry) => (entry.player ? metricText(metric, entry.player) : "—"));
      const available = seasons.flatMap((entry) => {
        const raw = entry.player ? metric.value(entry.player) : null;
        return raw == null ? [] : [{ raw, games: entry.player!.games }];
      });
      const average = available.length ? available.reduce((sum, entry) => sum + entry.raw, 0) / available.length : null;
      const totalGames = available.reduce((sum, entry) => sum + entry.games, 0);
      const seventeenGame = metric.kind === "count" && totalGames > 0
        ? (available.reduce((sum, entry) => sum + entry.raw, 0) / totalGames) * 17
        : null;
      return {
        label: metric.label,
        values: [...values, average == null ? "—" : formatMetricValue(metric, average), seventeenGame == null ? "—" : formatMetricValue(metric, seventeenGame)],
      };
    });
    if (rows.length) addTableFields(embed, group.name, rows, headers);
  }
  if (!embed.data.fields?.length) embed.setDescription(`${embed.data.description}\n\n_No ${scope} statistics recorded in this window._`);
  return embed;
}

export const LEADER_METRICS = [
  { name: "FPTS", value: "fpts" },
  { name: "FPTS/G", value: "fpts_g" },
  { name: "xFP", value: "xfp" },
  { name: "FPOE", value: "fpoe" },
  { name: "VORP", value: "vorp" },
  { name: "Tgt%", value: "tgt_pct" },
  { name: "TPRR", value: "tprr" },
  { name: "YPRR", value: "yprr" },
  { name: "aDOT", value: "adot" },
  { name: "Rec EPA", value: "rec_epa" },
  { name: "Rush EPA", value: "rush_epa" },
  { name: "Carries", value: "att" },
  { name: "Rush First Downs", value: "rush_fd" },
  { name: "Rec First Downs", value: "rec_fd" },
  { name: "YPC", value: "ypc" },
  { name: "FD/Carry", value: "fd_carry" },
  { name: "FD/RR", value: "fd_rr" },
  { name: "Targets", value: "tgt" },
  { name: "Receptions", value: "rec" },
  { name: "Rec Yards", value: "rec_yds" },
  { name: "Rush Yards", value: "rush_yds" },
  { name: "Pass Yards", value: "pass_yds" },
  { name: "Air Yards", value: "air_yds" },
  { name: "Routes", value: "routes" },
  { name: "Snap%", value: "snap_pct" },
] as const;

import { EmbedBuilder } from "discord.js";
import type { ScoringPreset } from "../../domain/fantasyScoring.js";
import type { LeaderboardMinimumVolume, StatsPlayerRow } from "./leaderboardQuery.js";

function n(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function scoringLabel(s: ScoringPreset): string {
  const rec = s.receptions === "half_ppr" ? "Half-PPR" : s.receptions === "standard" ? "Std" : "PPR";
  return `${rec}, ${s.passTd}pt pass TD${s.tePremium ? `, TE+${s.tePremium}` : ""}`;
}

function discordText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
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

const SUMMARY_METRICS: StatsMetric[] = [
  { label: "G", kind: "count", value: (p) => p.games, format: integer },
  { label: "FPTS", kind: "count", value: (p) => p.fpts },
  { label: "FPTS/G", kind: "rate", value: (p) => p.fptsPerGame },
  { label: "xFP", kind: "count", value: (p) => p.xfp },
  { label: "FPOE", kind: "count", value: (p) => p.fpoe },
  { label: "VORP", kind: "count", value: (p) => p.vorp },
  { label: "Start%", kind: "rate", value: (p) => p.startRate, format: (v) => pct(v) },
];
const PASSING_METRICS: StatsMetric[] = [
  { label: "CMP", kind: "count", value: (p) => value(p.box.completions), format: integer },
  { label: "ATT", kind: "count", value: (p) => value(p.box.attempts), format: integer },
  { label: "Pass Yds", kind: "count", value: (p) => value(p.box.passingYards), format: integer },
  { label: "Pass TD", kind: "count", value: (p) => value(p.box.passingTds), format: integer },
  { label: "INT", kind: "count", value: (p) => value(p.box.interceptions), format: integer },
];
const RUSHING_METRICS: StatsMetric[] = [
  { label: "ATT", kind: "count", value: (p) => value(p.box.carries), format: integer },
  { label: "Rush Yds", kind: "count", value: (p) => value(p.box.rushingYards), format: integer },
  { label: "Rush TD", kind: "count", value: (p) => value(p.box.rushingTds), format: integer },
  { label: "Rush 1D", kind: "count", value: (p) => value(p.box.rushingFirstDowns), format: integer },
  { label: "FD/Carry", kind: "rate", value: (p) => p.firstDownsPerCarry, format: (v) => n(v, 2) },
  { label: "Rush EPA", kind: "rate", value: (p) => p.rushingEpa, format: (v) => n(v, 2) },
];
const RECEIVING_METRICS: StatsMetric[] = [
  { label: "TGT", kind: "count", value: (p) => value(p.box.targets), format: integer },
  { label: "REC", kind: "count", value: (p) => value(p.box.receptions), format: integer },
  { label: "Rec Yds", kind: "count", value: (p) => value(p.box.receivingYards), format: integer },
  { label: "Rec TD", kind: "count", value: (p) => value(p.box.receivingTds), format: integer },
  { label: "Rec 1D", kind: "count", value: (p) => value(p.box.receivingFirstDowns), format: integer },
  { label: "Tgt%", kind: "rate", value: (p) => p.targetShare, format: (v) => pct(v) },
  { label: "TPRR", kind: "rate", value: (p) => p.targetsPerRoute, format: (v) => pct(v) },
  { label: "YPRR", kind: "rate", value: (p) => p.yprr, format: (v) => n(v, 2) },
  { label: "FD/RR", kind: "rate", value: (p) => p.firstDownsPerRoute, format: (v) => n(v, 2) },
  { label: "aDOT", kind: "rate", value: (p) => p.adot, format: (v) => n(v, 1) },
  { label: "Air Yds", kind: "count", value: (p) => p.airYards, format: integer },
  { label: "YAC", kind: "count", value: (p) => p.yac, format: integer },
  { label: "Routes", kind: "count", value: (p) => p.routesRun, format: integer },
  { label: "Snap%", kind: "rate", value: (p) => p.offenseSnapPct, format: (v) => pct(v) },
];

function metricText(metric: StatsMetric, player: StatsPlayerRow): string {
  const raw = metric.value(player);
  return raw == null ? "—" : (metric.format ?? ((v: number) => n(v)))(raw);
}

function table(rows: Array<{ label: string; values: string[] }>, headers: string[]): string {
  const widths = [Math.max(6, ...rows.map((row) => row.label.length)), ...headers.map((header, i) => Math.max(header.length, ...rows.map((row) => row.values[i]!.length)))];
  const format = (cells: string[]) => cells.map((cell, i) => cell.padEnd(widths[i]!)).join("  ").trimEnd();
  return `\`\`\`\n${format(["Metric", ...headers])}\n${rows.map((row) => format([row.label, ...row.values])).join("\n")}\n\`\`\``;
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
    .setDescription(`**${scope.toUpperCase()}** · ${when}\n_Scoring: ${scoringLabel(scoring)}_`)
    .setFooter({ text: "Data: nflverse / nflfastR · ffopportunity · FTN when present" });
  const groups = reportGroups([p], scope);
  if (!groups.length) embed.setDescription(`${embed.data.description}\n\n_No ${scope} statistics recorded for this period._`);
  for (const group of groups) {
    addTableFields(embed, group.name, group.metrics.map((metric) => ({ label: metric.label, values: [metricText(metric, p)] })), ["Value"]);
  }
  return embed;
}

const METRIC_LABELS: Record<string, string> = {
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
  fd: "First Downs",
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

function metricValue(p: StatsPlayerRow, metric: string): string {
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
  team?: string | null;
  minimumVolume?: LeaderboardMinimumVolume | null;
}): EmbedBuilder {
  const { players, season, week, position, metric, scoring, team, minimumVolume } = args;
  const when = week == null ? `${season} season` : `${season} W${week}`;
  const label = METRIC_LABELS[metric] ?? metric.toUpperCase();
  const lines: string[] = [];
  for (const [i, p] of players.entries()) {
    const playerLabel = discordText(
      `${p.playerName ?? "?"}${p.team ? ` (${p.team})` : ""}${p.position && (position === "FLEX" || position === "SUPERFLEX") ? ` ${p.position}` : ""}`,
      100,
    );
    const line = `**${i + 1}.** ${playerLabel} — **${metricValue(p, metric)}** · ${n(p.fpts)} FPTS`;
    if (lines.join("\n").length + line.length + 1 > 3_800) break;
    lines.push(line);
  }
  return new EmbedBuilder()
    .setTitle(discordText(`Top ${players.length} ${team ? `${team} ` : ""}${position} by ${label}`, 256))
    .setDescription(discordText(`**${when}** · ${scoringLabel(scoring)}\n\n${lines.join("\n") || "_No players_"}`, 4_096))
    .setFooter({
      text:
        "Data: nflverse / nflfastR · ffopportunity · FTN when present" +
        (minimumVolume ? ` · min ${minimumVolume.value} ${minimumVolume.unit}` : "") +
        (team ? ` · ${team} filter; rows without team data are excluded` : ""),
    });
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
    .setDescription(`**${scope.toUpperCase()}** · ${when}\n_Scoring: ${scoringLabel(scoring)}_`)
    .setFooter({ text: "Data: nflverse / nflfastR · ffopportunity · FTN when present" });

  const headers = players.map((p) => discordText(p.playerName ?? "Player", 14));
  const details = players
    .map((p) => `${p.playerName ?? "Player"}${p.team ? ` (${p.team}` : ""}${p.position ? ` ${p.position}` : ""}${p.team ? ")" : ""}`)
    .join(" · ");
  embed.setDescription(discordText(`${embed.data.description}\n${details}`, 4_096));
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
    .setDescription(`**${scope.toUpperCase()}** · ${seasons[0]!.season}–${seasons.at(-1)!.season}\n_Scoring: ${scoringLabel(scoring)}_`)
    .setFooter({ text: "17G = combined seasonal totals ÷ combined G × 17; rate metrics show Avg only · Data: nflverse / nflfastR" });
  const headers = [...seasons.map((entry) => String(entry.season)), "Avg", "17G Avg"];
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
        values: [...values, average == null ? "—" : (metric.format ?? ((v: number) => n(v)))(average), seventeenGame == null ? "—" : (metric.format ?? ((v: number) => n(v)))(seventeenGame)],
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
  { name: "First Downs", value: "fd" },
  { name: "Rush First Downs", value: "rush_fd" },
  { name: "Rec First Downs", value: "rec_fd" },
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

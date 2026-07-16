import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ScoringPreset } from "../../domain/fantasyScoring.js";
import type { StatsPlayerRow } from "./leaderboardQuery.js";
import {
  formatLeaderMetricValue,
  LEADER_METRIC_LABELS,
  type PlayerStatsScope,
} from "./discordReports.js";

type Metric = {
  label: string;
  value: (player: StatsPlayerRow) => number | null | undefined;
  format?: (value: number) => string;
};

type Group = { title: string; metrics: Metric[] };

const count = (value: number) => String(Math.round(value));
const decimal = (value: number, digits = 1) =>
  value.toFixed(digits).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1");
const percent = (value: number) => `${Math.round(value * 100)}%`;
const number = (value: number | null | undefined) => (value != null && Number.isFinite(value) ? value : null);

const FONT_FAMILY = "InterStats";
let fontsRegistered = false;

function registerFonts(): void {
  if (fontsRegistered) return;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(process.cwd(), "assets", "fonts"),
    path.join(here, "..", "..", "..", "assets", "fonts"),
  ];
  const fontDir = candidates.find((dir) => fs.existsSync(path.join(dir, "Inter-Regular.ttf")));
  if (!fontDir) {
    throw new Error(
      `Stats image fonts missing (looked in ${candidates.join(", ")}). Bundle assets/fonts with the bot.`,
    );
  }
  GlobalFonts.registerFromPath(path.join(fontDir, "Inter-Regular.ttf"), FONT_FAMILY);
  const bold = path.join(fontDir, "Inter-Bold.ttf");
  const semi = path.join(fontDir, "Inter-SemiBold.ttf");
  if (fs.existsSync(bold)) GlobalFonts.registerFromPath(bold, FONT_FAMILY);
  if (fs.existsSync(semi)) GlobalFonts.registerFromPath(semi, FONT_FAMILY);
  fontsRegistered = true;
}

function font(weight: 400 | 500 | 600 | 700, size: number): string {
  return `${weight} ${size}px ${FONT_FAMILY}`;
}

const SUMMARY: Metric[] = [
  { label: "G", value: (p) => p.games, format: count },
  { label: "FPTS", value: (p) => p.fpts, format: (v) => decimal(v) },
  { label: "FPG", value: (p) => p.fptsPerGame, format: (v) => decimal(v) },
  { label: "xFP", value: (p) => p.xfp, format: (v) => decimal(v) },
  { label: "FPOE", value: (p) => p.fpoe, format: (v) => decimal(v) },
  { label: "VORP", value: (p) => p.vorp, format: (v) => decimal(v) },
  { label: "Start%", value: (p) => p.startRate, format: percent },
];
const PASS: Metric[] = [
  { label: "Cmp", value: (p) => number(p.box.completions), format: count },
  { label: "Att", value: (p) => number(p.box.attempts), format: count },
  { label: "Yds", value: (p) => number(p.box.passingYards), format: count },
  { label: "TD", value: (p) => number(p.box.passingTds), format: count },
  { label: "INT", value: (p) => number(p.box.interceptions), format: count },
];
const RUSH: Metric[] = [
  { label: "Att", value: (p) => number(p.box.carries), format: count },
  { label: "Yds", value: (p) => number(p.box.rushingYards), format: count },
  { label: "TD", value: (p) => number(p.box.rushingTds), format: count },
  { label: "1D", value: (p) => number(p.box.rushingFirstDowns), format: count },
  { label: "FD/C", value: (p) => p.firstDownsPerCarry, format: (v) => decimal(v, 2) },
  { label: "EPA", value: (p) => p.rushingEpa, format: (v) => decimal(v, 2) },
];
const REC: Metric[] = [
  { label: "Tgt", value: (p) => number(p.box.targets), format: count },
  { label: "Rec", value: (p) => number(p.box.receptions), format: count },
  { label: "Yds", value: (p) => number(p.box.receivingYards), format: count },
  { label: "TD", value: (p) => number(p.box.receivingTds), format: count },
  { label: "1D", value: (p) => number(p.box.receivingFirstDowns), format: count },
  { label: "Tgt%", value: (p) => p.targetShare, format: percent },
  { label: "TPRR", value: (p) => p.targetsPerRoute, format: percent },
  { label: "YPRR", value: (p) => p.yprr, format: (v) => decimal(v, 2) },
  { label: "aDOT", value: (p) => p.adot, format: (v) => decimal(v) },
  { label: "Air", value: (p) => p.airYards, format: count },
  { label: "YAC", value: (p) => p.yac, format: count },
  { label: "Rts", value: (p) => p.routesRun, format: count },
  { label: "Snap%", value: (p) => p.offenseSnapPct, format: percent },
];

function hasValue(player: StatsPlayerRow, metrics: Metric[]): boolean {
  return metrics.some((metric) => metric.value(player) != null && metric.value(player) !== 0);
}

function groupsFor(players: StatsPlayerRow[], scope: PlayerStatsScope): Group[] {
  const include = (title: string, metrics: Metric[]) =>
    players.some((player) => hasValue(player, metrics))
      ? [{ title, metrics: metrics.filter((metric) => players.some((player) => metric.value(player) != null)) }]
      : [];
  if (scope === "passing") return include("PASS", PASS);
  if (scope === "rushing") return include("RUSH", RUSH);
  if (scope === "receiving") return include("REC", REC);
  return [
    ...include("FANTASY", SUMMARY),
    ...include("PASS", PASS),
    ...include("RUSH", RUSH),
    ...include("REC", REC),
  ];
}

function scoringLabel(scoring: ScoringPreset): string {
  const reception = scoring.receptions === "half_ppr" ? "Half PPR" : scoring.receptions === "standard" ? "Standard" : "PPR";
  return `${reception} · ${scoring.passTd}pt pass TD${scoring.tePremium ? ` · TE+${scoring.tePremium}` : ""}`;
}

function rowValue(metric: Metric, player: StatsPlayerRow | null): string {
  if (!player) return "—";
  const raw = metric.value(player);
  return raw == null || !Number.isFinite(raw) ? "—" : (metric.format ?? ((value: number) => decimal(value)))(raw);
}

function playerColumnHeader(player: StatsPlayerRow): string {
  const name = (player.playerName ?? "Player").trim();
  return name.length <= 15 ? name : `${name.slice(0, 14)}…`;
}

type ScatterAxis = {
  metric: string;
  label: string;
  value: (player: StatsPlayerRow) => number | null;
  percent?: boolean;
};

export type LeadersScatterConfig = {
  x: ScatterAxis;
  y: ScatterAxis;
};

/** @deprecated Use LeadersScatterConfig. */
export type ReceivingScatterConfig = LeadersScatterConfig;

const targetAxis: ScatterAxis = {
  metric: "tgt",
  label: "Targets",
  value: (player) => number(player.box.targets),
};
const carryAxis: ScatterAxis = {
  metric: "att",
  label: "Carries",
  value: (player) => number(player.box.carries),
};
const passAttemptAxis: ScatterAxis = {
  metric: "pass_att",
  label: "Pass attempts",
  value: (player) => number(player.box.attempts),
};
const routeAxis: ScatterAxis = {
  metric: "routes",
  label: "Routes",
  value: (player) => number(player.routesRun),
};
const snapAxis: ScatterAxis = {
  metric: "snaps",
  label: "Snaps",
  value: (player) => number(player.offenseSnaps),
};
const targetShareAxis: ScatterAxis = {
  metric: "tgt_pct",
  label: "Tgt%",
  value: (player) => number(player.targetShare),
  percent: true,
};
const yprrAxis: ScatterAxis = {
  metric: "yprr",
  label: "YPRR",
  value: (player) => number(player.yprr),
};
const firstDownsPerCarryAxis: ScatterAxis = {
  metric: "fd_carry",
  label: "FD/Carry",
  value: (player) => number(player.firstDownsPerCarry),
};
const ypaAxis: ScatterAxis = {
  metric: "ypa",
  label: "YPA",
  value: (player) => {
    const attempts = player.box.attempts;
    const yards = player.box.passingYards;
    return attempts != null && attempts > 0 && yards != null ? yards / attempts : null;
  },
};

const receivingRateAxes: Record<string, ScatterAxis> = {
  tgt_pct: targetShareAxis,
  tprr: { metric: "tprr", label: "TPRR", value: (player) => number(player.targetsPerRoute), percent: true },
  yprr: yprrAxis,
  adot: { metric: "adot", label: "aDOT", value: (player) => number(player.adot) },
  fd_rr: { metric: "fd_rr", label: "FD/RR", value: (player) => number(player.firstDownsPerRoute) },
  rec_epa: { metric: "rec_epa", label: "Rec EPA", value: (player) => number(player.receivingEpa) },
  snap_pct: { metric: "snap_pct", label: "Snap%", value: (player) => number(player.offenseSnapPct), percent: true },
};

/** Defines the scatter plots used by stats-leaders image output. */
export function leadersScatterConfig(metric: string): LeadersScatterConfig | null {
  const normalized = metric.toLowerCase();
  const rateAxis = receivingRateAxes[normalized];
  if (rateAxis) {
    return {
      x: normalized === "snap_pct" ? snapAxis : ["yprr", "tprr", "fd_rr"].includes(normalized) ? routeAxis : targetAxis,
      y: rateAxis,
    };
  }
  if (["tgt", "rec", "rec_yds", "air_yds", "rec_fd"].includes(normalized)) {
    return { x: targetAxis, y: targetShareAxis };
  }
  if (normalized === "routes") return { x: routeAxis, y: yprrAxis };
  if (["rush_epa", "fd_carry"].includes(normalized)) {
    return {
      x: carryAxis,
      y: normalized === "rush_epa"
        ? { metric: "rush_epa", label: "Rush EPA", value: (player) => number(player.rushingEpa) }
        : firstDownsPerCarryAxis,
    };
  }
  if (["rush_yds", "rush_fd"].includes(normalized)) return { x: carryAxis, y: firstDownsPerCarryAxis };
  if (normalized === "pass_yds") return { x: passAttemptAxis, y: ypaAxis };
  return null;
}

/** @deprecated Use leadersScatterConfig. */
export const receivingScatterConfig = leadersScatterConfig;

function abbreviatedName(player: StatsPlayerRow): string {
  const words = (player.playerName ?? "Player").trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return words[0] ?? "Player";
  const surname = words.filter((word) => !/^(jr|sr|ii|iii|iv)\.?$/i.test(word)).at(-1) ?? words.at(-1)!;
  return `${words[0]![0]}. ${surname}`;
}

function scatterAxisText(axis: ScatterAxis, value: number): string {
  if (axis.percent) return `${Math.round(value * 100)}%`;
  return ["yprr", "fd_rr", "fd_carry", "rec_epa", "rush_epa", "adot", "ypa"].includes(axis.metric)
    ? decimal(value, 1)
    : count(value);
}

function scatterSubtitle(args: {
  season: number;
  week: number | null;
  scoring: ScoringPreset;
  team?: string | null;
  minimumVolume?: { value: number; unit: string } | null;
}): string {
  const period = args.week == null ? "Season" : `Week ${args.week}`;
  return [
    period,
    scoringLabel(args.scoring),
    args.minimumVolume ? `min ${args.minimumVolume.value} ${args.minimumVolume.unit}` : null,
    args.team ? `highlights: ${args.team} filter` : null,
  ].filter(Boolean).join(" · ");
}

function truncate(ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && ctx.measureText(`${result}…`).width > maxWidth) result = result.slice(0, -1);
  return `${result}…`;
}

export function renderLeadersScatterImage(args: {
  cohort: StatsPlayerRow[];
  highlights: StatsPlayerRow[];
  season: number;
  week: number | null;
  position: string;
  metric: string;
  scoring: ScoringPreset;
  team?: string | null;
  minimumVolume?: { value: number; unit: string } | null;
}): Buffer {
  registerFonts();
  const config = leadersScatterConfig(args.metric);
  if (!config) throw new Error(`No scatter configuration for ${args.metric}`);

  const points = args.cohort
    .map((player) => ({ player, x: config.x.value(player), y: config.y.value(player) }))
    .filter((point): point is { player: StatsPlayerRow; x: number; y: number } => point.x != null && point.y != null);
  const highlighted = args.highlights
    .map((player) => ({ player, x: config.x.value(player), y: config.y.value(player) }))
    .filter((point): point is { player: StatsPlayerRow; x: number; y: number } => point.x != null && point.y != null);

  const width = 1200;
  const height = 800;
  const chart = { left: 112, top: 238, right: 1140, bottom: 684 };
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#101724";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#182235";
  ctx.fillRect(0, 0, width, 180);
  ctx.fillStyle = "#68d7ff";
  ctx.fillRect(0, 176, width, 4);
  ctx.fillStyle = "#f4f7fb";
  ctx.font = font(700, 36);
  ctx.fillText(`${args.season} ${args.position} · ${config.x.label} vs ${config.y.label}`, 42, 58);
  ctx.fillStyle = "#b9c6da";
  ctx.font = font(500, 21);
  ctx.fillText(scatterSubtitle(args), 42, 94);
  ctx.fillStyle = "#91a4c2";
  ctx.font = font(400, 17);
  ctx.fillText(
    `${points.length} volume-qualified players · highlighted: top ${highlighted.length} by ${LEADER_METRIC_LABELS[args.metric] ?? args.metric.toUpperCase()}`,
    42,
    126,
  );

  const allPoints = [...points, ...highlighted];
  const xMax = Math.max(1, ...allPoints.map((point) => point.x));
  const yValues = allPoints.map((point) => point.y);
  const yRawMin = yValues.length ? Math.min(...yValues) : 0;
  const yRawMax = yValues.length ? Math.max(...yValues) : 1;
  const yPadding = Math.max((yRawMax - yRawMin) * 0.12, config.y.percent ? 0.02 : 0.1);
  const yMin = Math.min(config.y.percent || yRawMin >= 0 ? 0 : yRawMin - yPadding, yRawMin - yPadding);
  const yMax = Math.max(yMin + 1, yRawMax + yPadding);
  const scaleX = (value: number) => chart.left + (value / xMax) * (chart.right - chart.left);
  const scaleY = (value: number) => chart.bottom - ((value - yMin) / (yMax - yMin)) * (chart.bottom - chart.top);

  ctx.strokeStyle = "#2b3a55";
  ctx.lineWidth = 1;
  ctx.font = font(400, 16);
  for (let tick = 0; tick <= 5; tick += 1) {
    const y = chart.top + ((chart.bottom - chart.top) * tick) / 5;
    const value = yMax - ((yMax - yMin) * tick) / 5;
    ctx.beginPath();
    ctx.moveTo(chart.left, y);
    ctx.lineTo(chart.right, y);
    ctx.stroke();
    ctx.fillStyle = "#91a4c2";
    ctx.textAlign = "right";
    ctx.fillText(scatterAxisText(config.y, value), chart.left - 14, y + 5);
  }
  for (let tick = 0; tick <= 5; tick += 1) {
    const x = chart.left + ((chart.right - chart.left) * tick) / 5;
    const value = (xMax * tick) / 5;
    ctx.beginPath();
    ctx.moveTo(x, chart.top);
    ctx.lineTo(x, chart.bottom);
    ctx.stroke();
    ctx.fillStyle = "#91a4c2";
    ctx.textAlign = "center";
    ctx.fillText(scatterAxisText(config.x, value), x, chart.bottom + 28);
  }
  ctx.strokeStyle = "#6f829f";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(chart.left, chart.top);
  ctx.lineTo(chart.left, chart.bottom);
  ctx.lineTo(chart.right, chart.bottom);
  ctx.stroke();

  for (const point of points) {
    ctx.beginPath();
    ctx.arc(scaleX(point.x), scaleY(point.y), 5, 0, Math.PI * 2);
    ctx.fillStyle = "#6d86aa99";
    ctx.fill();
  }
  const usedLabels: Array<{ x: number; y: number }> = [];
  for (const point of highlighted) {
    const x = scaleX(point.x);
    const y = scaleY(point.y);
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#68d7ff";
    ctx.fill();
    ctx.strokeStyle = "#e8f7ff";
    ctx.lineWidth = 2;
    ctx.stroke();
    let labelY = y - 12;
    while (usedLabels.some((label) => Math.abs(label.x - x) < 80 && Math.abs(label.y - labelY) < 17)) labelY -= 17;
    usedLabels.push({ x, y: labelY });
    ctx.fillStyle = "#f4f7fb";
    ctx.font = font(600, 15);
    ctx.textAlign = x > chart.right - 95 ? "right" : "left";
    ctx.fillText(truncate(ctx, abbreviatedName(point.player), 105), x > chart.right - 95 ? x - 10 : x + 10, labelY);
  }
  ctx.textAlign = "center";
  ctx.fillStyle = "#c7d3e6";
  ctx.font = font(600, 19);
  ctx.fillText(config.x.label, (chart.left + chart.right) / 2, height - 42);
  ctx.save();
  ctx.translate(34, (chart.top + chart.bottom) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(config.y.label, 0, 0);
  ctx.restore();
  ctx.textAlign = "left";
  ctx.fillStyle = "#7f91ad";
  ctx.font = font(400, 15);
  ctx.fillText("Data: nflverse / nflfastR · ffopportunity · FTN when present", 42, height - 16);
  return canvas.toBuffer("image/png");
}

/** @deprecated Use renderLeadersScatterImage. */
export const renderReceivingScatterImage = renderLeadersScatterImage;

export function renderLeadersImage(args: {
  players: StatsPlayerRow[];
  season: number;
  week: number | null;
  position: string;
  metric: string;
  extraMetrics?: string[];
  scoring: ScoringPreset;
  team?: string | null;
  minimumVolume?: { value: number; unit: string } | null;
}): Buffer {
  registerFonts();
  const { players, season, week, position, metric, extraMetrics = [], scoring, team, minimumVolume } = args;
  const metrics = [metric, ...extraMetrics.filter((candidate) => candidate !== metric)]
    .filter((candidate, index, values) => values.indexOf(candidate) === index);
  const width = 1200;
  const height = Math.max(300, 210 + players.length * 42 + 54);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const period = week == null ? `${season} season` : `${season} · Week ${week}`;

  ctx.fillStyle = "#101724";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#182235";
  ctx.fillRect(0, 0, width, 150);
  ctx.fillStyle = "#68d7ff";
  ctx.fillRect(0, 146, width, 4);
  ctx.fillStyle = "#f4f7fb";
  ctx.font = font(700, 36);
  ctx.fillText(`Top ${players.length} ${team ? `${team} ` : ""}${position}`, 42, 56);
  ctx.fillStyle = "#b9c6da";
  ctx.font = font(500, 22);
  ctx.fillText(`BY ${LEADER_METRIC_LABELS[metric] ?? metric.toUpperCase()}`, 42, 90);
  ctx.fillStyle = "#91a4c2";
  ctx.font = font(400, 19);
  ctx.fillText(`${period} · ${scoringLabel(scoring)}`, 42, 122);

  const rankX = 52;
  const playerX = 112;
  const metricsStartX = 505;
  const metricWidth = (width - metricsStartX - 42) / metrics.length;
  let y = 188;
  ctx.fillStyle = "#24324b";
  ctx.fillRect(34, y - 27, width - 68, 36);
  ctx.fillStyle = "#68d7ff";
  ctx.font = font(700, 17);
  ctx.fillText("RANK", rankX, y - 3);
  ctx.fillText("PLAYER", playerX, y - 3);
  ctx.fillStyle = "#c7d3e6";
  ctx.textAlign = "right";
  metrics.forEach((displayMetric, index) => {
    ctx.fillText(
      LEADER_METRIC_LABELS[displayMetric] ?? displayMetric.toUpperCase(),
      metricsStartX + metricWidth * (index + 1) - 8,
      y - 3,
    );
  });
  ctx.textAlign = "left";
  y += 34;
  players.forEach((player, index) => {
    if (index % 2 === 0) {
      ctx.fillStyle = "#151f30";
      ctx.fillRect(34, y - 25, width - 68, 38);
    }
    ctx.fillStyle = "#68d7ff";
    ctx.font = font(700, 19);
    ctx.fillText(String(index + 1), rankX, y);
    ctx.fillStyle = "#dce6f5";
    ctx.font = font(500, 20);
    const playerLabel = `${player.playerName ?? "?"}${player.team ? ` (${player.team})` : ""}${player.position ? ` ${player.position}` : ""}`;
    ctx.fillText(truncate(ctx, playerLabel, metricsStartX - playerX - 18), playerX, y);
    ctx.fillStyle = "#ffffff";
    ctx.font = font(600, 20);
    ctx.textAlign = "right";
    metrics.forEach((displayMetric, metricIndex) => {
      ctx.fillText(formatLeaderMetricValue(player, displayMetric), metricsStartX + metricWidth * (metricIndex + 1) - 8, y);
    });
    ctx.textAlign = "left";
    y += 42;
  });
  ctx.fillStyle = "#7f91ad";
  ctx.font = font(400, 16);
  const footer = "Data: nflverse / nflfastR · ffopportunity · FTN when present" +
    (minimumVolume ? ` · min ${minimumVolume.value} ${minimumVolume.unit}` : "") +
    (team ? ` · ${team} filter` : "");
  ctx.fillText(truncate(ctx, footer, width - 84), 42, height - 28);
  return canvas.toBuffer("image/png");
}

export function renderPlayerStatsImage(args: {
  playerName: string;
  playerTeam: string | null;
  playerPosition: string | null;
  seasons: Array<{ season: number; player: StatsPlayerRow | null }>;
  scope: PlayerStatsScope;
  scoring: ScoringPreset;
  week?: number | null;
}): Buffer {
  registerFonts();
  const { playerName, playerTeam, playerPosition, seasons, scope, scoring, week = null } = args;
  const players = seasons.flatMap((entry) => (entry.player ? [entry.player] : []));
  const groups = groupsFor(players, scope);
  const headers = seasons.length === 1
    ? ["VALUE"]
    : [...seasons.map((entry) => String(entry.season).slice(-2)), "AVG", "17G"];
  const rows = groups.reduce((total, group) => total + group.metrics.length + 1, 0);
  const width = 1080;
  const height = Math.max(320, 170 + rows * 42 + groups.length * 16 + 56);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#101724";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#182235";
  ctx.fillRect(0, 0, width, 150);
  ctx.fillStyle = "#68d7ff";
  ctx.fillRect(0, 146, width, 4);

  ctx.fillStyle = "#f4f7fb";
  ctx.font = font(700, 36);
  ctx.fillText(playerName, 42, 56);
  ctx.fillStyle = "#b9c6da";
  ctx.font = font(500, 22);
  const identity = [playerTeam, playerPosition].filter(Boolean).join(" · ");
  ctx.fillText(`${identity ? `${identity} · ` : ""}${scope.toUpperCase()} STATS`, 42, 90);
  const period = week != null
    ? `${seasons[0]?.season ?? ""} · Week ${week}`
    : seasons.length === 1
      ? `${seasons[0]?.season ?? ""} season`
      : `${seasons[0]?.season}–${seasons.at(-1)?.season} · AVG = yearly average · 17G = totals/game × 17`;
  ctx.fillStyle = "#91a4c2";
  ctx.font = font(400, 19);
  ctx.fillText(`${period} · ${scoringLabel(scoring)}`, 42, 122);

  const labelX = 50;
  const startX = 300;
  const colWidth = (width - startX - 42) / headers.length;
  let y = 184;
  for (const group of groups) {
    ctx.fillStyle = "#24324b";
    ctx.fillRect(34, y - 26, width - 68, 34);
    ctx.fillStyle = "#68d7ff";
    ctx.font = font(700, 18);
    ctx.fillText(group.title, labelX, y - 3);
    ctx.fillStyle = "#c7d3e6";
    ctx.font = font(700, 17);
    headers.forEach((header, index) => {
      ctx.textAlign = "right";
      ctx.fillText(header, startX + colWidth * (index + 1) - 8, y - 3);
    });
    ctx.textAlign = "left";
    y += 30;
    group.metrics.forEach((metric, rowIndex) => {
      if (rowIndex % 2 === 0) {
        ctx.fillStyle = "#151f30";
        ctx.fillRect(34, y - 24, width - 68, 34);
      }
      ctx.fillStyle = "#dce6f5";
      ctx.font = font(500, 20);
      ctx.fillText(metric.label, labelX, y);
      const values = seasons.length === 1
        ? [rowValue(metric, seasons[0]?.player ?? null)]
        : [
            ...seasons.map((entry) => rowValue(metric, entry.player)),
            averageMetric(metric, players),
            seventeenGameMetric(metric, players),
          ];
      ctx.fillStyle = "#ffffff";
      ctx.font = font(600, 20);
      ctx.textAlign = "right";
      values.forEach((value, index) => ctx.fillText(value, startX + colWidth * (index + 1) - 8, y));
      ctx.textAlign = "left";
      y += 34;
    });
    y += 16;
  }
  ctx.fillStyle = "#7f91ad";
  ctx.font = font(400, 16);
  ctx.fillText(
    "FPTS = fantasy points · FPG = fantasy points/game · xFP = expected fantasy points · FPOE = fantasy points over expected",
    42,
    height - 28,
  );
  return canvas.toBuffer("image/png");
}

export function renderPlayerCompareImage(args: {
  players: StatsPlayerRow[];
  season: number;
  week: number | null;
  scope: PlayerStatsScope;
  scoring: ScoringPreset;
}): Buffer {
  registerFonts();
  const { players, season, week, scope, scoring } = args;
  const groups = groupsFor(players, scope);
  const headers = players.map(playerColumnHeader);
  const rows = groups.reduce((total, group) => total + group.metrics.length + 1, 0);
  const width = 1080;
  const height = Math.max(320, 170 + rows * 42 + groups.length * 16 + 56);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#101724";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#182235";
  ctx.fillRect(0, 0, width, 150);
  ctx.fillStyle = "#68d7ff";
  ctx.fillRect(0, 146, width, 4);

  ctx.fillStyle = "#f4f7fb";
  ctx.font = font(700, 36);
  ctx.fillText("Player comparison", 42, 56);
  ctx.fillStyle = "#b9c6da";
  ctx.font = font(500, 22);
  ctx.fillText(`${scope.toUpperCase()} STATS`, 42, 90);
  ctx.fillStyle = "#91a4c2";
  ctx.font = font(400, 19);
  const period = week == null ? `${season} season` : `${season} · Week ${week}`;
  ctx.fillText(`${period} · ${scoringLabel(scoring)}`, 42, 122);

  const labelX = 50;
  const startX = 300;
  const colWidth = (width - startX - 42) / headers.length;
  let y = 184;
  for (const group of groups) {
    ctx.fillStyle = "#24324b";
    ctx.fillRect(34, y - 26, width - 68, 34);
    ctx.fillStyle = "#68d7ff";
    ctx.font = font(700, 18);
    ctx.fillText(group.title, labelX, y - 3);
    ctx.fillStyle = "#c7d3e6";
    ctx.font = font(700, 17);
    headers.forEach((header, index) => {
      ctx.textAlign = "right";
      ctx.fillText(header, startX + colWidth * (index + 1) - 8, y - 3);
    });
    ctx.textAlign = "left";
    y += 30;
    group.metrics.forEach((metric, rowIndex) => {
      if (rowIndex % 2 === 0) {
        ctx.fillStyle = "#151f30";
        ctx.fillRect(34, y - 24, width - 68, 34);
      }
      ctx.fillStyle = "#dce6f5";
      ctx.font = font(500, 20);
      ctx.fillText(metric.label, labelX, y);
      ctx.fillStyle = "#ffffff";
      ctx.font = font(600, 20);
      ctx.textAlign = "right";
      players.forEach((player, index) => {
        ctx.fillText(rowValue(metric, player), startX + colWidth * (index + 1) - 8, y);
      });
      ctx.textAlign = "left";
      y += 34;
    });
    y += 16;
  }
  ctx.fillStyle = "#7f91ad";
  ctx.font = font(400, 16);
  ctx.fillText(
    "FPTS = fantasy points · FPG = fantasy points/game · xFP = expected fantasy points · FPOE = fantasy points over expected",
    42,
    height - 28,
  );
  return canvas.toBuffer("image/png");
}

function averageMetric(metric: Metric, players: StatsPlayerRow[]): string {
  const values = players.map(metric.value).filter((value): value is number => value != null && Number.isFinite(value));
  if (!values.length) return "—";
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return (metric.format ?? ((value: number) => decimal(value)))(average);
}

function seventeenGameMetric(metric: Metric, players: StatsPlayerRow[]): string {
  const values = players
    .map((player) => ({ value: metric.value(player), games: player.games }))
    .filter((entry): entry is { value: number; games: number } => entry.value != null && Number.isFinite(entry.value) && entry.games > 0);
  if (!values.length || metric.label.includes("%") || ["FPG", "FD/C", "EPA", "TPRR", "YPRR", "aDOT", "Start%"].includes(metric.label)) return "—";
  const projected = (values.reduce((sum, entry) => sum + entry.value, 0) / values.reduce((sum, entry) => sum + entry.games, 0)) * 17;
  return (metric.format ?? ((value: number) => decimal(value)))(projected);
}

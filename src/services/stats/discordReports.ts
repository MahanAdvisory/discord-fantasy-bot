import { EmbedBuilder } from "discord.js";
import type { ScoringPreset } from "../../domain/fantasyScoring.js";
import type { StatsPlayerRow } from "./leaderboardQuery.js";

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

  const lines: string[] = [];
  if (scope === "receiving" || scope === "summary") {
    if (scope === "receiving") {
      lines.push(
        `**REC** ${p.box.receptions ?? 0} · **YDS** ${p.box.receivingYards ?? 0} · **TD** ${p.box.receivingTds ?? 0} · **TGT** ${p.box.targets ?? 0}`,
        `**FPTS** ${n(p.fpts)} · **xFP** ${n(p.xfp)} · **FPOE** ${n(p.fpoe)} · **VORP** ${n(p.vorp)}`,
        `**Tgt%** ${pct(p.targetShare)} · **TPRR** ${pct(p.targetsPerRoute)} · **YPRR** ${n(p.yprr, 2)}`,
        `**aDOT** ${n(p.adot, 1)} · **Air Yds** ${p.airYards ?? "—"} · **YAC** ${p.yac ?? "—"}`,
        `**RACR** ${n(p.racr, 2)} · **WOPR** ${n(p.wopr, 2)} · **Rec EPA** ${n(p.receivingEpa, 2)}`,
        `**Catch%** ${pct(p.catchRate)} · **Routes** ${p.routesRun ?? "—"} · **Route%** ${pct(p.routePct)}`,
        `**Snaps** ${p.offenseSnaps ?? "—"} · **Snap%** ${pct(p.offenseSnapPct)} · **G** ${p.games}`,
      );
    }
  }
  if (scope === "rushing") {
    const ypc =
      p.box.carries && p.box.carries > 0 && p.box.rushingYards != null
        ? p.box.rushingYards / p.box.carries
        : null;
    lines.push(
      `**ATT** ${p.box.carries ?? 0} · **YDS** ${p.box.rushingYards ?? 0} · **TD** ${p.box.rushingTds ?? 0} · **YPC** ${n(ypc, 2)}`,
      `**FPTS** ${n(p.fpts)} · **xFP** ${n(p.xfp)} · **FPOE** ${n(p.fpoe)} · **VORP** ${n(p.vorp)}`,
      `**Rush EPA** ${n(p.rushingEpa, 2)} · **Snaps** ${p.offenseSnaps ?? "—"} · **Snap%** ${pct(p.offenseSnapPct)} · **G** ${p.games}`,
    );
  }
  if (scope === "passing") {
    lines.push(
      `**CMP/ATT** ${p.box.completions ?? 0}/${p.box.attempts ?? 0} · **YDS** ${p.box.passingYards ?? 0} · **TD** ${p.box.passingTds ?? 0} · **INT** ${p.box.interceptions ?? 0}`,
      `**FPTS** ${n(p.fpts)} · **xFP** ${n(p.xfp)} · **FPOE** ${n(p.fpoe)} · **VORP** ${n(p.vorp)}`,
      `**G** ${p.games} · **FPTS/G** ${n(p.fptsPerGame)}`,
    );
  }
  if (scope === "summary") {
    lines.push(
      `**G** ${p.games} · **FPTS** ${n(p.fpts)} · **FPTS/G** ${n(p.fptsPerGame)} · **VORP** ${n(p.vorp)}`,
      `**xFP** ${n(p.xfp)} · **FPOE** ${n(p.fpoe)} · **${ownershipRateLabel(p)}** ${pct(p.startRate)}`,
    );
    if (p.position === "QB" || (p.box.attempts ?? 0) > 0) {
      lines.push(
        `Pass: ${p.box.completions ?? 0}/${p.box.attempts ?? 0}, ${p.box.passingYards ?? 0} yds, ${p.box.passingTds ?? 0} TD, ${p.box.interceptions ?? 0} INT`,
      );
    }
    if ((p.box.carries ?? 0) > 0 || p.position === "RB") {
      lines.push(`Rush: ${p.box.carries ?? 0} att, ${p.box.rushingYards ?? 0} yds, ${p.box.rushingTds ?? 0} TD · EPA ${n(p.rushingEpa, 2)}`);
    }
    if ((p.box.targets ?? 0) > 0 || p.position === "WR" || p.position === "TE") {
      lines.push(
        `Rec: ${p.box.receptions ?? 0}/${p.box.targets ?? 0}, ${p.box.receivingYards ?? 0} yds, ${p.box.receivingTds ?? 0} TD`,
        `Tgt% ${pct(p.targetShare)} · TPRR ${pct(p.targetsPerRoute)} · YPRR ${n(p.yprr, 2)} · aDOT ${n(p.adot, 1)} · Rec EPA ${n(p.receivingEpa, 2)}`,
      );
    }
  }

  embed.setDescription(discordText(`${embed.data.description}\n\n${lines.join("\n")}`, 4_096));
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
}): EmbedBuilder {
  const { players, season, week, position, metric, scoring, team } = args;
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

  for (const p of players) {
    const lines = [
      `**G** ${p.games} · **FPTS** ${n(p.fpts)} · **FPTS/G** ${n(p.fptsPerGame)} · **xFP** ${n(p.xfp)} · **FPOE** ${n(p.fpoe)} · **${ownershipRateLabel(p)}** ${pct(p.startRate)}`,
    ];
    if (scope === "passing") {
      lines.push(
        `**CMP/ATT** ${p.box.completions ?? 0}/${p.box.attempts ?? 0} · **YDS** ${p.box.passingYards ?? 0} · **TD** ${p.box.passingTds ?? 0} · **INT** ${p.box.interceptions ?? 0}`,
      );
    } else if (scope === "rushing") {
      lines.push(
        `**ATT** ${p.box.carries ?? 0} · **YDS** ${p.box.rushingYards ?? 0} · **TD** ${p.box.rushingTds ?? 0} · **EPA** ${n(p.rushingEpa, 2)}`,
      );
    } else if (scope === "receiving") {
      lines.push(
        `**REC/TGT** ${p.box.receptions ?? 0}/${p.box.targets ?? 0} · **YDS** ${p.box.receivingYards ?? 0} · **TD** ${p.box.receivingTds ?? 0}`,
        `**Tgt%** ${pct(p.targetShare)} · **TPRR** ${pct(p.targetsPerRoute)} · **YPRR** ${n(p.yprr, 2)}`,
      );
    } else {
      lines.push(
        `Pass: ${p.box.passingYards ?? 0} yds · ${p.box.passingTds ?? 0} TD · ${p.box.interceptions ?? 0} INT`,
        `Rush: ${p.box.carries ?? 0} att · ${p.box.rushingYards ?? 0} yds · ${p.box.rushingTds ?? 0} TD`,
        `Rec: ${p.box.receptions ?? 0}/${p.box.targets ?? 0} · ${p.box.receivingYards ?? 0} yds · ${p.box.receivingTds ?? 0} TD`,
      );
    }
    embed.addFields({
      name: discordText(`${p.playerName ?? "Player"}${p.team ? ` (${p.team})` : ""}${p.position ? ` · ${p.position}` : ""}`, 256),
      value: discordText(lines.join("\n"), 1_024),
      inline: false,
    });
  }
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
  { name: "Targets", value: "tgt" },
  { name: "Receptions", value: "rec" },
  { name: "Rec Yards", value: "rec_yds" },
  { name: "Rush Yards", value: "rush_yds" },
  { name: "Pass Yards", value: "pass_yds" },
  { name: "Air Yards", value: "air_yds" },
  { name: "Routes", value: "routes" },
  { name: "Snap%", value: "snap_pct" },
] as const;

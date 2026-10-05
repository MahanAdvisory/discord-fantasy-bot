import { sleeperProjectionsUrl } from "../decisions/projections.js";

/** Raw projection row shape from api.sleeper.com (subject to change; validate at use site). */
export type SleeperProjectionRow = Record<string, unknown>;

export type ProjectionScoring = {
  ptsPpr: number | null;
  ptsHalfPpr: number | null;
  ptsStd: number | null;
};

function finiteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function statsObject(row: Record<string, unknown>): Record<string, unknown> {
  return row.stats && typeof row.stats === "object" && !Array.isArray(row.stats)
    ? (row.stats as Record<string, unknown>)
    : {};
}

export function projectionScoringFromRow(row: Record<string, unknown>): ProjectionScoring {
  const stats = statsObject(row);
  return {
    ptsPpr: finiteNumber(row.pts_ppr) ?? finiteNumber(stats.pts_ppr),
    ptsHalfPpr: finiteNumber(row.pts_half_ppr) ?? finiteNumber(stats.pts_half_ppr),
    ptsStd: finiteNumber(row.pts_std) ?? finiteNumber(stats.pts_std) ?? finiteNumber(row.fantasy_points),
  };
}

/** Prefer PPR, then half-PPR, then standard — matches lineup-check ranking. */
export function preferredProjectionPoints(scoring: ProjectionScoring): number {
  return scoring.ptsPpr ?? scoring.ptsHalfPpr ?? scoring.ptsStd ?? 0;
}

export function projectionPlayerId(row: Record<string, unknown>): string | null {
  const raw = row.player_id;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return null;
}

export function projectionStatsPayload(row: Record<string, unknown>): Record<string, unknown> {
  const stats = statsObject(row);
  return Object.keys(stats).length ? stats : row;
}

export async function fetchWeeklyProjections(
  season: string | number,
  week: string | number,
  seasonType: "regular" | "pre" | "post" | "off" = "regular",
): Promise<SleeperProjectionRow[]> {
  const url = sleeperProjectionsUrl(season, week, seasonType);
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Projections HTTP ${res.status} ${url} ${text.slice(0, 120)}`);
  }
  const data: unknown = await res.json();
  return Array.isArray(data) ? (data as SleeperProjectionRow[]) : [];
}

import { sleeperProjectionsUrl } from "../decisions/projections.js";

/** Raw projection row shape from api.sleeper.com (subject to change; validate at use site). */
export type SleeperProjectionRow = Record<string, unknown>;

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

/**
 * Undocumented stats host (same family as projections). Not on docs.sleeper.com;
 * shape may change — store raw payloads.
 */
export const STATS_COM = "https://api.sleeper.com/stats/nfl";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sleeper stats HTTP ${res.status} ${url} ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/** Bulk stats list for a season week (archived in SleeperStatsSnapshot). */
export async function fetchStatsBulkForWeek(
  season: string | number,
  week: number,
  seasonType: "regular" | "post" | "pre" | "off" = "regular",
): Promise<unknown> {
  const params = new URLSearchParams({ season_type: seasonType });
  return getJson<unknown>(`${STATS_COM}/${season}/${week}?${params}`);
}

/** Per-player stats with grouping `season` | `week`. */
export async function fetchPlayerStats(
  playerId: string,
  season: string | number,
  seasonType: "regular" | "post" | "pre" | "off",
  grouping: "season" | "week",
): Promise<unknown> {
  const params = new URLSearchParams({
    season: String(season),
    season_type: seasonType,
    grouping,
  });
  return getJson<unknown>(`${STATS_COM}/player/${playerId}?${params}`);
}

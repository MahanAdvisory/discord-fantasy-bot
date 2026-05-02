/**
 * Projected points source (plan todo: confirm-projections).
 *
 * Official docs.sleeper.com does not list projections. Sleeper serves weekly
 * projections from `api.sleeper.com` (same host family as other undocumented stats URLs).
 *
 * Verified: GET https://api.sleeper.com/projections/nfl/{season}/{week}?season_type=regular → 200
 *
 * Use for replacement rankings in Phase C; respect rate limits alongside api.sleeper.app calls.
 */
export const SLEEPER_PROJECTIONS_BASE = "https://api.sleeper.com/projections/nfl" as const;

export function sleeperProjectionsUrl(
  season: string | number,
  week: string | number,
  seasonType: "regular" | "pre" | "post" | "off" = "regular",
): string {
  const params = new URLSearchParams({ season_type: seasonType });
  return `${SLEEPER_PROJECTIONS_BASE}/${season}/${week}?${params}`;
}

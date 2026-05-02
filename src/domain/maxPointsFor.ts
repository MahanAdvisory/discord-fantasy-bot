/**
 * "Max points for" (plan todo: define-max-pf)
 *
 * Sleeper roster `settings` on GET /league/{id}/rosters includes cumulative fantasy points
 * (`fpts`, `fpts_decimal`) and points against — not a dedicated "optimal / max PF" field in the public API.
 *
 * Definitions we use in product copy and future stats code:
 *
 * 1. **points_for (actual PF)** — roster `settings.fpts` (+ fractional `fpts_decimal` if needed). This is what
 *    the manager actually scored with their lineup choices.
 *
 * 2. **max_points_for (theoretical best)** — NOT returned as a single number by the documented Sleeper API.
 *    To approximate "max PF" for a week: sum the best valid lineup from that week's scores (starters-only
 *    slots per league `roster_positions`), using each player's realized points from matchups/stats.
 *    Off-season / pre-snapshot: use weekly projections (see `decisions/projections.ts`) as an estimate only.
 *
 * When the bot mentions "max PF" before we implement optimal-lineup math, prefer the phrase
 * "best possible lineup (estimated)" or show only actual PF from Sleeper.
 */
export type PointsForSource = "sleeper_roster_settings" | "computed_optimal_weekly";

export interface LeagueScoringSnapshot {
  actualPointsFor: number;
  maxPointsFor?: number;
  pointsForSource: PointsForSource;
}

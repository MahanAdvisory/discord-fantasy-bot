/**
 * Cross-surface view models (Discord bot, web dashboard, future mobile).
 * Provider-specific fields stay namespaced under `sleeper` until multi-adapter work lands.
 */
export type FantasyProvider = "sleeper";

export interface DashboardNflContext {
  season: string;
  week: number;
  seasonType: string;
  displayWeek: number;
}

export interface DashboardLeagueRow {
  provider: FantasyProvider;
  leagueId: string;
  name: string;
  status: string;
  season: string;
  totalRosters: number;
  /** Sleeper draft id when known (active or last). */
  draftId?: string | null;
  wins: number;
  losses: number;
  ties: number;
  recordLabel: string;
  leagueUrl: string;
}

export interface DashboardDraftRow {
  provider: FantasyProvider;
  draftId: string;
  leagueId: string;
  leagueName: string;
  status: string;
  draftType?: string | null;
  pickCount: number;
  onTheClockLabel?: string | null;
  draftUrl: string;
  leagueUrl: string;
}

export interface DashboardSnapshot {
  nfl: DashboardNflContext;
  leagues: DashboardLeagueRow[];
  /** Leagues with an in-progress draft (best-effort). */
  activeDrafts: DashboardDraftRow[];
  linkedSleeperUsername: string | null;
}

export interface DashboardLineupIssues {
  evaluated: number;
  noIssues: number;
  issues: string[];
}

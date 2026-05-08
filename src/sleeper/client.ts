export const V1 = "https://api.sleeper.app/v1";

export interface SleeperUser {
  user_id: string;
  username: string;
  display_name?: string;
  avatar?: string;
}

export interface NflState {
  week: number;
  season_type: string;
  season: string;
  league_season: string;
  display_week: number;
  leg: number;
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  status: string;
  season: string;
  sport: string;
  total_rosters: number;
  draft_id?: string;
  /** Slot order matches each roster's `starters` array (QB, RB, FLEX, SUPER_FLEX, …). */
  roster_positions?: string[] | null;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string | null;
  players?: string[] | null;
  starters?: string[] | null;
  reserve?: string[] | null;
  taxi?: string[] | null;
  settings?: {
    wins?: number;
    losses?: number;
    ties?: number;
  } | null;
}

export interface SleeperTradedPick {
  season?: string;
  round?: number;
  roster_id?: number;
  owner_id?: number;
  previous_owner_id?: number;
}

export interface SleeperDraft {
  draft_id: string;
  status: string;
  league_id: string;
  season: string;
  type: string;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sleeper HTTP ${res.status} ${url} ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export async function getUserByUsername(username: string): Promise<SleeperUser | null> {
  const url = `${V1}/user/${encodeURIComponent(username)}`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sleeper HTTP ${res.status} ${url} ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<SleeperUser>;
}

export async function getUserById(userId: string): Promise<SleeperUser | null> {
  const url = `${V1}/user/${encodeURIComponent(userId)}`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sleeper HTTP ${res.status} ${url} ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<SleeperUser>;
}

export async function getNflState(): Promise<NflState> {
  return getJson<NflState>(`${V1}/state/nfl`);
}

export async function getUserLeagues(userId: string, season: string): Promise<SleeperLeague[]> {
  return getJson<SleeperLeague[]>(`${V1}/user/${userId}/leagues/nfl/${season}`);
}

export async function getUserDrafts(userId: string, season: string): Promise<SleeperDraft[]> {
  return getJson<SleeperDraft[]>(`${V1}/user/${userId}/drafts/nfl/${season}`);
}

export async function getLeague(leagueId: string): Promise<SleeperLeague> {
  return getJson<SleeperLeague>(`${V1}/league/${leagueId}`);
}

export async function getLeagueRosters(leagueId: string): Promise<SleeperRoster[]> {
  return getJson<SleeperRoster[]>(`${V1}/league/${leagueId}/rosters`);
}

export async function getLeagueTradedPicks(leagueId: string): Promise<SleeperTradedPick[]> {
  return getJson<SleeperTradedPick[]>(`${V1}/league/${leagueId}/traded_picks`);
}

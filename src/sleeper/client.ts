const V1 = "https://api.sleeper.app/v1";

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

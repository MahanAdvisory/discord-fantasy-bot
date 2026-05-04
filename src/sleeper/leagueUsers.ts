import { V1 } from "./client.js";

export interface LeagueMemberUser {
  user_id: string;
  username?: string;
  display_name?: string;
  /** Sleeper often stores the fantasy team name here (league-scoped). */
  metadata?: { team_name?: string };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sleeper HTTP ${res.status} ${url} ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export async function getLeagueUsers(leagueId: string): Promise<LeagueMemberUser[]> {
  return getJson<LeagueMemberUser[]>(`${V1}/league/${leagueId}/users`);
}

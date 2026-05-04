import { V1 } from "./client.js";

export interface SleeperTransaction {
  season?: string;
  league_id?: string;
  type: string;
  transaction_id: string;
  status: string;
  status_updated: number;
  created: number;
  leg?: number;
  roster_ids?: number[];
  adds?: Record<string, number> | null;
  drops?: Record<string, number> | null;
  draft_picks?: Array<{
    round?: number;
    season?: string;
    roster_id?: number;
    owner_id?: number;
    previous_owner_id?: number;
  }>;
  settings?: { waiver_bid?: number } | null;
  metadata?: { waiver_bid?: string } | null;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sleeper HTTP ${res.status} ${url} ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/** `round` = NFL week for in-season activity (Sleeper docs). */
export async function getLeagueTransactions(leagueId: string, round: number): Promise<SleeperTransaction[]> {
  const raw = await getJson<SleeperTransaction[] | null>(`${V1}/league/${leagueId}/transactions/${round}`);
  return raw ?? [];
}

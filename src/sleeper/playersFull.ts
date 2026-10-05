import { V1 } from "./client.js";

const UNSIGNED_TEAM = new Set(["FA", "NONE", "NULL", "N/A", "NA"]);

/** NFL team abbreviation from a Sleeper player JSON blob, or null if unsigned / missing. */
export function nflTeamFromPlayerData(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { team?: unknown; team_abbr?: unknown };
  for (const v of [d.team, d.team_abbr]) {
    if (typeof v !== "string") continue;
    const team = v.trim();
    if (!team || UNSIGNED_TEAM.has(team.toUpperCase())) continue;
    return team;
  }
  return null;
}

/** Full NFL players map from GET /v1/players/nfl (~5MB). Call sparingly (e.g. weekly). */
export async function fetchAllNflPlayers(): Promise<Record<string, Record<string, unknown>>> {
  const res = await fetch(`${V1}/players/nfl`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sleeper players HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<Record<string, Record<string, unknown>>>;
}

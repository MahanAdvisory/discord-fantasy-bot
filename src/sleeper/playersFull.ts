import { V1 } from "./client.js";

/** Full NFL players map from GET /v1/players/nfl (~5MB). Call sparingly (e.g. weekly). */
export async function fetchAllNflPlayers(): Promise<Record<string, Record<string, unknown>>> {
  const res = await fetch(`${V1}/players/nfl`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sleeper players HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<Record<string, Record<string, unknown>>>;
}

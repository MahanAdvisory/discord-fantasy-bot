import { prisma } from "../db.js";
import { loadPlayerLabels } from "../services/lineupCheck.js";
import { fetchAllNflPlayers } from "../sleeper/playersFull.js";
import type { EspnTeamRosterSnapshot } from "../adapters/espn/index.js";

let cache: Map<number, string> | null = null;
let cacheAt = 0;
const TTL_MS = 6 * 60 * 60 * 1000;

function espnNumericIdFromSleeperPlayer(data: Record<string, unknown>): number | null {
  const raw = data.espn_id;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const n = Number.parseInt(raw.trim(), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * ESPN fantasy API uses the same NFL player ids Sleeper stores under `espn_id`.
 * Maps ESPN roster player id -> Sleeper `player_id` string for labeling via `loadPlayerLabels`.
 */
export async function getEspnPlayerIdToSleeperPlayerIdMap(): Promise<Map<number, string>> {
  const now = Date.now();
  if (cache && now - cacheAt < TTL_MS) return cache;

  const map = new Map<number, string>();
  try {
    const rows = await prisma.sleeperPlayer.findMany({ select: { playerId: true, data: true } });
    for (const r of rows) {
      if (!r.data || typeof r.data !== "object") continue;
      const eid = espnNumericIdFromSleeperPlayer(r.data as Record<string, unknown>);
      if (eid != null && !map.has(eid)) map.set(eid, r.playerId);
    }
    /** Live catalog fills `espn_id` gaps (rookies / DB lag) without waiting on sync. */
    const full = await fetchAllNflPlayers().catch(() => ({} as Record<string, Record<string, unknown>>));
    for (const [pid, data] of Object.entries(full)) {
      if (!data || typeof data !== "object") continue;
      const eid = espnNumericIdFromSleeperPlayer(data as Record<string, unknown>);
      if (eid != null && !map.has(eid)) map.set(eid, pid);
    }
  } catch {
    /* keep partial / empty map */
  }

  cache = map;
  cacheAt = now;
  return map;
}

function collectPairsFromRosters(rosters: EspnTeamRosterSnapshot[]): Array<{ espnPlayerId: number; espnFallbackName: string }> {
  const pairs: Array<{ espnPlayerId: number; espnFallbackName: string }> = [];
  for (const t of rosters) {
    for (const slot of ["starters", "bench", "reserve"] as const) {
      const names = t.buckets[slot];
      const ids = t.playerIds[slot];
      for (let i = 0; i < names.length; i++) {
        const eid = ids[i];
        if (typeof eid !== "number" || eid < 0) continue;
        pairs.push({ espnPlayerId: eid, espnFallbackName: names[i] ?? `player ${eid}` });
      }
    }
  }
  return pairs;
}

/** Rewrite roster bucket strings using Sleeper-style labels when `espn_id` crosswalk hits. */
export async function applySleeperLabelsToEspnRosters(rosters: EspnTeamRosterSnapshot[]): Promise<void> {
  if (!rosters.length) return;
  const pairs = collectPairsFromRosters(rosters);
  if (!pairs.length) return;

  const cross = await getEspnPlayerIdToSleeperPlayerIdMap();
  const sleeperIds = [...new Set(pairs.map((p) => cross.get(p.espnPlayerId)).filter((x): x is string => Boolean(x)))];
  const sleeperLabels = await loadPlayerLabels(sleeperIds);
  const labelByEspn = new Map<number, string>();
  for (const p of pairs) {
    const sid = cross.get(p.espnPlayerId);
    const label = sid ? sleeperLabels.get(sid) ?? null : null;
    labelByEspn.set(p.espnPlayerId, label ?? p.espnFallbackName);
  }

  for (const t of rosters) {
    for (const slot of ["starters", "bench", "reserve"] as const) {
      const ids = t.playerIds[slot];
      t.buckets[slot] = t.buckets[slot].map((fallback, i) => {
        const eid = ids[i];
        if (typeof eid !== "number" || eid < 0) return fallback;
        return labelByEspn.get(eid) ?? fallback;
      });
    }
  }
}

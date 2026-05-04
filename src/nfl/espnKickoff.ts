/**
 * NFL team kickoff times from ESPN’s public scoreboard API (no key).
 * Used to compare game order for flex / superflex lineup advice.
 *
 * **At most one HTTP GET per NFL (season, week)** for the whole app: results are kept in memory,
 * coalesced while in flight, and persisted in `app_meta` so process restarts don’t refetch the same week.
 */

import { prisma } from "../db.js";

const memoryCache = new Map<string, Map<string, number>>();
/** Concurrent `/flex-check` (or future callers) share a single in-flight fetch per week. */
const inFlight = new Map<string, Promise<Map<string, number>>>();

function memoryKey(yr: number, wk: number): string {
  return `${yr}-${wk}`;
}

function dbMetaKey(yr: number, wk: number): string {
  return `espn_nfl_scoreboard_${yr}_${wk}`;
}

/** Sleeper / NFLverse-style abbrev → ESPN scoreboard abbrev (when they differ). */
const TEAM_TO_ESPN: Record<string, string> = {
  WAS: "WSH",
  JAC: "JAX",
};

function espnAbbr(team: string): string {
  const u = team.trim().toUpperCase();
  return TEAM_TO_ESPN[u] ?? u;
}

interface EspnScoreboardJson {
  events?: Array<{
    date?: string;
    competitions?: Array<{
      date?: string;
      competitors?: Array<{ homeAway?: string; team?: { abbreviation?: string } }>;
    }>;
  }>;
}

function parseKickoffMapFromJson(raw: string): Map<string, number> | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const map = new Map<string, number>();
    for (const [abbr, msRaw] of Object.entries(parsed)) {
      const ms = typeof msRaw === "number" ? msRaw : Number(msRaw);
      if (Number.isFinite(ms)) map.set(abbr.toUpperCase(), ms);
    }
    return map.size > 0 ? map : null;
  } catch {
    return null;
  }
}

async function fetchEspnScoreboard(yr: number, wk: number): Promise<Map<string, number>> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${wk}&season=${yr}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ESPN scoreboard HTTP ${res.status} ${text.slice(0, 120)}`);
  }
  const data = (await res.json()) as EspnScoreboardJson;
  const map = new Map<string, number>();

  for (const event of data.events ?? []) {
    const comp = event.competitions?.[0];
    const rawDate = comp?.date ?? event.date;
    const ms = rawDate ? Date.parse(rawDate) : NaN;
    if (!Number.isFinite(ms)) continue;
    for (const side of comp?.competitors ?? []) {
      const abbr = side.team?.abbreviation?.toUpperCase();
      if (abbr) map.set(abbr, ms);
    }
  }

  return map;
}

export async function getTeamKickoffMsForNflWeek(season: string | number, week: number): Promise<Map<string, number>> {
  const wk = Math.max(1, week);
  const yr = typeof season === "string" ? parseInt(season, 10) : season;
  if (!Number.isFinite(yr)) {
    throw new Error(`Invalid NFL season for ESPN scoreboard: ${String(season)}`);
  }

  const mkey = memoryKey(yr, wk);
  const cached = memoryCache.get(mkey);
  if (cached) return cached;

  const pending = inFlight.get(mkey);
  if (pending) return pending;

  const promise = (async (): Promise<Map<string, number>> => {
    try {
      const dbKey = dbMetaKey(yr, wk);
      const row = await prisma.appMeta.findUnique({ where: { key: dbKey } });
      if (row?.value) {
        const fromDb = parseKickoffMapFromJson(row.value);
        if (fromDb) {
          memoryCache.set(mkey, fromDb);
          return fromDb;
        }
      }

      const map = await fetchEspnScoreboard(yr, wk);
      memoryCache.set(mkey, map);

      if (map.size > 0) {
        await prisma.appMeta
          .upsert({
            where: { key: dbKey },
            create: { key: dbKey, value: JSON.stringify(Object.fromEntries(map)) },
            update: { value: JSON.stringify(Object.fromEntries(map)) },
          })
          .catch((e) => console.warn("[espnKickoff] app_meta cache write failed", dbKey, e));
      }

      return map;
    } finally {
      inFlight.delete(mkey);
    }
  })();

  inFlight.set(mkey, promise);
  return promise;
}

export function kickoffMsForPlayerTeam(teamKickoffs: Map<string, number>, sleeperTeamAbbr: string | null | undefined): number | null {
  if (!sleeperTeamAbbr?.trim()) return null;
  const a = espnAbbr(sleeperTeamAbbr);
  const ms = teamKickoffs.get(a);
  if (ms != null) return ms;
  /** Washington */
  if (a === "WAS") return teamKickoffs.get("WSH") ?? null;
  return null;
}

export function formatKickoffEt(ms: number): string {
  try {
    return new Date(ms).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
      timeZoneName: "short",
    });
  } catch {
    return new Date(ms).toISOString();
  }
}

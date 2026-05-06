/**
 * Scan candidate ESPN league IDs and report viable leagues/activity.
 *
 * Examples:
 *   # Explicit IDs
 *   ESPN_SEASON=2025 ESPN_LEAGUE_IDS=701655126,123456789 npx tsx scripts/spikes/espn-candidate-scan.ts
 *
 *   # Generate around a seed (count defaults to 50)
 *   ESPN_SEASON=2025 ESPN_LEAGUE_ID_SEED=701655126 ESPN_SCAN_COUNT=200 npx tsx scripts/spikes/espn-candidate-scan.ts
 *
 * Optional for private leagues:
 *   ESPN_S2=... ESPN_SWID={...}
 */
import { fetchEspnLeagueSnapshot } from "../../src/adapters/espn/index.js";

type CandidateResult = {
  leagueId: string;
  ok: boolean;
  leagueName?: string;
  recentCount?: number;
  error?: string;
};

function parseExplicitIds(): string[] {
  const raw = process.env.ESPN_LEAGUE_IDS?.trim();
  if (!raw) return [];
  return [...new Set(raw.split(",").map((x) => x.trim()).filter((x) => /^\d+$/.test(x)))];
}

function generateAroundSeed(seed: string, count: number): string[] {
  const base = Number(seed);
  if (!Number.isFinite(base) || base < 1) return [];
  const out: string[] = [];
  const half = Math.floor(count / 2);
  for (let i = -half; i <= half; i++) {
    const n = base + i;
    if (n > 0) out.push(String(n));
    if (out.length >= count) break;
  }
  return [...new Set(out)];
}

async function runLimited<T>(items: string[], limit: number, worker: (id: string) => Promise<T>): Promise<T[]> {
  const out: T[] = [];
  let idx = 0;
  async function runOne(): Promise<void> {
    while (idx < items.length) {
      const cur = items[idx++];
      out.push(await worker(cur));
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, limit) }, () => runOne()));
  return out;
}

const season = process.env.ESPN_SEASON?.trim() ?? "2025";
const espnS2 = process.env.ESPN_S2;
const swid = process.env.ESPN_SWID;
const explicit = parseExplicitIds();
const seed = process.env.ESPN_LEAGUE_ID_SEED?.trim();
const scanCount = Math.max(1, Math.min(1000, Number.parseInt(process.env.ESPN_SCAN_COUNT ?? "50", 10) || 50));
const parallel = Math.max(1, Math.min(25, Number.parseInt(process.env.ESPN_SCAN_PARALLEL ?? "8", 10) || 8));

const candidates = explicit.length
  ? explicit
  : seed && /^\d+$/.test(seed)
    ? generateAroundSeed(seed, scanCount)
    : [];

if (!candidates.length) {
  console.error(
    "Provide either ESPN_LEAGUE_IDS (comma list) or ESPN_LEAGUE_ID_SEED (+ optional ESPN_SCAN_COUNT).",
  );
  process.exit(1);
}

const results = await runLimited(candidates, parallel, async (leagueId): Promise<CandidateResult> => {
  try {
    const snap = await fetchEspnLeagueSnapshot({ leagueId, season, espnS2, swid });
    return {
      leagueId,
      ok: true,
      leagueName: snap.league?.name ?? "(unknown)",
      recentCount: snap.recent.length,
    };
  } catch (e) {
    return {
      leagueId,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
});

const ok = results.filter((r) => r.ok);
const withActivity = ok.filter((r) => (r.recentCount ?? 0) > 0);

console.log(
  JSON.stringify(
    {
      season,
      scanned: candidates.length,
      okCount: ok.length,
      withActivityCount: withActivity.length,
      withActivity: withActivity.slice(0, 25),
      okNoActivitySample: ok.filter((r) => (r.recentCount ?? 0) === 0).slice(0, 25),
      errorSample: results.filter((r) => !r.ok).slice(0, 25),
    },
    null,
    2,
  ),
);

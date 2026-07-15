"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type LeaderboardPlayer = {
  rank: number;
  playerName: string | null;
  team: string | null;
  position: string | null;
  games: number;
  fpts: number;
  fptsPerGame: number;
  xfp: number | null;
  fpoe: number | null;
  targetShare: number | null;
  targetsPerRoute: number | null;
  offenseSnapPct: number | null;
  routesRun: number | null;
  catchRate: number | null;
  catchRateExp: number | null;
  adot: number | null;
  yac: number | null;
  racr: number | null;
  wopr: number | null;
  rushingEpa: number | null;
  startRate: number | null;
  startRateSource: string | null;
  rosterPct: number | null;
  vorp: number | null;
  box: {
    carries?: number | null;
    rushingYards?: number | null;
    rushingTds?: number | null;
    targets?: number | null;
    receptions?: number | null;
    receivingYards?: number | null;
    receivingTds?: number | null;
    completions?: number | null;
    attempts?: number | null;
    passingYards?: number | null;
    passingTds?: number | null;
    interceptions?: number | null;
  };
};

type LeaderboardResponse = {
  season: number;
  week: number | "season";
  position: string;
  q: string | null;
  scoring: { receptions: string; passTd: number; tePremium: number };
  replacementPoints: number;
  attribution: string;
  players: LeaderboardPlayer[];
  total: number;
};

function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function num(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

export function StatsLeaderboard({ defaultSeason, defaultWeek }: { defaultSeason: string; defaultWeek: number }) {
  const [season, setSeason] = useState(defaultSeason);
  const [week, setWeek] = useState<string>("season");
  const [position, setPosition] = useState("RB");
  const [scoring, setScoring] = useState("ppr");
  const [passTd, setPassTd] = useState("4");
  const [tePremium, setTePremium] = useState(false);
  const [sort, setSort] = useState("fpts");
  const [playerSearch, setPlayerSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(playerSearch.trim()), 300);
    return () => window.clearTimeout(t);
  }, [playerSearch]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      season,
      week,
      position,
      scoring,
      passTd,
      tePremium: tePremium ? "1" : "0",
      sort,
      limit: debouncedSearch ? "200" : "100",
    });
    if (debouncedSearch) params.set("q", debouncedSearch);
    try {
      const res = await fetch(`/api/stats/leaderboard?${params}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      }
      setData((await res.json()) as LeaderboardResponse);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [season, week, position, scoring, passTd, tePremium, sort, debouncedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  const seasons = [String(Number(defaultSeason)), String(Number(defaultSeason) - 1), String(Number(defaultSeason) - 2)];

  const visiblePlayers = useMemo(() => {
    if (!data?.players) return [];
    const needle = playerSearch.trim().toLowerCase();
    if (!needle) return data.players;
    return data.players.filter((p) => {
      const name = (p.playerName ?? "").toLowerCase();
      const team = (p.team ?? "").toLowerCase();
      return name.includes(needle) || team.includes(needle);
    });
  }, [data, playerSearch]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
        <label className="min-w-[200px] flex-1 text-xs">
          <span className="mb-1 block text-zinc-500">Player</span>
          <input
            value={playerSearch}
            onChange={(e) => setPlayerSearch(e.target.value)}
            placeholder="Search name or team…"
            className="w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-zinc-500">Season</span>
          <select value={season} onChange={(e) => setSeason(e.target.value)} className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900">
            {seasons.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-zinc-500">Week</span>
          <select value={week} onChange={(e) => setWeek(e.target.value)} className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900">
            <option value="season">Full season</option>
            {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
              <option key={w} value={String(w)}>Week {w}{w === defaultWeek ? " (current)" : ""}</option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-zinc-500">Position</span>
          <select value={position} onChange={(e) => setPosition(e.target.value)} className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900">
            {["QB", "RB", "WR", "TE"].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-zinc-500">Scoring</span>
          <select value={scoring} onChange={(e) => setScoring(e.target.value)} className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900">
            <option value="standard">Standard</option>
            <option value="half_ppr">Half PPR</option>
            <option value="ppr">PPR</option>
          </select>
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-zinc-500">Pass TD</span>
          <select value={passTd} onChange={(e) => setPassTd(e.target.value)} className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900">
            <option value="4">4 pt</option>
            <option value="6">6 pt</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={tePremium} onChange={(e) => setTePremium(e.target.checked)} />
          TE premium (+0.5)
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-zinc-500">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900">
            <option value="fpts">FPTS</option>
            <option value="fpts_g">FPTS/G</option>
            <option value="xfp">xFP</option>
            <option value="fpoe">FPOE</option>
            <option value="vorp">VORP</option>
          </select>
        </label>
        <button type="button" onClick={() => void load()} className="rounded border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700">
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          {error.includes("Unauthorized")
            ? "Sign in to view stats."
            : `${error} — if the table is empty, run the nflverse ETL sync first.`}
        </p>
      )}

      {data && (
        <>
          <p className="text-xs text-zinc-500">
            {playerSearch.trim()
              ? `${visiblePlayers.length} match${visiblePlayers.length === 1 ? "" : "es"}`
              : `${data.total} players`}
            {" · "}replacement ≈ {data.replacementPoints} FPTS · season {data.season}
            {data.week === "season" ? " (full season)" : ` week ${data.week}`}
          </p>
          <div className="overflow-x-auto rounded-2xl border border-zinc-200 dark:border-zinc-800">
            <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-900/50">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Player</th>
                  <th className="px-3 py-2">G</th>
                  {position === "QB" && (
                    <>
                      <th className="px-3 py-2">CMP/ATT</th>
                      <th className="px-3 py-2">Pass Yds</th>
                      <th className="px-3 py-2">Pass TD</th>
                      <th className="px-3 py-2">INT</th>
                    </>
                  )}
                  {(position === "RB" || position === "WR" || position === "TE") && (
                    <>
                      {position === "RB" && (
                        <>
                          <th className="px-3 py-2">ATT</th>
                          <th className="px-3 py-2">Rush Yds</th>
                          <th className="px-3 py-2">Rush TD</th>
                        </>
                      )}
                      <th className="px-3 py-2">TGT</th>
                      <th className="px-3 py-2">REC</th>
                      <th className="px-3 py-2">Rec Yds</th>
                      <th className="px-3 py-2">Rec TD</th>
                    </>
                  )}
                  <th className="px-3 py-2">FPTS</th>
                  <th className="px-3 py-2">FPTS/G</th>
                  <th className="px-3 py-2">xFP</th>
                  <th className="px-3 py-2">FPOE</th>
                  <th className="px-3 py-2">Tgt%</th>
                  <th className="px-3 py-2">TPRR</th>
                  <th className="px-3 py-2">Snap%</th>
                  <th className="px-3 py-2">Catch%</th>
                  <th className="px-3 py-2">aDOT</th>
                  <th className="px-3 py-2">VORP</th>
                  <th className="px-3 py-2">Start%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {visiblePlayers.map((p) => (
                  <tr key={`${p.rank}-${p.playerName}`} className="bg-white dark:bg-zinc-950">
                    <td className="px-3 py-2 text-zinc-500">{p.rank}</td>
                    <td className="px-3 py-2 font-medium">
                      {p.playerName ?? "—"}
                      <span className="ml-1 text-xs font-normal text-zinc-500">{p.team}</span>
                    </td>
                    <td className="px-3 py-2">{p.games}</td>
                    {position === "QB" && (
                      <>
                        <td className="px-3 py-2">{p.box.completions ?? 0}/{p.box.attempts ?? 0}</td>
                        <td className="px-3 py-2">{p.box.passingYards ?? 0}</td>
                        <td className="px-3 py-2">{p.box.passingTds ?? 0}</td>
                        <td className="px-3 py-2">{p.box.interceptions ?? 0}</td>
                      </>
                    )}
                    {(position === "RB" || position === "WR" || position === "TE") && (
                      <>
                        {position === "RB" && (
                          <>
                            <td className="px-3 py-2">{p.box.carries ?? 0}</td>
                            <td className="px-3 py-2">{p.box.rushingYards ?? 0}</td>
                            <td className="px-3 py-2">{p.box.rushingTds ?? 0}</td>
                          </>
                        )}
                        <td className="px-3 py-2">{p.box.targets ?? 0}</td>
                        <td className="px-3 py-2">{p.box.receptions ?? 0}</td>
                        <td className="px-3 py-2">{p.box.receivingYards ?? 0}</td>
                        <td className="px-3 py-2">{p.box.receivingTds ?? 0}</td>
                      </>
                    )}
                    <td className="px-3 py-2 font-semibold">{num(p.fpts)}</td>
                    <td className="px-3 py-2">{num(p.fptsPerGame)}</td>
                    <td className="px-3 py-2">{num(p.xfp)}</td>
                    <td className="px-3 py-2">{num(p.fpoe)}</td>
                    <td className="px-3 py-2">{pct(p.targetShare)}</td>
                    <td className="px-3 py-2">{num(p.targetsPerRoute, 2)}</td>
                    <td className="px-3 py-2">{p.offenseSnapPct != null ? `${num(p.offenseSnapPct, 0)}%` : "—"}</td>
                    <td className="px-3 py-2" title={p.catchRateExp != null ? `exp ${pct(p.catchRateExp)}` : undefined}>
                      {pct(p.catchRate)}
                    </td>
                    <td className="px-3 py-2">{num(p.adot, 1)}</td>
                    <td className="px-3 py-2">{num(p.vorp)}</td>
                    <td className="px-3 py-2" title={p.startRateSource ?? undefined}>
                      {p.startRate != null ? pct(p.startRate) : p.rosterPct != null ? `${num(p.rosterPct, 0)}%` : "—"}
                    </td>
                  </tr>
                ))}
                {!visiblePlayers.length && (
                  <tr>
                    <td colSpan={20} className="px-3 py-8 text-center text-zinc-500">
                      {playerSearch.trim()
                        ? `No players match “${playerSearch.trim()}”.`
                        : <>No stats loaded yet. Run <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">python etl/sync_nflverse.py</code>.</>}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-zinc-500">{data.attribution}</p>
        </>
      )}
    </section>
  );
}

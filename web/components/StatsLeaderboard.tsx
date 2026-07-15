"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from "react";

type LeaderboardPlayer = {
  rank: number;
  playerKey?: string;
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
  yprr: number | null;
  offenseSnapPct: number | null;
  offenseSnaps: number | null;
  routesRun: number | null;
  routePct: number | null;
  catchRate: number | null;
  catchRateExp: number | null;
  adot: number | null;
  airYards: number | null;
  yac: number | null;
  racr: number | null;
  wopr: number | null;
  rushingEpa: number | null;
  receivingEpa: number | null;
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
  sort: string;
  dir: string;
  q: string | null;
  scoring: { receptions: string; passTd: number; tePremium: number };
  replacementPoints: number;
  replacementPerGame?: number;
  attribution: string;
  players: LeaderboardPlayer[];
  total: number;
};

type SortKey =
  | "fpts"
  | "fpts_g"
  | "xfp"
  | "fpoe"
  | "vorp"
  | "g"
  | "tgt"
  | "rec"
  | "rec_yds"
  | "rec_td"
  | "att"
  | "rush_yds"
  | "rush_td"
  | "pass_yds"
  | "pass_td"
  | "int"
  | "cmp"
  | "tgt_pct"
  | "tprr"
  | "yprr"
  | "routes"
  | "route_pct"
  | "snaps"
  | "snap_pct"
  | "catch_pct"
  | "adot"
  | "air_yds"
  | "yac"
  | "racr"
  | "wopr"
  | "rush_epa"
  | "rec_epa"
  | "start_pct"
  | "pos"
  | "player"
  | "team";

const LEGEND: Array<{ abbr: string; meaning: string }> = [
  { abbr: "G", meaning: "Games played" },
  { abbr: "ATT", meaning: "Rushing attempts (carries)" },
  { abbr: "TGT", meaning: "Targets" },
  { abbr: "REC", meaning: "Receptions" },
  { abbr: "CMP/ATT", meaning: "Completions / pass attempts" },
  { abbr: "FPTS", meaning: "Fantasy points under the selected scoring settings" },
  { abbr: "FPTS/G", meaning: "Fantasy points per game" },
  { abbr: "xFP", meaning: "Expected fantasy points (ffopportunity components, rescaled to your scoring)" },
  { abbr: "FPOE", meaning: "Fantasy points over expected (FPTS − xFP)" },
  { abbr: "VORP", meaning: "Value over replacement (player FPTS − replacement FPTS/G × games played)" },
  { abbr: "Rush EPA", meaning: "Rushing expected points added" },
  { abbr: "Rec EPA", meaning: "Receiving expected points added" },
  { abbr: "Tgt%", meaning: "Target share (share of team targets)" },
  { abbr: "TPRR", meaning: "Targets per route run (targets ÷ routes, shown as %)" },
  { abbr: "YPRR", meaning: "Yards per route run (receiving yards ÷ routes)" },
  { abbr: "Routes", meaning: "Routes run (FTN / nflverse participation)" },
  { abbr: "Route%", meaning: "Route share (routes run ÷ offensive snaps)" },
  { abbr: "Snaps", meaning: "Offensive snaps played" },
  { abbr: "Snap%", meaning: "Offensive snap share" },
  { abbr: "Catch%", meaning: "Catch rate (receptions ÷ targets)" },
  { abbr: "aDOT", meaning: "Average depth of target (air yards ÷ targets)" },
  { abbr: "Air Yds", meaning: "Receiving air yards" },
  { abbr: "YAC", meaning: "Yards after catch" },
  { abbr: "RACR", meaning: "Receiver air conversion ratio" },
  { abbr: "WOPR", meaning: "Weighted opportunity rating" },
  { abbr: "Start%", meaning: "Member-league start rate, or FantasyPros roster % fallback" },
  { abbr: "FLEX", meaning: "RB + WR + TE combined leaderboard" },
  { abbr: "Superflex", meaning: "QB + RB + WR + TE combined leaderboard" },
];

function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function num(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

function latestAvailableSeason(defaultSeason: string): number {
  const n = Number(defaultSeason);
  // NFL slate for calendar year Y isn't available early in Y; 2026 has no data yet.
  if (!Number.isFinite(n)) return 2025;
  return Math.min(n, 2025);
}

function seasonOptions(defaultSeason: string): string[] {
  const end = latestAvailableSeason(defaultSeason);
  const out: string[] = [];
  for (let y = end; y >= 2015; y--) out.push(String(y));
  return out;
}

export function StatsLeaderboard({ defaultSeason, defaultWeek }: { defaultSeason: string; defaultWeek: number }) {
  const seasons = useMemo(() => seasonOptions(defaultSeason), [defaultSeason]);
  const [season, setSeason] = useState(() => seasons[0] ?? "2025");
  const [week, setWeek] = useState<string>("season");
  const [position, setPosition] = useState("RB");
  const [scoring, setScoring] = useState("ppr");
  const [passTd, setPassTd] = useState("4");
  const [tePremium, setTePremium] = useState(false);
  const [sort, setSort] = useState<SortKey>("fpts");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [playerSearch, setPlayerSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tableScrollWidth, setTableScrollWidth] = useState(0);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const bottomScrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const syncingScroll = useRef<"top" | "bottom" | null>(null);

  const showPos = position === "FLEX" || position === "SUPERFLEX";
  const showPass = position === "QB" || position === "SUPERFLEX";
  const showRush = position === "RB" || position === "FLEX" || position === "SUPERFLEX";
  const showRec = position === "RB" || position === "WR" || position === "TE" || position === "FLEX" || position === "SUPERFLEX";

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(playerSearch.trim()), 300);
    return () => window.clearTimeout(t);
  }, [playerSearch]);

  useEffect(() => {
    const table = tableRef.current;
    const bottom = bottomScrollRef.current;
    if (!table || !bottom) return;

    const updateWidth = () => setTableScrollWidth(table.scrollWidth);
    updateWidth();

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateWidth) : null;
    ro?.observe(table);
    ro?.observe(bottom);
    window.addEventListener("resize", updateWidth);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", updateWidth);
    };
  }, [data]);

  const onTopScroll = (e: UIEvent<HTMLDivElement>) => {
    if (syncingScroll.current === "bottom") return;
    const bottom = bottomScrollRef.current;
    if (!bottom) return;
    syncingScroll.current = "top";
    bottom.scrollLeft = e.currentTarget.scrollLeft;
    syncingScroll.current = null;
  };

  const onBottomScroll = (e: UIEvent<HTMLDivElement>) => {
    if (syncingScroll.current === "top") return;
    const top = topScrollRef.current;
    if (!top) return;
    syncingScroll.current = "bottom";
    top.scrollLeft = e.currentTarget.scrollLeft;
    syncingScroll.current = null;
  };

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
      dir: sortDir,
      limit: position === "SUPERFLEX" || position === "FLEX" || debouncedSearch ? "300" : "150",
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
  }, [season, week, position, scoring, passTd, tePremium, sort, sortDir, debouncedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSort = (key: SortKey) => {
    if (sort === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSort(key);
      setSortDir(key === "player" || key === "team" || key === "pos" ? "asc" : "desc");
    }
  };

  const sortMark = (key: SortKey) => {
    if (sort !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  };

  const SortTh = ({
    id,
    children,
    className = "",
    sticky,
  }: {
    id: SortKey;
    children: ReactNode;
    className?: string;
    sticky?: boolean;
  }) => (
    <th
      className={[
        "px-3 py-2 whitespace-nowrap",
        sticky ? "sticky left-10 z-20 bg-zinc-50 dark:bg-zinc-900 shadow-[2px_0_0_0_rgba(0,0,0,0.06)] dark:shadow-[2px_0_0_0_rgba(255,255,255,0.06)]" : "",
        className,
      ].join(" ")}
    >
      <button type="button" onClick={() => onSort(id)} className="inline-flex items-center gap-0.5 font-medium uppercase tracking-wide hover:text-zinc-900 dark:hover:text-zinc-100">
        {children}
        <span className="text-[10px] text-zinc-400">{sortMark(id)}</span>
      </button>
    </th>
  );

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
            <option value="QB">QB</option>
            <option value="RB">RB</option>
            <option value="WR">WR</option>
            <option value="TE">TE</option>
            <option value="FLEX">FLEX (RB/WR/TE)</option>
            <option value="SUPERFLEX">Superflex (all)</option>
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
              ? `${data.players.length} match${data.players.length === 1 ? "" : "es"}`
              : `${data.total} players`}
            {" · "}replacement ≈ {data.replacementPoints} FPTS
            {data.replacementPerGame != null ? ` (${data.replacementPerGame}/G)` : ""}
            {" · "}season {data.season}
            {data.week === "season" ? " (full season)" : ` week ${data.week}`}
            {" · "}click a column header to sort
          </p>
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800">
            <div
              ref={topScrollRef}
              onScroll={onTopScroll}
              className="overflow-x-auto overflow-y-hidden"
              aria-hidden="true"
            >
              <div style={{ height: 1, width: tableScrollWidth || undefined }} />
            </div>
            <div ref={bottomScrollRef} onScroll={onBottomScroll} className="overflow-x-auto">
            <table ref={tableRef} className="min-w-max border-separate border-spacing-0 text-sm">
              <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900/80">
                <tr>
                  <th className="sticky left-0 z-20 bg-zinc-50 px-3 py-2 dark:bg-zinc-900">#</th>
                  <SortTh id="player" sticky>Player</SortTh>
                  {showPos && <SortTh id="pos">Pos</SortTh>}
                  <SortTh id="team">Team</SortTh>
                  <SortTh id="g">G</SortTh>
                  {showPass && (
                    <>
                      <SortTh id="cmp">CMP</SortTh>
                      <SortTh id="pass_yds">Pass Yds</SortTh>
                      <SortTh id="pass_td">Pass TD</SortTh>
                      <SortTh id="int">INT</SortTh>
                    </>
                  )}
                  {showRush && (
                    <>
                      <SortTh id="att">ATT</SortTh>
                      <SortTh id="rush_yds">Rush Yds</SortTh>
                      <SortTh id="rush_td">Rush TD</SortTh>
                    </>
                  )}
                  {showRec && (
                    <>
                      <SortTh id="rec">REC</SortTh>
                      <SortTh id="rec_yds">Rec Yds</SortTh>
                      <SortTh id="rec_td">Rec TD</SortTh>
                    </>
                  )}
                  <SortTh id="fpts">FPTS</SortTh>
                  <SortTh id="fpts_g">FPTS/G</SortTh>
                  <SortTh id="xfp">xFP</SortTh>
                  <SortTh id="fpoe">FPOE</SortTh>
                  <SortTh id="vorp">VORP</SortTh>
                  <SortTh id="rush_epa">Rush EPA</SortTh>
                  <SortTh id="rec_epa">Rec EPA</SortTh>
                  {showRec && <SortTh id="tgt">TGT</SortTh>}
                  <SortTh id="tgt_pct">Tgt%</SortTh>
                  <SortTh id="tprr">TPRR</SortTh>
                  <SortTh id="yprr">YPRR</SortTh>
                  <SortTh id="routes">Routes</SortTh>
                  <SortTh id="route_pct">Route%</SortTh>
                  <SortTh id="snaps">Snaps</SortTh>
                  <SortTh id="snap_pct">Snap%</SortTh>
                  <SortTh id="catch_pct">Catch%</SortTh>
                  <SortTh id="adot">aDOT</SortTh>
                  <SortTh id="air_yds">Air Yds</SortTh>
                  <SortTh id="yac">YAC</SortTh>
                  <SortTh id="racr">RACR</SortTh>
                  <SortTh id="wopr">WOPR</SortTh>
                  <SortTh id="start_pct">Start%</SortTh>
                </tr>
              </thead>
              <tbody>
                {data.players.map((p) => (
                  <tr key={`${p.rank}-${p.playerKey ?? p.playerName}`} className="group">
                    <td className="sticky left-0 z-10 bg-white px-3 py-2 text-zinc-500 group-hover:bg-zinc-50 dark:bg-zinc-950 dark:group-hover:bg-zinc-900">{p.rank}</td>
                    <td className="sticky left-10 z-10 bg-white px-3 py-2 font-medium shadow-[2px_0_0_0_rgba(0,0,0,0.06)] group-hover:bg-zinc-50 dark:bg-zinc-950 dark:shadow-[2px_0_0_0_rgba(255,255,255,0.06)] dark:group-hover:bg-zinc-900">
                      {p.playerName ?? "—"}
                    </td>
                    {showPos && <td className="px-3 py-2 text-zinc-500">{p.position}</td>}
                    <td className="px-3 py-2 text-zinc-500">{p.team ?? "—"}</td>
                    <td className="px-3 py-2">{p.games}</td>
                    {showPass && (
                      <>
                        <td className="px-3 py-2">{p.box.completions ?? 0}/{p.box.attempts ?? 0}</td>
                        <td className="px-3 py-2">{p.box.passingYards ?? 0}</td>
                        <td className="px-3 py-2">{p.box.passingTds ?? 0}</td>
                        <td className="px-3 py-2">{p.box.interceptions ?? 0}</td>
                      </>
                    )}
                    {showRush && (
                      <>
                        <td className="px-3 py-2">{p.box.carries ?? 0}</td>
                        <td className="px-3 py-2">{p.box.rushingYards ?? 0}</td>
                        <td className="px-3 py-2">{p.box.rushingTds ?? 0}</td>
                      </>
                    )}
                    {showRec && (
                      <>
                        <td className="px-3 py-2">{p.box.receptions ?? 0}</td>
                        <td className="px-3 py-2">{p.box.receivingYards ?? 0}</td>
                        <td className="px-3 py-2">{p.box.receivingTds ?? 0}</td>
                      </>
                    )}
                    <td className="px-3 py-2 font-semibold">{num(p.fpts)}</td>
                    <td className="px-3 py-2">{num(p.fptsPerGame)}</td>
                    <td className="px-3 py-2">{num(p.xfp)}</td>
                    <td className="px-3 py-2">{num(p.fpoe)}</td>
                    <td className="px-3 py-2">{num(p.vorp)}</td>
                    <td className="px-3 py-2">{num(p.rushingEpa, 2)}</td>
                    <td className="px-3 py-2">{num(p.receivingEpa, 2)}</td>
                    {showRec && <td className="px-3 py-2">{p.box.targets ?? 0}</td>}
                    <td className="px-3 py-2">{pct(p.targetShare)}</td>
                    <td className="px-3 py-2">{pct(p.targetsPerRoute)}</td>
                    <td className="px-3 py-2">{num(p.yprr, 2)}</td>
                    <td className="px-3 py-2">{p.routesRun ?? "—"}</td>
                    <td className="px-3 py-2">{pct(p.routePct)}</td>
                    <td className="px-3 py-2">{p.offenseSnaps ?? "—"}</td>
                    <td className="px-3 py-2">{pct(p.offenseSnapPct)}</td>
                    <td className="px-3 py-2" title={p.catchRateExp != null ? `exp ${pct(p.catchRateExp)}` : undefined}>
                      {pct(p.catchRate)}
                    </td>
                    <td className="px-3 py-2">{num(p.adot, 1)}</td>
                    <td className="px-3 py-2">{p.airYards ?? "—"}</td>
                    <td className="px-3 py-2">{p.yac ?? "—"}</td>
                    <td className="px-3 py-2">{num(p.racr, 2)}</td>
                    <td className="px-3 py-2">{num(p.wopr, 2)}</td>
                    <td className="px-3 py-2" title={p.startRateSource ?? undefined}>
                      {p.startRate != null ? pct(p.startRate) : p.rosterPct != null ? `${num(p.rosterPct, 0)}%` : "—"}
                    </td>
                  </tr>
                ))}
                {!data.players.length && (
                  <tr>
                    <td colSpan={32} className="px-3 py-8 text-center text-zinc-500">
                      {playerSearch.trim()
                        ? `No players match “${playerSearch.trim()}”.`
                        : <>No stats loaded yet for this season. Run <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">python etl/sync_nflverse.py</code>.</>}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
            <h3 className="mb-2 text-sm font-semibold">Column legend</h3>
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              {LEGEND.map((item) => (
                <div key={item.abbr} className="flex gap-2">
                  <dt className="w-20 shrink-0 font-medium text-zinc-700 dark:text-zinc-200">{item.abbr}</dt>
                  <dd className="text-zinc-500">{item.meaning}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-zinc-500">{data.attribution}</p>
          </div>
        </>
      )}
    </section>
  );
}

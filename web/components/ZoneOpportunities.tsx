"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ZonePlayer = {
  playerKey: string;
  playerName: string | null;
  peakSeason: number;
  peakTeam: string | null;
  peakPosition: string | null;
  peakGames: number;
  peakOppsG: number;
  peakCarriesG: number;
  peakTargetsG: number;
  peakRzG: number;
  peakGzG: number;
  peakRzCarriesG: number;
  peakRzTargetsG: number;
  peakGzCarriesG: number;
  peakGzTargetsG: number;
  avgOppsG: number;
  avgCarriesG: number;
  avgTargetsG: number;
  avgRzG: number;
  avgGzG: number;
  avgRzCarriesG: number;
  avgRzTargetsG: number;
  avgGzCarriesG: number;
  avgGzTargetsG: number;
  windowGames: number;
  windowOpps: number;
};

type ZoneResponse = {
  players: ZonePlayer[];
  total: number;
  seasons: number[];
  season: number;
  position: string;
  sort: string;
  dir: string;
  attribution: string;
  definitions: {
    opportunities: string;
    redZone: string;
    greenZone: string;
    peakSeason: string;
    avgWindow: string;
  };
};

type SortKey =
  | "peak_opps_g"
  | "avg_opps_g"
  | "peak_carries_g"
  | "avg_carries_g"
  | "peak_targets_g"
  | "avg_targets_g"
  | "peak_rz_g"
  | "avg_rz_g"
  | "peak_gz_g"
  | "avg_gz_g";

function n(v: number, d = 1): string {
  return v.toFixed(d);
}

function SortTh(props: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: "asc" | "desc";
  onSort: (key: SortKey) => void;
  title?: string;
}) {
  const active = props.active === props.sortKey;
  return (
    <th className="whitespace-nowrap px-2 py-3 text-right text-xs font-medium text-zinc-500">
      <button
        type="button"
        title={props.title}
        onClick={() => props.onSort(props.sortKey)}
        className={`inline-flex items-center gap-1 ${active ? "text-sky-600 dark:text-sky-400" : "hover:text-zinc-800 dark:hover:text-zinc-200"}`}
      >
        {props.label}
        {active ? <span aria-hidden>{props.dir === "asc" ? "↑" : "↓"}</span> : null}
      </button>
    </th>
  );
}

export function ZoneOpportunities(props: { defaultSeason: number }) {
  const [season, setSeason] = useState(String(props.defaultSeason));
  const [years, setYears] = useState("3");
  const [position, setPosition] = useState("RB");
  const [playerSearch, setPlayerSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("peak_opps_g");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ZoneResponse | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(playerSearch.trim()), 300);
    return () => window.clearTimeout(t);
  }, [playerSearch]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      season,
      years,
      position,
      sort,
      dir: sortDir,
      limit: "100",
    });
    if (debouncedSearch) params.set("q", debouncedSearch);
    try {
      const res = await fetch(`/api/stats/zone-opportunities?${params}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      }
      setData((await res.json()) as ZoneResponse);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [season, years, position, sort, sortDir, debouncedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSort = (key: SortKey) => {
    if (sort === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSort(key);
      setSortDir("desc");
    }
  };

  const chartData = useMemo(() => {
    const players = data?.players ?? [];
    return players.slice(0, 20).map((p) => ({
      name: (p.playerName ?? "?").split(" ").slice(-1)[0] ?? "?",
      fullName: p.playerName ?? "?",
      peak: p.peakOppsG,
      avg: p.avgOppsG,
      peakRz: p.peakRzG,
      peakGz: p.peakGzG,
    }));
  }, [data]);

  const zoneCoverage = useMemo(() => {
    const players = data?.players ?? [];
    if (!players.length) return 0;
    const withZones = players.filter((p) => p.peakRzG > 0 || p.avgRzG > 0 || p.peakGzG > 0 || p.avgGzG > 0).length;
    return Math.round((100 * withZones) / players.length);
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-zinc-500">Player</span>
          <input
            value={playerSearch}
            onChange={(e) => setPlayerSearch(e.target.value)}
            placeholder="Search"
            className="w-40 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-zinc-500">End season</span>
          <input
            value={season}
            onChange={(e) => setSeason(e.target.value)}
            className="w-24 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-zinc-500">Window</span>
          <select
            value={years}
            onChange={(e) => setYears(e.target.value)}
            className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="1">1 season</option>
            <option value="3">3 seasons</option>
            <option value="5">5 seasons</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-zinc-500">Position</span>
          <select
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="RB">RB</option>
            <option value="WR">WR</option>
            <option value="TE">TE</option>
            <option value="FLEX">FLEX</option>
            <option value="QB">QB</option>
            <option value="ALL">ALL</option>
          </select>
        </label>
        <p className="ml-auto text-xs text-zinc-500">
          {loading ? "Loading…" : data ? `${data.players.length} of ${data.total} players` : null}
        </p>
      </div>

      <p className="text-xs text-zinc-500">
        Peak = highest opps/game season in window (min 8 games). Avg = total opps ÷ games across the window.
        RZ ≤20 · GZ ≤10 · Opportunities = carries + targets.
        {zoneCoverage < 10 ? (
          <span className="ml-1 text-amber-600 dark:text-amber-400">
            Zone columns look empty — run the nflverse ETL after migrating so PBP RZ/GZ counts are filled.
          </span>
        ) : null}
      </p>

      {error ? (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      ) : null}

      <div className="rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
        <h3 className="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          Top 20 by current sort — peak vs average opps/game
        </h3>
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" opacity={0.35} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-30} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 11 }} width={36} />
              <Tooltip
                contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8 }}
                labelFormatter={(_, payload) => {
                  const row = payload?.[0]?.payload as { fullName?: string } | undefined;
                  return row?.fullName ?? "";
                }}
              />
              <Legend />
              <Bar dataKey="peak" name="Peak opps/g" fill="#0ea5e9" radius={[3, 3, 0, 0]} />
              <Bar dataKey="avg" name="Avg opps/g" fill="#71717a" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-zinc-200 dark:border-zinc-800">
        <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          <thead className="bg-zinc-50 dark:bg-zinc-900/50">
            <tr>
              <th className="sticky left-0 z-10 bg-zinc-50 px-3 py-3 text-left text-xs font-medium text-zinc-500 dark:bg-zinc-900/50">
                Player
              </th>
              <th className="px-2 py-3 text-left text-xs font-medium text-zinc-500">Peak</th>
              <SortTh label="Peak opps/g" sortKey="peak_opps_g" active={sort} dir={sortDir} onSort={onSort} />
              <SortTh label="Peak carries/g" sortKey="peak_carries_g" active={sort} dir={sortDir} onSort={onSort} />
              <SortTh label="Peak targets/g" sortKey="peak_targets_g" active={sort} dir={sortDir} onSort={onSort} />
              <SortTh label="Peak RZ/g" sortKey="peak_rz_g" active={sort} dir={sortDir} onSort={onSort} title="Red-zone opportunities/game in peak season" />
              <SortTh label="Peak GZ/g" sortKey="peak_gz_g" active={sort} dir={sortDir} onSort={onSort} title="Green-zone opportunities/game in peak season" />
              <SortTh label="Avg opps/g" sortKey="avg_opps_g" active={sort} dir={sortDir} onSort={onSort} />
              <SortTh label="Avg carries/g" sortKey="avg_carries_g" active={sort} dir={sortDir} onSort={onSort} />
              <SortTh label="Avg targets/g" sortKey="avg_targets_g" active={sort} dir={sortDir} onSort={onSort} />
              <SortTh label="Avg RZ/g" sortKey="avg_rz_g" active={sort} dir={sortDir} onSort={onSort} />
              <SortTh label="Avg GZ/g" sortKey="avg_gz_g" active={sort} dir={sortDir} onSort={onSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {(data?.players ?? []).map((p) => (
              <tr key={p.playerKey} className="odd:bg-white even:bg-zinc-50/60 dark:odd:bg-zinc-950 dark:even:bg-zinc-900/30">
                <td className="sticky left-0 z-10 whitespace-nowrap bg-inherit px-3 py-2 font-medium">
                  {p.playerName ?? "?"}
                  <span className="ml-1 text-xs font-normal text-zinc-500">
                    {p.peakPosition ?? ""}
                  </span>
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-zinc-600 dark:text-zinc-300">
                  {p.peakSeason} {p.peakTeam ?? ""}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{n(p.peakOppsG, 2)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{n(p.peakCarriesG)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{n(p.peakTargetsG)}</td>
                <td className="px-2 py-2 text-right tabular-nums" title={`RZ carries ${n(p.peakRzCarriesG)} · targets ${n(p.peakRzTargetsG)}`}>
                  {n(p.peakRzG)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums" title={`GZ carries ${n(p.peakGzCarriesG)} · targets ${n(p.peakGzTargetsG)}`}>
                  {n(p.peakGzG)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{n(p.avgOppsG, 2)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{n(p.avgCarriesG)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{n(p.avgTargetsG)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{n(p.avgRzG)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{n(p.avgGzG)}</td>
              </tr>
            ))}
            {!loading && !(data?.players.length) ? (
              <tr>
                <td colSpan={12} className="px-3 py-8 text-center text-sm text-zinc-500">
                  No players matched.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {data?.attribution ? <p className="text-xs text-zinc-500">{data.attribution}</p> : null}
    </div>
  );
}

"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

type DashboardData = {
  nfl: { season: string; week: number; seasonType: string; displayWeek: number };
  leagues: {
    leagueId: string;
    name: string;
    status: string;
    season: string;
    totalRosters: number;
    wins: number;
    losses: number;
    ties: number;
    recordLabel: string;
    leagueUrl: string;
  }[];
  activeDrafts: {
    draftId: string;
    leagueName: string;
    status: string;
    pickCount: number;
    onTheClockLabel: string | null;
    draftUrl: string;
    leagueUrl: string;
  }[];
  linkedSleeperUsername: string | null;
};

type LineupIssuesData = {
  evaluated: number;
  noIssues: number;
  issues: string[];
};

type ActivityFeedData = {
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
  nextOffset: number;
  items: {
    id: string;
    leagueId: string;
    leagueName: string;
    createdAtMs: number;
    kind: "transaction" | "draft_pick";
    text: string;
    url: string;
  }[];
};

type TabKey = "drafts" | "leagues" | "lineup" | "activity";
type LeagueSortKey = "status" | "record" | "name";

const TAB_META: Array<{ key: TabKey; label: string }> = [
  { key: "drafts", label: "Active drafts" },
  { key: "leagues", label: "Leagues" },
  { key: "lineup", label: "Lineup issues" },
  { key: "activity", label: "Activity feed" },
];

function statusRank(status: string): number {
  const s = status.toLowerCase();
  if (s === "drafting") return 0;
  if (s === "in_season" || s === "in season") return 1;
  if (s === "pre_draft" || s === "predraft") return 2;
  if (s === "complete") return 3;
  return 99;
}

export default function Home() {
  const { data: session, status } = useSession();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [dashError, setDashError] = useState<string | null>(null);
  const [billing, setBilling] = useState<{ entitlements: { active: boolean } } | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("drafts");
  const [leagueSort, setLeagueSort] = useState<LeagueSortKey>("status");
  const [lineup, setLineup] = useState<LineupIssuesData | null>(null);
  const [lineupLoading, setLineupLoading] = useState(false);
  const [lineupError, setLineupError] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityFeedData | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activitySelectedLeagueIds, setActivitySelectedLeagueIds] = useState<string[]>([]);
  const [activityInvolvesMyTeam, setActivityInvolvesMyTeam] = useState(false);

  const load = useCallback(async () => {
    if (status !== "authenticated") return;
    setDashError(null);
    const [dRes, bRes] = await Promise.all([
      fetch("/api/dashboard"),
      fetch("/api/billing/status"),
    ]);
    if (bRes.ok) {
      setBilling(await bRes.json());
    }
    if (dRes.status === 400) {
      const j = (await dRes.json()) as { message?: string };
      setDashError(j.message ?? "Link Sleeper in Discord with /link");
      setDashboard(null);
      return;
    }
    if (!dRes.ok) {
      setDashError("Could not load dashboard");
      return;
    }
    setDashboard((await dRes.json()) as DashboardData);
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (status !== "authenticated" || activeTab !== "lineup" || lineup || lineupLoading) return;
    const loadLineup = async () => {
      setLineupLoading(true);
      setLineupError(null);
      try {
        const res = await fetch("/api/lineup-issues");
        if (res.status === 400) {
          const j = (await res.json()) as { message?: string };
          setLineupError(j.message ?? "Link Sleeper in Discord with /link first.");
          return;
        }
        if (!res.ok) {
          setLineupError("Could not load lineup issues.");
          return;
        }
        setLineup((await res.json()) as LineupIssuesData);
      } finally {
        setLineupLoading(false);
      }
    };
    void loadLineup();
  }, [activeTab, lineup, lineupLoading, status]);

  const loadActivity = useCallback(
    async (offset = 0, append = false) => {
      if (status !== "authenticated") return;
      setActivityLoading(true);
      setActivityError(null);
      try {
        const qs = new URLSearchParams();
        qs.set("offset", String(offset));
        qs.set("limit", "20");
        if (activitySelectedLeagueIds.length) qs.set("leagues", activitySelectedLeagueIds.join(","));
        if (activityInvolvesMyTeam) qs.set("involvesMyTeam", "1");
        const res = await fetch(`/api/activity-feed?${qs.toString()}`);
        if (!res.ok) {
          setActivityError("Could not load activity feed.");
          return;
        }
        const data = (await res.json()) as ActivityFeedData;
        setActivity((prev) =>
          append && prev
            ? {
                ...data,
                items: [...prev.items, ...data.items],
              }
            : data,
        );
      } finally {
        setActivityLoading(false);
      }
    },
    [activityInvolvesMyTeam, activitySelectedLeagueIds, status],
  );

  useEffect(() => {
    if (activeTab !== "activity" || status !== "authenticated") return;
    void loadActivity(0, false);
  }, [activeTab, activityInvolvesMyTeam, activitySelectedLeagueIds, loadActivity, status]);

  const sortedLeagues = [...(dashboard?.leagues ?? [])].sort((a, b) => {
    if (leagueSort === "name") return a.name.localeCompare(b.name);
    if (leagueSort === "record") {
      const aPct = (a.wins + 0.5 * a.ties) / Math.max(1, a.wins + a.losses + a.ties);
      const bPct = (b.wins + 0.5 * b.ties) / Math.max(1, b.wins + b.losses + b.ties);
      if (bPct !== aPct) return bPct - aPct;
      return b.wins - a.wins;
    }
    const statusDiff = statusRank(a.status) - statusRank(b.status);
    if (statusDiff !== 0) return statusDiff;
    return a.name.localeCompare(b.name);
  });

  const toggleActivityLeague = (leagueId: string) => {
    setActivity((prev) => (prev ? { ...prev, items: [] } : prev));
    setActivitySelectedLeagueIds((prev) =>
      prev.includes(leagueId) ? prev.filter((x) => x !== leagueId) : [...prev, leagueId],
    );
  };

  const renderTextWithLinks = (text: string) => {
    const parts = text.split(/(<https?:\/\/[^>]+>|https?:\/\/\S+)/g);
    return (
      <>
        {parts.map((part, idx) => {
          const angle = part.match(/^<(https?:\/\/[^>]+)>$/);
          const plain = part.match(/^(https?:\/\/\S+)$/);
          const url = angle?.[1] ?? plain?.[1];
          if (url) {
            return (
              <a
                key={`${url}-${idx}`}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 underline dark:text-blue-400"
              >
                {url}
              </a>
            );
          }
          return <span key={`txt-${idx}`}>{part}</span>;
        })}
      </>
    );
  };

  const startCheckout = async () => {
    const res = await fetch("/api/stripe/checkout", { method: "POST" });
    const j = (await res.json()) as { url?: string; error?: string };
    if (j.url) window.location.href = j.url;
    else alert(j.error ?? "Checkout failed");
  };

  const openPortal = async () => {
    const res = await fetch("/api/stripe/portal", { method: "POST" });
    const j = (await res.json()) as { url?: string };
    if (j.url) window.location.href = j.url;
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-10 flex flex-col gap-4 border-b border-zinc-200 pb-8 dark:border-zinc-800 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">Fantasy</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Dashboard
          </h1>
          <p className="mt-2 max-w-xl text-zinc-600 dark:text-zinc-400">
            Same leagues and drafts you manage in Discord — NFL context, active drafts, and league list.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {status === "loading" && (
            <span className="text-sm text-zinc-500">Signing in…</span>
          )}
          {status === "unauthenticated" && (
            <button
              type="button"
              onClick={() => signIn("discord")}
              className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              Continue with Discord
            </button>
          )}
          {status === "authenticated" && (
            <>
              <button
                type="button"
                onClick={() => signOut()}
                className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:text-zinc-200"
              >
                Sign out
              </button>
              <button
                type="button"
                onClick={() => {
                  void load();
                  setLineup(null);
                  setActivity(null);
                }}
                className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:text-zinc-200"
              >
                Refresh
              </button>
            </>
          )}
        </div>
      </header>

      {status === "authenticated" && session?.user && (
        <section className="mb-10 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-sm font-medium text-zinc-500">Account</h2>
            <p className="mt-1 font-medium text-zinc-900 dark:text-zinc-100">{session.user.name}</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Subscription:{" "}
              {billing?.entitlements.active ? (
                <span className="text-emerald-600 dark:text-emerald-400">Active</span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400">Required for Discord bot</span>
              )}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {!billing?.entitlements.active && (
                <button
                  type="button"
                  onClick={() => void startCheckout()}
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                >
                  Subscribe
                </button>
              )}
              {billing?.entitlements.active && (
                <button
                  type="button"
                  onClick={() => void openPortal()}
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-600"
                >
                  Manage billing
                </button>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="text-sm font-medium text-zinc-500">Sleeper</h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              Link your Sleeper username in Discord with <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-sm dark:bg-zinc-800">/link</code> using the same account. The dashboard then loads your leagues.
            </p>
          </div>
        </section>
      )}

      {status === "authenticated" && dashError && (
        <p className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          {dashError}
        </p>
      )}

      {dashboard && (
        <>
          <section className="mb-8 flex flex-wrap gap-3 text-sm text-zinc-600 dark:text-zinc-400">
            <span className="rounded-full bg-zinc-100 px-3 py-1 dark:bg-zinc-800">
              Season {dashboard.nfl.season}
            </span>
            <span className="rounded-full bg-zinc-100 px-3 py-1 dark:bg-zinc-800">
              Week {dashboard.nfl.week} · {dashboard.nfl.seasonType}
            </span>
            {dashboard.linkedSleeperUsername && (
              <span className="rounded-full bg-zinc-100 px-3 py-1 dark:bg-zinc-800">
                Sleeper: {dashboard.linkedSleeperUsername}
              </span>
            )}
          </section>

          <section className="mb-6 flex flex-wrap gap-2">
            {TAB_META.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={
                  activeTab === tab.key
                    ? "rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                }
              >
                {tab.label}
              </button>
            ))}
          </section>

          {activeTab === "drafts" && (
            <section className="mb-10">
              <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">Active drafts</h2>
              {dashboard.activeDrafts.length === 0 ? (
                <p className="rounded-2xl border border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                  No currently drafting rooms.
                </p>
              ) : (
                <ul className="space-y-3">
                  {dashboard.activeDrafts.map((d) => (
                    <li
                      key={d.draftId}
                      className="flex flex-col gap-2 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="font-medium text-zinc-900 dark:text-zinc-100">{d.leagueName}</p>
                        <p className="text-sm text-zinc-500">
                          {d.pickCount} picks · On the clock: {d.onTheClockLabel ?? "—"}
                        </p>
                      </div>
                      <a
                        href={d.draftUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
                      >
                        Open draft
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {activeTab === "leagues" && (
            <section>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Leagues</h2>
                <label className="text-sm text-zinc-600 dark:text-zinc-400">
                  Sort by{" "}
                  <select
                    value={leagueSort}
                    onChange={(e) => setLeagueSort(e.target.value as LeagueSortKey)}
                    className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <option value="status">Status</option>
                    <option value="record">Record</option>
                    <option value="name">League name</option>
                  </select>
                </label>
              </div>
              <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
                <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                  <thead className="bg-zinc-50 dark:bg-zinc-900/50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-zinc-700 dark:text-zinc-300">League</th>
                      <th className="px-4 py-3 text-left font-medium text-zinc-700 dark:text-zinc-300">Status</th>
                      <th className="px-4 py-3 text-left font-medium text-zinc-700 dark:text-zinc-300">Record</th>
                      <th className="hidden px-4 py-3 text-left font-medium text-zinc-700 sm:table-cell dark:text-zinc-300">
                        Rosters
                      </th>
                      <th className="px-4 py-3 text-right font-medium text-zinc-700 dark:text-zinc-300">Link</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {sortedLeagues.map((l) => (
                      <tr key={l.leagueId} className="bg-white dark:bg-zinc-950">
                        <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">{l.name}</td>
                        <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{l.status}</td>
                        <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{l.recordLabel}</td>
                        <td className="hidden px-4 py-3 text-zinc-600 sm:table-cell dark:text-zinc-400">
                          {l.totalRosters}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <a
                            href={l.leagueUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                          >
                            Sleeper
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeTab === "lineup" && (
            <section>
              <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">Lineup issues</h2>
              {lineupLoading && (
                <p className="rounded-2xl border border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                  Checking all leagues…
                </p>
              )}
              {lineupError && (
                <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                  {lineupError}
                </p>
              )}
              {lineup && (
                <>
                  <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
                    Teams evaluated: {lineup.evaluated}. Teams with no issues: {lineup.noIssues}.
                  </p>
                  {lineup.issues.length === 0 ? (
                    <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200">
                      No lineup issues found.
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {lineup.issues.map((issue, idx) => (
                        <li
                          key={`${idx}-${issue.slice(0, 30)}`}
                          className="rounded-2xl border border-zinc-200 p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:text-zinc-300"
                        >
                          <p className="whitespace-pre-wrap">{renderTextWithLinks(issue)}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </section>
          )}

          {activeTab === "activity" && (
            <section>
              <div className="mb-4 flex flex-col gap-3">
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Activity feed</h2>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Latest transactions and draft pick updates across your leagues (20 at a time).
                </p>
                <div className="flex flex-wrap gap-2">
                  {(dashboard?.leagues ?? []).map((l) => {
                    const selected = activitySelectedLeagueIds.includes(l.leagueId);
                    return (
                      <button
                        key={l.leagueId}
                        type="button"
                        onClick={() => toggleActivityLeague(l.leagueId)}
                        className={
                          selected
                            ? "rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                            : "rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                        }
                      >
                        {l.name}
                      </button>
                    );
                  })}
                </div>
                <label className="inline-flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                  <input
                    type="checkbox"
                    checked={activityInvolvesMyTeam}
                    onChange={(e) => {
                      setActivity((prev) => (prev ? { ...prev, items: [] } : prev));
                      setActivityInvolvesMyTeam(e.target.checked);
                    }}
                  />
                  Involves my team
                </label>
              </div>

              {activityError && (
                <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                  {activityError}
                </p>
              )}
              {activityLoading && !activity?.items?.length && (
                <p className="rounded-2xl border border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                  Loading activity…
                </p>
              )}
              {activity && (
                <>
                  {activity.items.length === 0 ? (
                    <p className="rounded-2xl border border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                      No activity found for the selected leagues.
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {activity.items.map((item) => (
                        <li
                          key={item.id}
                          className="rounded-2xl border border-zinc-200 p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:text-zinc-300"
                        >
                          <p className="mb-1 text-xs uppercase tracking-wide text-zinc-500">
                            {item.kind === "transaction" ? "Transaction" : "Draft pick"} · {item.leagueName}
                          </p>
                          <p className="whitespace-pre-wrap">{renderTextWithLinks(item.text)}</p>
                          <div className="mt-2 flex items-center justify-between">
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                            >
                              Open on Sleeper
                            </a>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  {activity.hasMore && (
                    <div className="mt-4">
                      <button
                        type="button"
                        onClick={() => void loadActivity(activity.nextOffset, true)}
                        className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                      >
                        {activityLoading ? "Loading…" : "Load 20 more"}
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}

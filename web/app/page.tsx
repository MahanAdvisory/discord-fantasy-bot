"use client";
import { signIn, signOut, useSession } from "next-auth/react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

type TabKey = "drafts" | "leagues" | "lineup" | "activity" | "waivers" | "notification_settings";
type Dashboard = Awaited<ReturnType<typeof fetchDashboard>> | null;
type Lineup = { evaluated: number; noIssues: number; issues: string[] } | null;
type Activity = {
  offset: number; limit: number; total: number; hasMore: boolean; nextOffset: number;
  items: { id: string; leagueId: string; leagueName: string; createdAtMs: number; kind: "transaction" | "draft_pick"; text: string; url: string }[];
} | null;
type Subscriptions = { categories: string[]; routes: { id: string; isDm: boolean; provider: string; sleeperLeagueScope: string; category: string; leagueScopeLabel: string; destinationLabel: string }[] } | null;
type Waivers = { season: string; week: number; cached: boolean; generatedAt: string; leagues: { leagueId: string; leagueName: string; leagueUrl: string; waiverRunAt: string | null; players: { playerId: string; name: string; position: string | null; team: string | null; ownershipPct: number; lastWeekPoints: number; last3WeeksPoints: number }[] }[] } | null;
type LeagueDetails = { leagues: { leagueId: string; leagueName: string; status: string; wins: number; losses: number; ties: number; recordPct: number; lineupUrl: string; rosterBuckets: { label: string; players: string[] }[] }[] } | null;
type AccountStatus = {
  authenticated: boolean;
  linkedMethods: { email: boolean; discord: boolean; google: boolean; sleeper: boolean };
  entitlements: { active: boolean };
} | null;

async function fetchDashboard() {
  const res = await fetch("/api/dashboard");
  if (!res.ok) throw new Error("dashboard");
  return (await res.json()) as {
    nfl: { season: string; week: number; seasonType: string; displayWeek: number };
    linkedSleeperUsername: string | null;
    leagues: { leagueId: string; name: string; status: string; wins: number; losses: number; ties: number; recordLabel: string; leagueUrl: string }[];
    activeDrafts: { draftId: string; leagueName: string; pickCount: number; onTheClockLabel: string | null; draftUrl: string }[];
  };
}

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "drafts", label: "Active drafts" },
  { key: "leagues", label: "Leagues" },
  { key: "lineup", label: "Lineup issues" },
  { key: "activity", label: "Activity feed" },
  { key: "waivers", label: "Waivers" },
  { key: "notification_settings", label: "Notification settings" },
];

export default function Home() {
  const { data: session, status } = useSession();
  const [email, setEmail] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [dashboard, setDashboard] = useState<Dashboard>(null);
  const [dashError, setDashError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("drafts");
  const [lineup, setLineup] = useState<Lineup>(null);
  const [activity, setActivity] = useState<Activity>(null);
  const [subs, setSubs] = useState<Subscriptions>(null);
  const [waivers, setWaivers] = useState<Waivers>(null);
  const [leagueDetails, setLeagueDetails] = useState<LeagueDetails>(null);
  const [accountStatus, setAccountStatus] = useState<AccountStatus>(null);
  const [mappings, setMappings] = useState<Array<{ guildId: string; sleeperUserId: string; discordUserId: string; note: string | null }>>([]);
  const [mapGuildId, setMapGuildId] = useState("");
  const [mapSleeperUserId, setMapSleeperUserId] = useState("");
  const [mapDiscordUserId, setMapDiscordUserId] = useState("");
  const [newRouteProvider, setNewRouteProvider] = useState<"sleeper" | "espn">("sleeper");
  const [newRouteLeagueId, setNewRouteLeagueId] = useState("");
  const [newRouteCategory, setNewRouteCategory] = useState("transactions");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activitySelectedLeagueIds, setActivitySelectedLeagueIds] = useState<string[]>([]);
  const [activityInvolvesMyTeam, setActivityInvolvesMyTeam] = useState(false);
  const [waiverSortBy, setWaiverSortBy] = useState<"ownership" | "lastWeek" | "last3Weeks">("ownership");
  const [waiverQ, setWaiverQ] = useState("");
  const [leagueQ, setLeagueQ] = useState("");
  const [expandedLeagueId, setExpandedLeagueId] = useState<string | null>(null);
  useEffect(() => {
    const pref = window.localStorage.getItem("rememberMe");
    if (pref === "0") setRememberMe(false);
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    const pref = window.localStorage.getItem("rememberMe");
    const shouldRemember = pref !== "0";
    if (shouldRemember) {
      window.localStorage.removeItem("sessionLoginAt");
      return;
    }
    const now = Date.now();
    const key = "sessionLoginAt";
    const raw = window.localStorage.getItem(key);
    const loginAt = raw ? Number(raw) : now;
    if (!raw) window.localStorage.setItem(key, String(now));
    const ttl = 24 * 60 * 60 * 1000;
    const elapsed = now - loginAt;
    if (elapsed >= ttl) {
      void signOut({ redirect: false });
      return;
    }
    const timer = window.setTimeout(() => {
      void signOut({ redirect: false });
    }, ttl - elapsed);
    return () => window.clearTimeout(timer);
  }, [status]);

  const loadDashboard = useCallback(async () => {
    if (status !== "authenticated") return;
    try {
      setDashError(null);
      setDashboard(await fetchDashboard());
    } catch {
      setDashError("Could not load dashboard. Link Sleeper in Discord with /link.");
    }
  }, [status]);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);

  useEffect(() => {
    if (activeTab === "lineup" && !lineup && status === "authenticated") {
      void fetch("/api/lineup-issues").then(async (r) => setLineup(r.ok ? ((await r.json()) as Lineup) : { evaluated: 0, noIssues: 0, issues: ["Could not load lineup issues."] }));
    }
    if (activeTab === "notification_settings" && !subs && status === "authenticated") {
      void fetch("/api/subscriptions").then(async (r) => setSubs(r.ok ? ((await r.json()) as Subscriptions) : { categories: [], routes: [] }));
      void fetch("/api/mention-mappings").then(async (r) => setMappings(r.ok ? ((await r.json()) as { mappings: typeof mappings }).mappings : []));
    }
  }, [activeTab, lineup, subs, status]);

  useEffect(() => {
    if (activeTab !== "activity" || status !== "authenticated") return;
    const qs = new URLSearchParams();
    qs.set("offset", "0");
    qs.set("limit", "20");
    if (activitySelectedLeagueIds.length) qs.set("leagues", activitySelectedLeagueIds.join(","));
    if (activityInvolvesMyTeam) qs.set("involvesMyTeam", "1");
    void fetch(`/api/activity-feed?${qs.toString()}`).then(async (r) => setActivity(r.ok ? ((await r.json()) as Activity) : null));
  }, [activeTab, activityInvolvesMyTeam, activitySelectedLeagueIds, status]);

  useEffect(() => {
    if (activeTab !== "waivers" || status !== "authenticated") return;
    const qs = new URLSearchParams({ sortBy: waiverSortBy, q: waiverQ });
    void fetch(`/api/waivers?${qs.toString()}`).then(async (r) => setWaivers(r.ok ? ((await r.json()) as Waivers) : null));
  }, [activeTab, status, waiverSortBy, waiverQ]);

  useEffect(() => {
    if (activeTab !== "leagues" || status !== "authenticated") return;
    const qs = new URLSearchParams({ q: leagueQ });
    void fetch(`/api/leagues-detail?${qs.toString()}`).then(async (r) => setLeagueDetails(r.ok ? ((await r.json()) as LeagueDetails) : null));
  }, [activeTab, leagueQ, status]);

  useEffect(() => {
    if (status !== "authenticated") return;
    void fetch("/api/billing/status").then(async (r) => setAccountStatus(r.ok ? ((await r.json()) as AccountStatus) : null));
  }, [status]);

  const unauth = status === "unauthenticated";
  const authed = status === "authenticated";
  const renderLinks = (text: string) => text.split(/(<https?:\/\/[^>]+>|https?:\/\/\S+)/g).map((part, idx) => {
    const angle = part.match(/^<(https?:\/\/[^>]+)>$/);
    const plain = part.match(/^(https?:\/\/\S+)$/);
    const url = angle?.[1] ?? plain?.[1];
    if (!url) return <span key={`t-${idx}`}>{part}</span>;
    return <a key={`u-${idx}`} href={url} target="_blank" rel="noreferrer" className="text-blue-600 underline dark:text-blue-400">{url}</a>;
  });
  const splitLineupIssue = (text: string): { body: string; lineupUrl: string | null } => {
    const urlMatches = [...text.matchAll(/<((https?:\/\/)[^>]+)>|(https?:\/\/\S+)/g)];
    if (!urlMatches.length) return { body: text, lineupUrl: null };
    const last = urlMatches[urlMatches.length - 1];
    const url = (last[1] ?? last[3] ?? "").trim();
    if (!url) return { body: text, lineupUrl: null };
    const body = text.replace(last[0], "").trim();
    return { body, lineupUrl: url };
  };
  const toggleActivityLeague = (leagueId: string) => setActivitySelectedLeagueIds((p) => p.includes(leagueId) ? p.filter((x) => x !== leagueId) : [...p, leagueId]);
  const groupedSubs = useMemo(() => {
    const out = new Map<string, typeof subs.routes>();
    for (const row of subs?.routes ?? []) {
      const k = row.leagueScopeLabel;
      if (!out.has(k)) out.set(k, []);
      out.get(k)!.push(row);
    }
    return [...out.entries()];
  }, [subs]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-zinc-200 pb-6 dark:border-zinc-800">
        <div>
          <div className="mb-3 inline-flex h-10 w-40 items-center justify-center rounded-lg border border-dashed border-zinc-400 text-xs text-zinc-500">LOGO PLACEHOLDER</div>
          <h1 className="text-3xl font-semibold text-zinc-950 dark:text-zinc-50">Fantasy Dashboard</h1>
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">Centralize league data from multiple fantasy football sources, including Sleeper, ESPN, and others to come.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {status === "loading" && <span className="text-sm text-zinc-500">Loading session…</span>}
          {unauth && (
            <>
              <button type="button" onClick={() => {
                window.localStorage.setItem("rememberMe", rememberMe ? "1" : "0");
                if (!rememberMe) window.localStorage.removeItem("sessionLoginAt");
                void signIn("discord");
              }} className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">Continue with Discord</button>
              <button type="button" onClick={() => {
                window.localStorage.setItem("rememberMe", rememberMe ? "1" : "0");
                if (!rememberMe) window.localStorage.removeItem("sessionLoginAt");
                void signIn("google");
              }} className="rounded-full border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">Continue with Google</button>
              <form className="flex gap-2" onSubmit={(e) => {
                e.preventDefault();
                window.localStorage.setItem("rememberMe", rememberMe ? "1" : "0");
                if (!rememberMe) window.localStorage.removeItem("sessionLoginAt");
                void signIn("email", { email, callbackUrl: "/" });
              }}>
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email magic link" className="rounded-full border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
                <button type="submit" className="rounded-full border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">Send link</button>
              </form>
              <label className="inline-flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => {
                    setRememberMe(e.target.checked);
                    window.localStorage.setItem("rememberMe", e.target.checked ? "1" : "0");
                    if (e.target.checked) window.localStorage.removeItem("sessionLoginAt");
                  }}
                />
                Remember me
              </label>
            </>
          )}
          {authed && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setSettingsOpen((v) => !v)}
                className="rounded-full border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
                aria-label="Open settings"
              >
                ⚙
              </button>
              {settingsOpen && (
                <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-zinc-200 bg-white p-4 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                  {accountStatus && (
                    <>
                      <h2 className="mb-2 text-sm font-semibold">Settings</h2>
                      <p className="mb-2 text-xs text-zinc-500">Connected sign-in methods</p>
                      <div className="mb-3 flex flex-wrap gap-2 text-xs">
                        <span className={`rounded-full px-3 py-1 ${accountStatus.linkedMethods.email ? "bg-emerald-100 text-emerald-800" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>Email</span>
                        <span className={`rounded-full px-3 py-1 ${accountStatus.linkedMethods.google ? "bg-emerald-100 text-emerald-800" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>Google</span>
                        <span className={`rounded-full px-3 py-1 ${accountStatus.linkedMethods.discord ? "bg-emerald-100 text-emerald-800" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>Discord</span>
                        <span className={`rounded-full px-3 py-1 ${accountStatus.linkedMethods.sleeper ? "bg-emerald-100 text-emerald-800" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>Sleeper linked</span>
                      </div>
                    </>
                  )}
                  <a
                    href="/help"
                    className="mb-2 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-center text-sm dark:border-zinc-700"
                  >
                    Help and account linking
                  </a>
                  <button type="button" onClick={() => signOut()} className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">Sign out</button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {unauth && (
        <section className="space-y-6">
          <div className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
            <h2 className="mb-2 text-lg font-semibold">Testimonials</h2>
            <ul className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
              <li>"Wow, you have 40 leagues? That's crazy"</li>
              <li>"It helps me stay on top of everything without spending hours sorting through leagues"</li>
            </ul>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="h-40 rounded-xl border border-dashed border-zinc-400 p-3 text-xs text-zinc-500">Screenshot placeholder 1</div>
            <div className="h-40 rounded-xl border border-dashed border-zinc-400 p-3 text-xs text-zinc-500">Screenshot placeholder 2</div>
            <div className="h-40 rounded-xl border border-dashed border-zinc-400 p-3 text-xs text-zinc-500">Screenshot placeholder 3</div>
          </div>
        </section>
      )}

      {authed && (
        <>
          {dashError && <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">{dashError}</p>}
          {dashboard && (
            <>
              <section className="mb-5 flex flex-wrap gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                <span className="rounded-full bg-zinc-100 px-3 py-1 dark:bg-zinc-800">Season {dashboard.nfl.season}</span>
                <span className="rounded-full bg-zinc-100 px-3 py-1 dark:bg-zinc-800">Week {dashboard.nfl.week} · {dashboard.nfl.seasonType}</span>
                {dashboard.linkedSleeperUsername && <span className="rounded-full bg-zinc-100 px-3 py-1 dark:bg-zinc-800">Sleeper: {dashboard.linkedSleeperUsername}</span>}
              </section>
              <section className="mb-6 flex flex-wrap gap-2">
                {TABS.map((tab) => (
                  <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)} className={activeTab === tab.key ? "rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900" : "rounded-full border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"}>
                    {tab.label}
                  </button>
                ))}
              </section>
            </>
          )}

          {activeTab === "drafts" && dashboard && (
            <ul className="space-y-3">
              {dashboard.activeDrafts.map((d) => (
                <li key={d.draftId} className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
                  <p className="font-medium">{d.leagueName}</p>
                  <p className="text-sm text-zinc-500">{d.pickCount} picks · On the clock: {d.onTheClockLabel ?? "—"}</p>
                  <a href={d.draftUrl} target="_blank" rel="noreferrer" className="text-sm text-blue-600 underline dark:text-blue-400">Open draft</a>
                </li>
              ))}
            </ul>
          )}

          {activeTab === "lineup" && lineup && (
            <section>
              <p className="mb-3 text-sm text-zinc-600">Teams evaluated: {lineup.evaluated}. Teams with no issues: {lineup.noIssues}.</p>
              <ul className="space-y-3">
                {lineup.issues.map((issue, idx) => {
                  const parsed = splitLineupIssue(issue);
                  return (
                    <li key={idx} className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                      <div className="grid grid-cols-[1fr_auto] items-start gap-4">
                        <p className="whitespace-pre-wrap">{renderLinks(parsed.body)}</p>
                        {parsed.lineupUrl ? (
                          <a
                            href={parsed.lineupUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-blue-300 dark:hover:bg-zinc-900"
                          >
                            Set Lineup
                          </a>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {activeTab === "activity" && dashboard && (
            <section>
              <div className="mb-3 flex flex-wrap gap-2">
                {dashboard.leagues.map((l) => <button key={l.leagueId} type="button" onClick={() => toggleActivityLeague(l.leagueId)} className={activitySelectedLeagueIds.includes(l.leagueId) ? "rounded-full bg-zinc-900 px-3 py-1 text-xs text-white dark:bg-zinc-100 dark:text-zinc-900" : "rounded-full border border-zinc-300 px-3 py-1 text-xs dark:border-zinc-700"}>{l.name}</button>)}
              </div>
              <label className="mb-3 inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={activityInvolvesMyTeam} onChange={(e) => setActivityInvolvesMyTeam(e.target.checked)} /> Involves my team</label>
              <ul className="space-y-3">{activity?.items.map((item) => <li key={item.id} className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800"><p className="mb-1 text-xs uppercase text-zinc-500">{item.kind} · {item.leagueName}</p><p className="whitespace-pre-wrap">{renderLinks(item.text)}</p></li>)}</ul>
            </section>
          )}

          {activeTab === "notification_settings" && (
            <section className="space-y-4">
              <div className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
                <h3 className="mb-2 text-sm font-semibold">Sleeper to Discord mention mappings</h3>
                <div className="mb-3 grid gap-2 md:grid-cols-4">
                  <input value={mapGuildId} onChange={(e) => setMapGuildId(e.target.value)} placeholder="Guild ID" className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
                  <input value={mapSleeperUserId} onChange={(e) => setMapSleeperUserId(e.target.value)} placeholder="Sleeper user id" className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
                  <input value={mapDiscordUserId} onChange={(e) => setMapDiscordUserId(e.target.value)} placeholder="Discord user id" className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
                  <button type="button" onClick={async () => {
                    const res = await fetch("/api/mention-mappings", {
                      method: "PUT",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ guildId: mapGuildId.trim(), sleeperUserId: mapSleeperUserId.trim(), discordUserId: mapDiscordUserId.trim() }),
                    });
                    if (res.ok) {
                      const refreshed = await fetch("/api/mention-mappings");
                      setMappings(refreshed.ok ? ((await refreshed.json()) as { mappings: typeof mappings }).mappings : []);
                    }
                  }} className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700">Save mapping</button>
                </div>
                <ul className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                  {mappings.map((m) => (
                    <li key={`${m.guildId}:${m.sleeperUserId}`} className="flex items-center justify-between rounded border border-zinc-200 px-2 py-1 dark:border-zinc-800">
                      <span>{`${m.guildId} · ${m.sleeperUserId} -> <@${m.discordUserId}>`}</span>
                      <button type="button" onClick={async () => {
                        await fetch(`/api/mention-mappings?guildId=${encodeURIComponent(m.guildId)}&sleeperUserId=${encodeURIComponent(m.sleeperUserId)}`, { method: "DELETE" });
                        setMappings((prev) => prev.filter((x) => !(x.guildId === m.guildId && x.sleeperUserId === m.sleeperUserId)));
                      }} className="rounded border border-zinc-300 px-2 py-0.5 dark:border-zinc-700">Remove</button>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
                <h3 className="mb-2 text-sm font-semibold">Add notification route (DM)</h3>
                <div className="grid gap-2 md:grid-cols-4">
                  <select value={newRouteProvider} onChange={(e) => setNewRouteProvider(e.target.value as "sleeper" | "espn")} className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900">
                    <option value="sleeper">Sleeper</option>
                    <option value="espn">ESPN</option>
                  </select>
                  <input value={newRouteLeagueId} onChange={(e) => setNewRouteLeagueId(e.target.value)} placeholder="League id (blank = all linked)" className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
                  <select value={newRouteCategory} onChange={(e) => setNewRouteCategory(e.target.value)} className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900">
                    {(subs?.categories ?? ["transactions", "waivers", "draft_status"]).map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <button type="button" onClick={async () => {
                    await fetch("/api/subscriptions", {
                      method: "PATCH",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        provider: newRouteProvider,
                        sleeperLeagueScope: newRouteLeagueId.trim() || undefined,
                        category: newRouteCategory,
                      }),
                    });
                    const refreshed = await fetch("/api/subscriptions");
                    setSubs(refreshed.ok ? ((await refreshed.json()) as Subscriptions) : { categories: [], routes: [] });
                  }} className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700">Add route</button>
                </div>
              </div>
              {groupedSubs.map(([scope, rows]) => (
                <details key={scope} className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800" open>
                  <summary className="cursor-pointer font-medium">{scope}</summary>
                  <ul className="mt-3 space-y-2">
                    {rows.map((r) => (
                      <li key={r.id} className="flex items-center justify-between text-sm">
                        <span>{r.provider.toUpperCase()} · {r.category} · {r.destinationLabel}</span>
                        <button type="button" onClick={async () => {
                          await fetch("/api/subscriptions", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: r.id, enabled: false }) });
                          setSubs((prev) => prev ? ({ ...prev, routes: prev.routes.filter((x) => x.id !== r.id) }) : prev);
                        }} className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700">Disable</button>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </section>
          )}

          {activeTab === "waivers" && (
            <section>
              <div className="mb-3 flex flex-wrap gap-2">
                <input value={waiverQ} onChange={(e) => setWaiverQ(e.target.value)} placeholder="Search player" className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
                <select value={waiverSortBy} onChange={(e) => setWaiverSortBy(e.target.value as "ownership" | "lastWeek" | "last3Weeks")} className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900">
                  <option value="ownership">Ownership %</option>
                  <option value="lastWeek">Last week points</option>
                  <option value="last3Weeks">Last 3 weeks points</option>
                </select>
              </div>
              <p className="mb-2 text-xs text-zinc-500">Cached waiver data · {waivers?.generatedAt ? new Date(waivers.generatedAt).toLocaleString() : "loading..."}</p>
              <div className="space-y-3">
                {waivers?.leagues.map((l) => (
                  <details key={l.leagueId} className="rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800">
                    <summary className="cursor-pointer text-sm font-medium">{l.leagueName} · <a href={l.leagueUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline dark:text-blue-400">Open add/drop</a></summary>
                    <p className="mt-2 text-xs text-zinc-500">{l.waiverRunAt ? `Waivers run: ${l.waiverRunAt}` : "Waiver run schedule unavailable from API."}</p>
                    <ul className="mt-2 space-y-1 text-sm">
                      {l.players.slice(0, 50).map((p) => <li key={p.playerId}>{p.name} {p.position ? `(${p.position}${p.team ? `, ${p.team}` : ""})` : ""} · own {p.ownershipPct}% · wk {p.lastWeekPoints.toFixed(1)} · 3w {p.last3WeeksPoints.toFixed(1)}</li>)}
                    </ul>
                  </details>
                ))}
              </div>
            </section>
          )}

          {activeTab === "leagues" && (
            <section>
              <div className="mb-3"><input value={leagueQ} onChange={(e) => setLeagueQ(e.target.value)} placeholder="Search player in lineups" className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" /></div>
              <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
                <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                  <thead className="bg-zinc-50 dark:bg-zinc-900/50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">League</th>
                      <th className="px-4 py-3 text-left font-medium">Status</th>
                      <th className="px-4 py-3 text-left font-medium">Record</th>
                      <th className="px-4 py-3 text-right font-medium">Lineup</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {leagueDetails?.leagues.map((l) => {
                      const expanded = expandedLeagueId === l.leagueId;
                      return (
                        <Fragment key={l.leagueId}>
                          <tr key={`row-${l.leagueId}`} className="bg-white dark:bg-zinc-950">
                            <td className="px-4 py-3">
                              <button type="button" onClick={() => setExpandedLeagueId(expanded ? null : l.leagueId)} className="font-medium text-left hover:underline">
                                {expanded ? "▼" : "▶"} {l.leagueName}
                              </button>
                            </td>
                            <td className="px-4 py-3">{l.status}</td>
                            <td className="px-4 py-3">{l.wins}-{l.losses}{l.ties ? `-${l.ties}` : ""}</td>
                            <td className="px-4 py-3 text-right">
                              <a href={l.lineupUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline dark:text-blue-400">Open</a>
                            </td>
                          </tr>
                          {expanded && (
                            <tr key={`exp-${l.leagueId}`} className="bg-zinc-50 dark:bg-zinc-900/40">
                              <td className="px-4 py-3" colSpan={4}>
                                <div className="grid gap-3 md:grid-cols-3">
                                  {l.rosterBuckets.map((b) => (
                                    <div key={b.label} className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
                                      <p className="mb-2 text-xs uppercase text-zinc-500">{b.label}</p>
                                      <ul className="space-y-1">{b.players.map((p, i) => <li key={`${b.label}-${i}`}>{p}</li>)}</ul>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}

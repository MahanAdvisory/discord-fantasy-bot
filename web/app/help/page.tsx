"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";

type LinksState = {
  sleeperUsername: string | null;
  sleeperUserId: string | null;
  espnLeagueIds: string[];
  espnTeamByLeague: Record<string, number>;
  espnSeason: string | null;
  hasEspnPrivateCookies: boolean;
};

export default function HelpPage() {
  const { status } = useSession();
  const [state, setState] = useState<LinksState | null>(null);
  const [sleeperUsername, setSleeperUsername] = useState("");
  const [espnSeason, setEspnSeason] = useState("");
  const [espnLeagueInput, setEspnLeagueInput] = useState("");
  const [espnTeamByLeagueInput, setEspnTeamByLeagueInput] = useState<Record<string, string>>({});
  const [espnS2, setEspnS2] = useState("");
  const [espnSwid, setEspnSwid] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const parsedLeagueIds = useMemo(
    () =>
      espnLeagueInput
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    [espnLeagueInput],
  );

  useEffect(() => {
    if (status !== "authenticated") return;
    void fetch("/api/account-links").then(async (r) => {
      if (!r.ok) return;
      const d = (await r.json()) as LinksState;
      setState(d);
      setSleeperUsername(d.sleeperUsername ?? "");
      setEspnSeason(d.espnSeason ?? "");
      setEspnLeagueInput(d.espnLeagueIds.join(", "));
      const teamInputs: Record<string, string> = {};
      for (const [k, v] of Object.entries(d.espnTeamByLeague ?? {})) {
        teamInputs[k] = String(v);
      }
      setEspnTeamByLeagueInput(teamInputs);
    });
  }, [status]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    const espnLeagueIds = parsedLeagueIds;
    const espnTeamByLeague: Record<string, number> = {};
    for (const lid of espnLeagueIds) {
      const raw = (espnTeamByLeagueInput[lid] ?? "").trim();
      if (!raw) continue;
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n)) espnTeamByLeague[lid] = n;
    }
    const sleeperChanged =
      state != null &&
      sleeperUsername.trim() !== (state.sleeperUsername ?? "").trim();
    const res = await fetch("/api/account-links", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(sleeperChanged ? { sleeperUsername: sleeperUsername.trim() || undefined } : {}),
        espnLeagueIds,
        espnTeamByLeague,
        espnSeason: espnSeason.trim() || undefined,
        espnS2: espnS2.trim() || undefined,
        espnSwid: espnSwid.trim() || undefined,
      }),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setMessage(j.error ?? "Could not save links.");
      setSaving(false);
      return;
    }
    const ref = await fetch("/api/account-links");
    if (ref.ok) {
      const d = (await ref.json()) as LinksState;
      setState(d);
      const teamInputs: Record<string, string> = {};
      for (const [k, v] of Object.entries(d.espnTeamByLeague ?? {})) {
        teamInputs[k] = String(v);
      }
      setEspnTeamByLeagueInput(teamInputs);
    }
    setMessage("Saved.");
    setSaving(false);
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <a
        href="/"
        className="mb-4 inline-flex items-center rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
      >
        ← Back to dashboard
      </a>
      <h1 className="mb-2 text-2xl font-semibold">Help and account linking</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        Use this page to link Sleeper and ESPN data. In Discord you can also run
        <code className="mx-1 rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-800">/help</code>,
        <code className="mx-1 rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-800">/link</code>, and
        <code className="mx-1 rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-800">/link-espn</code> (optional{" "}
        <code className="rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-800">team_id</code>).
      </p>
      {status !== "authenticated" && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Sign in first to edit account links.
        </p>
      )}
      {status === "authenticated" && (
        <section className="space-y-4 rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
          <div>
            <label className="mb-1 block text-sm font-medium">Sleeper username</label>
            <input value={sleeperUsername} onChange={(e) => setSleeperUsername(e.target.value)} className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
            {state?.sleeperUserId && <p className="mt-1 text-xs text-zinc-500">Linked sleeper user id: {state.sleeperUserId}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">ESPN league IDs (comma-separated)</label>
            <input value={espnLeagueInput} onChange={(e) => setEspnLeagueInput(e.target.value)} placeholder="123456, 987654" className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          </div>
          {parsedLeagueIds.length > 0 && (
            <div className="space-y-2 rounded border border-zinc-200 p-3 dark:border-zinc-800">
              <p className="text-sm font-medium">My ESPN team id (per league)</p>
              <p className="text-xs text-zinc-500">
                Open your team on the web; the URL contains <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">teamId=</code>.
                Used to show your roster and record instead of the whole league. Optional but recommended.
              </p>
              {parsedLeagueIds.map((lid) => (
                <div key={lid} className="flex flex-wrap items-center gap-2">
                  <label className="min-w-[140px] text-xs text-zinc-600 dark:text-zinc-400">League {lid}</label>
                  <input
                    value={espnTeamByLeagueInput[lid] ?? ""}
                    onChange={(e) => setEspnTeamByLeagueInput((p) => ({ ...p, [lid]: e.target.value }))}
                    placeholder="Team id"
                    className="min-w-[120px] flex-1 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </div>
              ))}
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium">ESPN season</label>
            <input value={espnSeason} onChange={(e) => setEspnSeason(e.target.value)} placeholder="2025" className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          </div>
          <details className="rounded border border-zinc-300 p-3 dark:border-zinc-700">
            <summary className="cursor-pointer text-sm font-medium">Optional: ESPN private league cookies</summary>
            <p className="mt-2 text-xs text-zinc-500">Only needed for private leagues. Store cautiously.</p>
            <div className="mt-2 space-y-2">
              <input value={espnS2} onChange={(e) => setEspnS2(e.target.value)} placeholder="ESPN_S2" className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
              <input value={espnSwid} onChange={(e) => setEspnSwid(e.target.value)} placeholder="ESPN_SWID (with braces)" className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
            </div>
          </details>
          <button type="button" onClick={() => void save()} disabled={saving} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900">
            {saving ? "Saving..." : "Save links"}
          </button>
          {message && <p className="text-sm text-zinc-600 dark:text-zinc-300">{message}</p>}
        </section>
      )}
    </main>
  );
}

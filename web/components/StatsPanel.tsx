"use client";

import { useState } from "react";
import { StatsLeaderboard } from "@/components/StatsLeaderboard";
import { ZoneOpportunities } from "@/components/ZoneOpportunities";

type StatsView = "leaderboard" | "zones";

export function StatsPanel(props: { defaultSeason: string | number; defaultWeek: number }) {
  const [view, setView] = useState<StatsView>("leaderboard");
  const seasonNumber = typeof props.defaultSeason === "number" ? props.defaultSeason : Number(props.defaultSeason);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Stats</h2>
        <div className="ml-auto inline-flex rounded-lg border border-zinc-300 p-0.5 text-sm dark:border-zinc-700">
          <button
            type="button"
            onClick={() => setView("leaderboard")}
            className={`rounded-md px-3 py-1 ${
              view === "leaderboard"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }`}
          >
            Leaderboard
          </button>
          <button
            type="button"
            onClick={() => setView("zones")}
            className={`rounded-md px-3 py-1 ${
              view === "zones"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }`}
          >
            Zone opportunities
          </button>
        </div>
      </div>

      {view === "leaderboard" ? (
        <StatsLeaderboard defaultSeason={String(props.defaultSeason)} defaultWeek={props.defaultWeek} />
      ) : (
        <ZoneOpportunities defaultSeason={Number.isFinite(seasonNumber) ? seasonNumber : new Date().getFullYear()} />
      )}
    </section>
  );
}

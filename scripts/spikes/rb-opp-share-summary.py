#!/usr/bin/env python3
"""Players who cleared 66% RB opp share: avg when cleared vs avg all seasons in window."""

from __future__ import annotations

import nflreadpy as nfl

THRESHOLD = 0.66
SEASONS = [2023, 2024, 2025]

df = nfl.load_player_stats(seasons=SEASONS, summary_level="week")
pdf = df.to_pandas()
reg = pdf[pdf["season_type"] == "REG"].copy()
reg["carries"] = reg["carries"].fillna(0).astype(int)
reg["targets"] = reg["targets"].fillna(0).astype(int)

rbs = (
    reg[reg["position"] == "RB"]
    .groupby(["season", "team", "player_id", "player_display_name"], as_index=False)
    .agg(carries=("carries", "sum"), targets=("targets", "sum"))
)
rbs["opps"] = rbs["carries"] + rbs["targets"]
team = rbs.groupby(["season", "team"], as_index=False).agg(team_opps=("opps", "sum"))
rbs = rbs.merge(team, on=["season", "team"])
rbs = rbs[rbs["team_opps"] > 0]
rbs["opp_share"] = rbs["opps"] / rbs["team_opps"]

# One row per player-season: team with most opportunities that year
season_best = (
    rbs.sort_values(["player_id", "season", "opps"], ascending=[True, True, False])
    .groupby(["player_id", "season", "player_display_name"], as_index=False)
    .head(1)
)

clearers = set(rbs.loc[rbs["opp_share"] > THRESHOLD, "player_id"])
season_best = season_best[season_best["player_id"].isin(clearers)]

rows = []
for player_id, group in season_best.groupby("player_id"):
    name = group["player_display_name"].iloc[0]
    cleared = group[group["opp_share"] > THRESHOLD]
    rows.append(
        {
            "player": name,
            "times": len(cleared),
            "avg_cleared": cleared["opp_share"].mean(),
            "avg_all": group["opp_share"].mean(),
            "seasons_played": len(group),
        }
    )

rows.sort(key=lambda r: (-r["times"], -r["avg_cleared"]))

print("| Player | Times cleared | Avg when cleared | Avg all seasons (window) |")
print("| --- | ---: | ---: | ---: |")
for r in rows:
    print(
        f"| {r['player']} | {r['times']} | "
        f"{100 * r['avg_cleared']:.1f}% | {100 * r['avg_all']:.1f}% |"
    )

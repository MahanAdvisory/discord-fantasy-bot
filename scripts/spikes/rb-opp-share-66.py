#!/usr/bin/env python3
"""RBs with >66% of team RB opportunities (carries + targets) in last 3 seasons."""

from __future__ import annotations

import nflreadpy as nfl

THRESHOLD = 0.66
SEASONS = [2023, 2024, 2025]

df = nfl.load_player_stats(seasons=SEASONS, summary_level="week")
pdf = df.to_pandas() if hasattr(df, "to_pandas") else df
reg = pdf[pdf["season_type"] == "REG"].copy()
reg["carries"] = reg["carries"].fillna(0).astype(int)
reg["targets"] = reg["targets"].fillna(0).astype(int)

# Mid-season trades: attribute by player-team-season
rbs = (
    reg[reg["position"] == "RB"]
    .groupby(["season", "team", "player_id", "player_display_name"], as_index=False)
    .agg(carries=("carries", "sum"), targets=("targets", "sum"))
)
rbs["opps"] = rbs["carries"] + rbs["targets"]

team = rbs.groupby(["season", "team"], as_index=False).agg(
    team_opps=("opps", "sum"),
    team_carries=("carries", "sum"),
)
rbs = rbs.merge(team, on=["season", "team"])
rbs = rbs[rbs["team_opps"] > 0]
rbs["opp_share"] = rbs["opps"] / rbs["team_opps"]
rbs["carry_share"] = rbs["carries"] / rbs["team_carries"].replace(0, float("nan"))

over = rbs[rbs["opp_share"] > THRESHOLD].sort_values(
    ["season", "opp_share"], ascending=[False, False]
)

print(f"RBs with >{THRESHOLD:.0%} of team RB opportunities (carries+targets), {SEASONS[0]}–{SEASONS[-1]}")
print("-" * 100)
if over.empty:
    print("None.")
else:
    for _, r in over.iterrows():
        print(
            f"{int(r.season)}  {r.team:3s}  {str(r.player_display_name):22s}  "
            f"{100 * r.opp_share:5.1f}%  "
            f"({int(r.opps)}/{int(r.team_opps)} opps · "
            f"{int(r.carries)} carries · {int(r.targets)} tgt · "
            f"{100 * r.carry_share:.1f}% carries)"
        )

print()
print(f"Count: {len(over)} player-team-seasons")

#!/usr/bin/env python3
"""When did a Seattle RB last take >66% of team RB opportunities?"""

from __future__ import annotations

import nflreadpy as nfl

THRESHOLD = 0.66
SEASONS = list(range(1999, 2026))

df = nfl.load_player_stats(seasons=SEASONS, summary_level="week")
pdf = df.to_pandas() if hasattr(df, "to_pandas") else df
reg = pdf[(pdf["season_type"] == "REG") & (pdf["team"] == "SEA")].copy()
reg["carries"] = reg["carries"].fillna(0).astype(int)
reg["targets"] = reg["targets"].fillna(0).astype(int)

rbs = (
    reg[reg["position"] == "RB"]
    .groupby(["season", "player_id", "player_display_name"], as_index=False)
    .agg(carries=("carries", "sum"), targets=("targets", "sum"))
)
rbs["opps"] = rbs["carries"] + rbs["targets"]

team = rbs.groupby("season", as_index=False).agg(
    team_opps=("opps", "sum"),
    team_carries=("carries", "sum"),
)
rbs = rbs.merge(team, on="season")
rbs["opp_share"] = rbs["opps"] / rbs["team_opps"]
rbs["carry_share"] = rbs["carries"] / rbs["team_carries"].replace(0, float("nan"))

leaders = (
    rbs.sort_values(["season", "opps"], ascending=[True, False])
    .groupby("season", as_index=False)
    .head(1)
)

over = leaders[leaders["opp_share"] > THRESHOLD].sort_values("season", ascending=False)
print(f"SEA RB seasons with >{THRESHOLD:.0%} of RB opportunities (carries + targets)")
print("-" * 88)
if over.empty:
    print("None found in range.")
else:
    for _, r in over.iterrows():
        print(
            f"{int(r.season)}: {r.player_display_name}  "
            f"{int(r.opps)}/{int(r.team_opps)} opps = {100 * r.opp_share:.1f}%  "
            f"(carries {int(r.carries)}, tgt {int(r.targets)}; "
            f"carry share {100 * r.carry_share:.1f}%)"
        )

print()
print("Most recent lead-RB seasons")
print("-" * 88)
recent = leaders[leaders["season"] >= 2010].sort_values("season", ascending=False)
for _, r in recent.iterrows():
    mark = "  <<<" if r.opp_share > THRESHOLD else ""
    print(
        f"{int(r.season)}: {str(r.player_display_name):22s} "
        f"{100 * r.opp_share:5.1f}% opps  {100 * r.carry_share:5.1f}% carries"
        f"{mark}"
    )

# Also: last time any RB (not just season leader) cleared 66%
any_over = rbs[rbs["opp_share"] > THRESHOLD].sort_values("season", ascending=False)
print()
print(f"Most recent crossing of {THRESHOLD:.0%} (any SEA RB)")
print("-" * 88)
if any_over.empty:
    print("None.")
else:
    top = any_over.iloc[0]
    print(
        f"{int(top.season)}: {top.player_display_name} "
        f"{100 * top.opp_share:.1f}% of RB opportunities"
    )

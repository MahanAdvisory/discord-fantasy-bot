"""2025 WR1/WR2/WR3 offense snap % by team-game + season summary."""

from __future__ import annotations

import json
from pathlib import Path

import nflreadpy as nfl
import pandas as pd

OUT = Path(__file__).resolve().parent / "output" / "wr-snap-share-2025"


def main() -> None:
    df = nfl.load_snap_counts(seasons=[2025]).to_pandas()
    df = df[df["game_type"] == "REG"].copy()
    wr = df[df["position"] == "WR"].copy()
    wr["offense_pct"] = wr["offense_pct"].fillna(0.0)
    wr["offense_snaps"] = wr["offense_snaps"].fillna(0.0)

    wr = wr.sort_values(
        ["game_id", "team", "offense_pct", "offense_snaps"],
        ascending=[True, True, False, False],
    )
    wr["wr_rank"] = wr.groupby(["game_id", "team"]).cumcount() + 1
    top3 = wr[wr["wr_rank"] <= 3].copy()

    games = top3.pivot_table(
        index=["season", "week", "game_id", "team", "opponent"],
        columns="wr_rank",
        values="offense_pct",
        aggfunc="first",
    )
    games.columns = [f"WR{int(c)}_snap_pct" for c in games.columns]
    games = games.reset_index()
    for c in ["WR1_snap_pct", "WR2_snap_pct", "WR3_snap_pct"]:
        if c not in games.columns:
            games[c] = 0.0
        games[c] = games[c].fillna(0.0)
    games["top3_sum"] = (
        games["WR1_snap_pct"] + games["WR2_snap_pct"] + games["WR3_snap_pct"]
    )

    names = top3.pivot_table(
        index=["game_id", "team"],
        columns="wr_rank",
        values="player",
        aggfunc="first",
    )
    names.columns = [f"WR{int(c)}" for c in names.columns]
    games = games.merge(names.reset_index(), on=["game_id", "team"], how="left")

    summary = (
        games.groupby("team", as_index=False)
        .agg(
            games=("game_id", "nunique"),
            WR1=("WR1_snap_pct", "mean"),
            WR2=("WR2_snap_pct", "mean"),
            WR3=("WR3_snap_pct", "mean"),
            top3=("top3_sum", "mean"),
        )
        .sort_values("top3", ascending=False)
    )
    for c in ["WR1", "WR2", "WR3", "top3"]:
        summary[c] = summary[c].round(4)

    OUT.mkdir(parents=True, exist_ok=True)
    games.to_csv(OUT / "by_game.csv", index=False)
    summary.to_csv(OUT / "by_team_summary.csv", index=False)

    # Compact JSON for canvas embedding (percents 0-100)
    canvas_rows = []
    for _, r in summary.iterrows():
        canvas_rows.append(
            {
                "team": r["team"],
                "games": int(r["games"]),
                "wr1": round(float(r["WR1"]) * 100, 1),
                "wr2": round(float(r["WR2"]) * 100, 1),
                "wr3": round(float(r["WR3"]) * 100, 1),
                "top3": round(float(r["top3"]) * 100, 1),
            }
        )
    (OUT / "summary_for_canvas.json").write_text(json.dumps(canvas_rows, indent=2))

    print(summary.to_string(index=False))
    print(f"\ngame rows={len(games)} teams={len(summary)}")
    print(f"league avg WR1/2/3 %: {summary.WR1.mean()*100:.1f} / {summary.WR2.mean()*100:.1f} / {summary.WR3.mean()*100:.1f}")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""RB peak vs average opportunities/game with carry/target/RZ/GZ breakdown (2023-2025)."""

from __future__ import annotations

import json
from pathlib import Path

import nflreadpy as nfl
import pandas as pd

SEASONS = [2023, 2024, 2025]
MIN_GAMES_PEAK = 8  # season must have at least this many games to count as peak
MIN_WINDOW_OPPS = 80  # filter out tiny samples in the "all RBs" table
RZ = 20  # red zone: inside opponent 20
GZ = 10  # green zone: inside opponent 10
OUT_JSON = Path(__file__).resolve().parent / "output" / "team-rush" / "rb-opps-peak-avg.json"
OUT_CSV = Path(__file__).resolve().parent / "output" / "team-rush" / "rb-opps-peak-avg.csv"


def load_rb_ids() -> set[str]:
    stats = nfl.load_player_stats(seasons=SEASONS, summary_level="week")
    pdf = stats.to_pandas() if hasattr(stats, "to_pandas") else stats
    reg = pdf[(pdf["season_type"] == "REG") & (pdf["position"] == "RB")]
    return set(reg["player_id"].dropna().astype(str))


def opportunity_rows(pbp: pd.DataFrame, rb_ids: set[str]) -> pd.DataFrame:
    reg = pbp[pbp["season_type"] == "REG"].copy()
    reg["yardline_100"] = pd.to_numeric(reg["yardline_100"], errors="coerce")

    rushes = reg[(reg["rush_attempt"] == 1) & reg["rusher_player_id"].notna()].copy()
    rushes["player_id"] = rushes["rusher_player_id"].astype(str)
    rushes["player_name"] = rushes["rusher_player_name"]
    rushes["kind"] = "carry"

    targets = reg[(reg["pass_attempt"] == 1) & reg["receiver_player_id"].notna()].copy()
    targets["player_id"] = targets["receiver_player_id"].astype(str)
    targets["player_name"] = targets["receiver_player_name"]
    targets["kind"] = "target"

    plays = pd.concat(
        [
            rushes[["season", "week", "game_id", "player_id", "player_name", "posteam", "yardline_100", "kind"]],
            targets[["season", "week", "game_id", "player_id", "player_name", "posteam", "yardline_100", "kind"]],
        ],
        ignore_index=True,
    )
    plays = plays[plays["player_id"].isin(rb_ids)]
    plays["rz"] = plays["yardline_100"].le(RZ).fillna(False)
    plays["gz"] = plays["yardline_100"].le(GZ).fillna(False)
    return plays


def season_agg(plays: pd.DataFrame) -> pd.DataFrame:
    # Prefer most recent non-null name/team
    names = (
        plays.sort_values(["season", "week"])
        .groupby(["season", "player_id"], as_index=False)
        .agg(player_name=("player_name", "last"), team=("posteam", "last"))
    )
    g = plays.groupby(["season", "player_id"], as_index=False).agg(
        games=("game_id", "nunique"),
        carries=("kind", lambda s: int((s == "carry").sum())),
        targets=("kind", lambda s: int((s == "target").sum())),
        rz_opps=("rz", "sum"),
        gz_opps=("gz", "sum"),
    )
    g = g.merge(names, on=["season", "player_id"])
    g["opps"] = g["carries"] + g["targets"]
    g["opps_g"] = g["opps"] / g["games"]
    g["carries_g"] = g["carries"] / g["games"]
    g["targets_g"] = g["targets"] / g["games"]
    g["rz_g"] = g["rz_opps"] / g["games"]
    g["gz_g"] = g["gz_opps"] / g["games"]
    return g


def build_player_rows(season_df: pd.DataFrame) -> list[dict]:
    rows = []
    for player_id, group in season_df.groupby("player_id"):
        window_games = int(group["games"].sum())
        window_opps = int(group["opps"].sum())
        if window_opps < MIN_WINDOW_OPPS or window_games <= 0:
            continue

        eligible = group[group["games"] >= MIN_GAMES_PEAK]
        peak_src = eligible if not eligible.empty else group
        peak = peak_src.sort_values("opps_g", ascending=False).iloc[0]

        avg_carries = float(group["carries"].sum() / window_games)
        avg_targets = float(group["targets"].sum() / window_games)
        avg_rz = float(group["rz_opps"].sum() / window_games)
        avg_gz = float(group["gz_opps"].sum() / window_games)

        rows.append(
            {
                "player": str(peak["player_name"]),
                "playerId": str(player_id),
                "peakSeason": int(peak["season"]),
                "peakTeam": str(peak["team"]),
                "peakGames": int(peak["games"]),
                "peakOppsG": round(float(peak["opps_g"]), 2),
                "peakCarriesG": round(float(peak["carries_g"]), 2),
                "peakTargetsG": round(float(peak["targets_g"]), 2),
                "peakRzG": round(float(peak["rz_g"]), 2),
                "peakGzG": round(float(peak["gz_g"]), 2),
                "avgOppsG": round(window_opps / window_games, 2),
                "avgCarriesG": round(avg_carries, 2),
                "avgTargetsG": round(avg_targets, 2),
                "avgRzG": round(avg_rz, 2),
                "avgGzG": round(avg_gz, 2),
                "windowGames": window_games,
                "windowOpps": window_opps,
            }
        )
    rows.sort(key=lambda r: (-r["peakOppsG"], -r["avgOppsG"]))
    return rows


def main() -> None:
    print("Loading RB ids…")
    rb_ids = load_rb_ids()
    print(f"  {len(rb_ids)} RB ids")
    print("Loading PBP…")
    pbp = nfl.load_pbp(seasons=SEASONS)
    pdf = pbp.to_pandas() if hasattr(pbp, "to_pandas") else pbp
    print(f"  {len(pdf)} plays")
    plays = opportunity_rows(pdf, rb_ids)
    print(f"  {len(plays)} RB opportunity plays")
    seasons = season_agg(plays)
    rows = build_player_rows(seasons)
    print(f"  {len(rows)} RBs after filters (min {MIN_WINDOW_OPPS} window opps)")

    payload = {
        "seasons": SEASONS,
        "definitions": {
            "opportunities": "carries + targets",
            "redZone": f"yardline_100 <= {RZ}",
            "greenZone": f"yardline_100 <= {GZ}",
            "peakSeason": f"highest opps/game season with >= {MIN_GAMES_PEAK} games (else best available)",
            "avgWindow": "total opps / total games across 2023-2025",
            "minWindowOpps": MIN_WINDOW_OPPS,
        },
        "players": rows,
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    pd.DataFrame(rows).to_csv(OUT_CSV, index=False)
    print(f"Wrote {OUT_JSON}")
    print(f"Wrote {OUT_CSV}")
    print("Top 10 by peak opps/g:")
    for r in rows[:10]:
        print(
            f"  {r['peakSeason']} {r['peakTeam']:3s} {r['player']:20s} "
            f"peak {r['peakOppsG']:5.2f} (C {r['peakCarriesG']:.1f}/T {r['peakTargetsG']:.1f}/"
            f"RZ {r['peakRzG']:.1f}/GZ {r['peakGzG']:.1f})  "
            f"avg {r['avgOppsG']:5.2f}"
        )


if __name__ == "__main__":
    main()

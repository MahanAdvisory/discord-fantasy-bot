#!/usr/bin/env python3
"""Per-team non-QB carry concentration + RB reception splits from nflverse."""

from __future__ import annotations

import argparse
import os
from collections import defaultdict

import nflreadpy as nfl


def analyze_team(players: list[dict]) -> dict:
    non_qb = sorted(
        [p for p in players if p["position"] != "QB" and p["carries"] > 0],
        key=lambda p: (-p["carries"], -p["receptions"]),
    )
    carry_vals = [p["carries"] for p in non_qb]
    top_carries = (carry_vals + [0, 0, 0])[:3]
    remainder_carries = sum(carry_vals[3:])

    team_rec = sum(p["receptions"] for p in players)
    rbs = sorted(
        [p for p in players if p["position"] == "RB"],
        key=lambda p: (-p["carries"], -p["receptions"]),
    )
    rb_rec_total = sum(p["receptions"] for p in rbs)
    rec_vals = [p["receptions"] for p in rbs]
    top_rec = (rec_vals + [0, 0, 0])[:3]
    remainder_rec = sum(rec_vals[3:])

    return {
        "team": players[0]["team"],
        "total_non_qb_carries": sum(carry_vals),
        "top1_carries": top_carries[0],
        "top2_carries": top_carries[1],
        "top3_carries": top_carries[2],
        "remainder_carries": remainder_carries,
        "rb_receptions": rb_rec_total,
        "rb_rec_pct": (100.0 * rb_rec_total / team_rec) if team_rec else 0.0,
        "rb_top1_rec": top_rec[0],
        "rb_top2_rec": top_rec[1],
        "rb_top3_rec": top_rec[2],
        "rb_remainder_rec": remainder_rec,
    }


def analyze_season(season: int) -> list[dict]:
    df = nfl.load_player_stats(seasons=[season], summary_level="week")
    pdf = df.to_pandas() if hasattr(df, "to_pandas") else df

    reg = pdf[pdf["season_type"] == "REG"].copy()
    reg["carries"] = reg["carries"].fillna(0).astype(int)
    reg["receptions"] = reg["receptions"].fillna(0).astype(int)
    reg["team"] = reg["team"].astype(str)

    player_team = (
        reg.groupby(["team", "player_id", "position"], as_index=False)
        .agg(carries=("carries", "sum"), receptions=("receptions", "sum"))
    )

    by_team: dict[str, list[dict]] = defaultdict(list)
    for _, row in player_team.iterrows():
        team = row["team"]
        if not team or team == "nan":
            continue
        by_team[team].append(
            {
                "team": team,
                "position": str(row.get("position") or ""),
                "carries": int(row["carries"]),
                "receptions": int(row["receptions"]),
            }
        )

    rows = [analyze_team(players) for players in by_team.values()]
    rows.sort(key=lambda r: r["team"])
    return rows


HEADERS = [
    ("Team", "team"),
    ("Non-QB Carries", "total_non_qb_carries"),
    ("Top1", "top1_carries"),
    ("Top2", "top2_carries"),
    ("Top3", "top3_carries"),
    ("Remainder", "remainder_carries"),
    ("RB Rec", "rb_receptions"),
    ("RB Rec%", "rb_rec_pct"),
    ("RB1 Rec", "rb_top1_rec"),
    ("RB2 Rec", "rb_top2_rec"),
    ("RB3 Rec", "rb_top3_rec"),
    ("RB Rem", "rb_remainder_rec"),
]


def fmt(key: str, val) -> str:
    if key == "rb_rec_pct":
        return f"{val:.1f}"
    return str(val)


def format_table(rows: list[dict]) -> str:
    data = [[fmt(k, r[k]) for _, k in HEADERS] for r in rows]
    labels = [h for h, _ in HEADERS]
    widths = [max(len(labels[i]), max((len(row[i]) for row in data), default=0)) for i in range(len(labels))]

    def line(cells: list[str]) -> str:
        return "  ".join(c.rjust(widths[i]) for i, c in enumerate(cells))

    out = [line(labels), line(["-" * widths[i] for i in range(len(labels))])]
    out.extend(line(row) for row in data)
    return "\n".join(out)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--seasons",
        type=int,
        nargs="+",
        default=[2021, 2022, 2023, 2024, 2025],
        help="Seasons to analyze (default: last 5 complete seasons)",
    )
    parser.add_argument(
        "--out-dir",
        type=str,
        default="",
        help="Optional directory to write one text file per season",
    )
    parser.add_argument(
        "--json-out",
        type=str,
        default="",
        help="Optional path to write all seasons as JSON",
    )
    args = parser.parse_args()

    all_seasons: dict[int, list[dict]] = {}
    if args.out_dir:
        os.makedirs(args.out_dir, exist_ok=True)

    for season in args.seasons:
        rows = analyze_season(season)
        all_seasons[season] = rows
        table = format_table(rows)
        header = f"Season {season} REG — {len(rows)} teams\n"
        block = header + "\n" + table + "\n"
        print(block)
        if args.out_dir:
            path = os.path.join(args.out_dir, f"team-rush-{season}.txt")
            with open(path, "w", encoding="utf-8") as f:
                f.write(block)
            print(f"Wrote {path}\n")

    if args.json_out:
        import json

        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump(all_seasons, f, indent=2)
        print(f"Wrote {args.json_out}")


if __name__ == "__main__":
    main()

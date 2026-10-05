"""
Count games where a team scored with ≤30s left in H1 and received the H2 kickoff.

Criteria:
  - Scoring play in Q2 with quarter_seconds_remaining <= 30
    (TD, good FG, or safety — scoring team derived carefully)
  - Same team receives the opening kickoff of Q3 (posteam on first kickoff of Q3)

Uses nflverse PBP for seasons available in our DB (or a fallback range).
"""

from __future__ import annotations

import os
from collections import defaultdict
from pathlib import Path

import nflreadpy as nfl
import pandas as pd
from dotenv import load_dotenv

OUT_DIR = Path(__file__).resolve().parent / "output" / "late-h1-score-h2-receive"


def seasons_from_db() -> list[int] | None:
    load_dotenv()
    url = os.environ.get("DATABASE_URL")
    if not url:
        return None
    try:
        import urllib.parse

        # Prefer sqlalchemy if available; else raw via prisma-less pg8000/psycopg
        try:
            from sqlalchemy import create_engine, text

            eng = create_engine(url)
            with eng.connect() as conn:
                rows = conn.execute(
                    text(
                        "SELECT DISTINCT season FROM nfl_player_week_stats ORDER BY season"
                    )
                ).fetchall()
            return [int(r[0]) for r in rows]
        except Exception:
            pass

        # Fallback: parse DATABASE_URL and use psycopg if present
        try:
            import psycopg

            with psycopg.connect(url) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT DISTINCT season FROM nfl_player_week_stats ORDER BY season"
                    )
                    return [int(r[0]) for r in cur.fetchall()]
        except Exception:
            return None
    except Exception:
        return None


def scoring_team(row: pd.Series) -> str | None:
    """Return the team that scored on this play (TD / made FG / safety), if any.

    Uses score deltas so defensive/return TDs attribute correctly. Extra points
    and 2PT are ignored (not treated as the scoring play of interest).
    """
    posteam = row.get("posteam")
    defteam = row.get("defteam")
    if pd.isna(posteam):
        posteam = None
    else:
        posteam = str(posteam)
    if pd.isna(defteam):
        defteam = None
    else:
        defteam = str(defteam)

    td = float(row.get("touchdown") or 0) == 1.0
    safety = float(row.get("safety") or 0) == 1.0
    fg = row.get("field_goal_result")
    fg_good = isinstance(fg, str) and fg.lower() == "made"

    if not (td or safety or fg_good):
        return None

    try:
        ps = float(row["posteam_score"])
        psp = float(row["posteam_score_post"])
        ds = float(row["defteam_score"])
        dsp = float(row["defteam_score_post"])
    except (TypeError, ValueError, KeyError):
        # Fallback without deltas
        if fg_good and posteam:
            return posteam
        if safety and defteam:
            return defteam
        if td and posteam:
            return posteam
        return None

    if psp > ps and posteam:
        return posteam
    if dsp > ds and defteam:
        return defteam
    return None


def h2_receiving_team(game: pd.DataFrame) -> str | None:
    q3 = game[game["qtr"] == 3].sort_values("play_id")
    if q3.empty:
        return None
    # First kickoff of Q3 — posteam is receiving team in nflverse
    kos = q3[q3["kickoff_attempt"] == 1]
    if not kos.empty:
        rt = kos.iloc[0]["posteam"]
        return str(rt) if pd.notna(rt) else None
    # Fallback: first play with a posteam in Q3
    for _, row in q3.iterrows():
        if pd.notna(row.get("posteam")):
            return str(row["posteam"])
    return None


def late_h1_scoring_teams(game: pd.DataFrame) -> set[str]:
    late = game[
        (game["qtr"] == 2)
        & (game["quarter_seconds_remaining"].notna())
        & (game["quarter_seconds_remaining"] <= 30)
    ]
    teams: set[str] = set()
    for _, row in late.iterrows():
        t = scoring_team(row)
        if t:
            teams.add(t)
    return teams


def analyze_season(season: int) -> list[dict]:
    pbp = nfl.load_pbp(seasons=season).to_pandas()
    # Regular + postseason; keep all games with a game_id
    events: list[dict] = []
    for game_id, game in pbp.groupby("game_id", sort=False):
        game = game.sort_values("play_id")
        scorers = late_h1_scoring_teams(game)
        if not scorers:
            continue
        recv = h2_receiving_team(game)
        if not recv:
            continue
        for team in scorers:
            if team == recv:
                home = game["home_team"].dropna().iloc[0] if "home_team" in game else None
                away = game["away_team"].dropna().iloc[0] if "away_team" in game else None
                week = game["week"].dropna().iloc[0] if "week" in game else None
                events.append(
                    {
                        "season": season,
                        "week": int(week) if pd.notna(week) else None,
                        "game_id": game_id,
                        "team": team,
                        "home_team": home,
                        "away_team": away,
                    }
                )
    return events


def main() -> None:
    seasons = seasons_from_db()
    if not seasons:
        # Fallback: same window ETL usually syncs + recent history used in spikes
        seasons = list(range(2015, 2026))
        print(f"DB seasons unavailable; using {seasons[0]}–{seasons[-1]}")
    else:
        print(f"Seasons from DB: {seasons}")

    all_events: list[dict] = []
    for s in seasons:
        print(f"Loading {s}...")
        ev = analyze_season(s)
        print(f"  {len(ev)} sandwich events")
        all_events.extend(ev)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    events_df = pd.DataFrame(all_events)
    if events_df.empty:
        print("No events found.")
        return

    events_df.to_csv(OUT_DIR / "events.csv", index=False)

    # team x season counts
    by_year = (
        events_df.groupby(["team", "season"], as_index=False)
        .size()
        .rename(columns={"size": "count"})
        .sort_values(["team", "season"])
    )
    by_year.to_csv(OUT_DIR / "by_team_year.csv", index=False)

    # pivot: teams rows, seasons columns
    pivot = by_year.pivot(index="team", columns="season", values="count").fillna(0).astype(int)
    pivot["TOTAL"] = pivot.sum(axis=1)
    pivot = pivot.sort_values("TOTAL", ascending=False)
    pivot.to_csv(OUT_DIR / "pivot_team_year.csv")

    totals = (
        events_df.groupby("team", as_index=False)
        .size()
        .rename(columns={"size": "total"})
        .sort_values("total", ascending=False)
    )
    totals.to_csv(OUT_DIR / "by_team_total.csv", index=False)

    print("\n=== By team × year (non-zero) ===")
    print(by_year.to_string(index=False))
    print("\n=== Pivot (team × year + TOTAL) ===")
    print(pivot.to_string())
    print("\n=== Career / all-years totals ===")
    print(totals.to_string(index=False))
    print(f"\nWrote {OUT_DIR}")


if __name__ == "__main__":
    main()

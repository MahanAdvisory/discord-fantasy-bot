"""
Sandwich outcomes: late H1 score (≤30s) + H2 receive → win rates & fate flips.

Definitions
-----------
- Sandwich: team scores (TD / made FG / safety) with quarter_seconds_remaining ≤ 30
  in Q2, and receives the opening kickoff of Q3.
- Before sandwich: score margin for that team immediately BEFORE their first
  late-H1 scoring play in the ≤30s window.
- After first H2 drive: margin after the sandwich team's first H2 possession ends
  (nflverse fixed_drive that includes the Q3 kickoff / first offensive series).
- Win: final score strictly greater than opponent (ties excluded from win rates).
"""

from __future__ import annotations

from pathlib import Path

import nflreadpy as nfl
import pandas as pd

OUT_DIR = Path(__file__).resolve().parent / "output" / "late-h1-score-h2-receive"
SEASONS = list(range(2015, 2026))  # 2015–present (through 2025)


def scoring_team(row: pd.Series) -> str | None:
    posteam = None if pd.isna(row.get("posteam")) else str(row["posteam"])
    defteam = None if pd.isna(row.get("defteam")) else str(row["defteam"])
    td = float(row.get("touchdown") or 0) == 1.0
    safety = float(row.get("safety") or 0) == 1.0
    fg = row.get("field_goal_result")
    fg_good = isinstance(fg, str) and fg.lower() == "made"
    if not (td or safety or fg_good):
        return None
    try:
        ps, psp = float(row["posteam_score"]), float(row["posteam_score_post"])
        ds, dsp = float(row["defteam_score"]), float(row["defteam_score_post"])
    except (TypeError, ValueError, KeyError):
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


def team_scores_from_row(row: pd.Series, team: str) -> tuple[float, float] | None:
    """Return (team_score, opp_score) from a play row, or None."""
    posteam = row.get("posteam")
    defteam = row.get("defteam")
    if pd.isna(posteam) or pd.isna(defteam):
        return None
    ps, ds = float(row["posteam_score"]), float(row["defteam_score"])
    if str(posteam) == team:
        return ps, ds
    if str(defteam) == team:
        return ds, ps
    return None


def team_scores_post_from_row(row: pd.Series, team: str) -> tuple[float, float] | None:
    posteam = row.get("posteam")
    defteam = row.get("defteam")
    if pd.isna(posteam) or pd.isna(defteam):
        return None
    psp, dsp = float(row["posteam_score_post"]), float(row["defteam_score_post"])
    if str(posteam) == team:
        return psp, dsp
    if str(defteam) == team:
        return dsp, psp
    return None


def h2_receiving_team(game: pd.DataFrame) -> str | None:
    q3 = game[game["qtr"] == 3].sort_values("play_id")
    if q3.empty:
        return None
    kos = q3[q3["kickoff_attempt"] == 1]
    if not kos.empty:
        rt = kos.iloc[0]["posteam"]
        return str(rt) if pd.notna(rt) else None
    for _, row in q3.iterrows():
        if pd.notna(row.get("posteam")):
            return str(row["posteam"])
    return None


def first_late_h1_score_play(game: pd.DataFrame, team: str) -> pd.Series | None:
    late = game[
        (game["qtr"] == 2)
        & (game["quarter_seconds_remaining"].notna())
        & (game["quarter_seconds_remaining"] <= 30)
    ].sort_values("play_id")
    for _, row in late.iterrows():
        if scoring_team(row) == team:
            return row
    return None


def margin_before_sandwich(game: pd.DataFrame, team: str) -> float | None:
    play = first_late_h1_score_play(game, team)
    if play is None:
        return None
    scores = team_scores_from_row(play, team)
    if scores is None:
        return None
    return scores[0] - scores[1]


def margin_after_first_h2_drive(game: pd.DataFrame, team: str) -> float | None:
    q3 = game[game["qtr"] == 3].sort_values("play_id")
    if q3.empty:
        return None
    # Kickoff play starts the receiving team's H2 possession in nflverse
    kos = q3[q3["kickoff_attempt"] == 1]
    if kos.empty:
        first = q3[q3["posteam"].notna()].head(1)
        if first.empty:
            return None
        start = first.iloc[0]
    else:
        start = kos.iloc[0]
        if str(start.get("posteam")) != team:
            # unexpected; fall back to first play with posteam == team
            first = q3[q3["posteam"] == team].head(1)
            if first.empty:
                return None
            start = first.iloc[0]

    drive_id = start.get("fixed_drive")
    if pd.isna(drive_id):
        drive_id = start.get("drive")
    if pd.isna(drive_id):
        return None

    drive_plays = game[game["fixed_drive"] == drive_id].sort_values("play_id")
    if drive_plays.empty:
        drive_plays = game[game["drive"] == drive_id].sort_values("play_id")
    if drive_plays.empty:
        return None

    # Last play of the drive with score info
    for _, row in drive_plays.iloc[::-1].iterrows():
        scores = team_scores_post_from_row(row, team)
        if scores is not None:
            return scores[0] - scores[1]
    return None


def final_result(game: pd.DataFrame, team: str) -> str | None:
    """'W', 'L', or 'T'."""
    last = game.dropna(subset=["home_team", "away_team"]).iloc[-1]
    home, away = str(last["home_team"]), str(last["away_team"])
    # Prefer total_* at end; fall back to home_score/away_score
    if "total_home_score" in game.columns and pd.notna(last.get("total_home_score")):
        hs, as_ = float(last["total_home_score"]), float(last["total_away_score"])
    elif pd.notna(last.get("home_score")):
        hs, as_ = float(last["home_score"]), float(last["away_score"])
    else:
        # last play with scores
        scored = game.dropna(subset=["home_score", "away_score"])
        if scored.empty:
            return None
        last = scored.iloc[-1]
        hs, as_ = float(last["home_score"]), float(last["away_score"])
        home, away = str(last["home_team"]), str(last["away_team"])

    if team == home:
        if hs > as_:
            return "W"
        if hs < as_:
            return "L"
        return "T"
    if team == away:
        if as_ > hs:
            return "W"
        if as_ < hs:
            return "L"
        return "T"
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
    events: list[dict] = []
    for game_id, game in pbp.groupby("game_id", sort=False):
        game = game.sort_values("play_id")
        scorers = late_h1_scoring_teams(game)
        if not scorers:
            continue
        recv = h2_receiving_team(game)
        if not recv or recv not in scorers:
            continue

        before = margin_before_sandwich(game, recv)
        after_drive = margin_after_first_h2_drive(game, recv)
        result = final_result(game, recv)
        if result is None or before is None:
            continue

        week = game["week"].dropna().iloc[0] if "week" in game else None
        events.append(
            {
                "season": season,
                "week": int(week) if pd.notna(week) else None,
                "game_id": game_id,
                "team": recv,
                "margin_before": before,
                "winning_before": before > 0,
                "tied_before": before == 0,
                "losing_before": before < 0,
                "margin_after_h2_drive1": after_drive,
                "still_losing_after_h2_drive1": (
                    after_drive is not None and after_drive < 0
                ),
                "winning_after_h2_drive1": (
                    after_drive is not None and after_drive > 0
                ),
                "tied_after_h2_drive1": after_drive is not None and after_drive == 0,
                "result": result,
                "won": result == "W",
                "fate_flip": before < 0 and result == "W",
            }
        )
    return events


def win_rate(df: pd.DataFrame) -> tuple[int, int, float]:
    decided = df[df["result"].isin(["W", "L"])]
    n = len(decided)
    w = int(decided["won"].sum())
    return w, n, (w / n if n else float("nan"))


def main() -> None:
    all_events: list[dict] = []
    for s in SEASONS:
        print(f"Loading {s}...")
        ev = analyze_season(s)
        print(f"  {len(ev)} sandwiches")
        all_events.extend(ev)

    df = pd.DataFrame(all_events)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT_DIR / "outcomes.csv", index=False)

    print("\n========== OVERALL ==========")
    w, n, rate = win_rate(df)
    ties = int((df["result"] == "T").sum())
    print(f"Sandwiches: {len(df)} ({ties} ties excluded from win%)")
    print(f"Win rate: {w}/{n} = {rate:.1%}")

    print("\n========== BEFORE SANDWICH ==========")
    for label, mask in [
        ("Winning before", df["winning_before"]),
        ("Tied before", df["tied_before"]),
        ("Losing before", df["losing_before"]),
    ]:
        sub = df[mask]
        w, n, rate = win_rate(sub)
        print(f"{label}: {w}/{n} = {rate:.1%}  (n={len(sub)}, fate flips={int(sub['fate_flip'].sum())})")

    print("\n========== AFTER FIRST H2 DRIVE ==========")
    has_after = df[df["margin_after_h2_drive1"].notna()]
    for label, mask in [
        ("Still losing after H2 drive 1", has_after["still_losing_after_h2_drive1"]),
        ("Tied after H2 drive 1", has_after["tied_after_h2_drive1"]),
        ("Winning after H2 drive 1", has_after["winning_after_h2_drive1"]),
    ]:
        sub = has_after[mask]
        w, n, rate = win_rate(sub)
        print(f"{label}: {w}/{n} = {rate:.1%}  (n={len(sub)})")

    # Cross: losing before AND still losing after first H2 drive
    cross = has_after[has_after["losing_before"] & has_after["still_losing_after_h2_drive1"]]
    w, n, rate = win_rate(cross)
    print(f"Losing before AND still losing after H2 D1: {w}/{n} = {rate:.1%}")

    print("\n========== FATE FLIPS BY TEAM ==========")
    # Teams that were losing before sandwich
    trailing = df[df["losing_before"]].copy()
    team_stats = []
    for team, g in trailing.groupby("team"):
        w, n, rate = win_rate(g)
        flips = int(g["fate_flip"].sum())
        team_stats.append(
            {
                "team": team,
                "trailing_sandwiches": len(g),
                "wins_when_trailing": w,
                "decided": n,
                "win_pct_when_trailing": rate,
                "fate_flips": flips,
            }
        )
    ts = pd.DataFrame(team_stats).sort_values(
        ["win_pct_when_trailing", "fate_flips", "trailing_sandwiches"],
        ascending=[False, False, False],
    )
    ts.to_csv(OUT_DIR / "fate_flips_by_team.csv", index=False)
    print(ts.to_string(index=False))

    # Overall team win% on any sandwich
    print("\n========== TEAM WIN% ON ANY SANDWICH (min 10) ==========")
    any_stats = []
    for team, g in df.groupby("team"):
        w, n, rate = win_rate(g)
        any_stats.append(
            {
                "team": team,
                "sandwiches": len(g),
                "wins": w,
                "decided": n,
                "win_pct": rate,
                "fate_flips": int(g["fate_flip"].sum()),
                "trailing_n": int(g["losing_before"].sum()),
            }
        )
    anys = pd.DataFrame(any_stats)
    anys = anys[anys["sandwiches"] >= 10].sort_values("win_pct", ascending=False)
    anys.to_csv(OUT_DIR / "team_winpct_sandwich.csv", index=False)
    print(anys.to_string(index=False))

    print(f"\nWrote {OUT_DIR}")


if __name__ == "__main__":
    main()

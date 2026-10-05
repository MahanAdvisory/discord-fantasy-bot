"""
H2-receive win rates × leading entering last 30s of H1 × sandwich (2015–2025).

'Leading before 30s' = team score margin > 0 on the last Q2 play with
quarter_seconds_remaining > 30 (i.e. entering the final 30 seconds).
'Not leading' = tied or trailing at that moment.
"""

from __future__ import annotations

from pathlib import Path

import nflreadpy as nfl
import pandas as pd

OUT_DIR = Path(__file__).resolve().parent / "output" / "late-h1-score-h2-receive"
SEASONS = list(range(2015, 2026))


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


def margin_entering_last_30s(game: pd.DataFrame, team: str) -> float | None:
    """Team margin after last Q2 play that still had >30s remaining."""
    q2 = game[
        (game["qtr"] == 2)
        & (game["quarter_seconds_remaining"].notna())
        & (game["quarter_seconds_remaining"] > 30)
        & (game["posteam"].notna())
        & (game["defteam"].notna())
    ].sort_values("play_id")
    if q2.empty:
        # Fall back: first play in ≤30s window, use pre-play scores
        late = game[
            (game["qtr"] == 2)
            & (game["quarter_seconds_remaining"].notna())
            & (game["quarter_seconds_remaining"] <= 30)
            & (game["posteam"].notna())
        ].sort_values("play_id")
        if late.empty:
            return None
        row = late.iloc[0]
        use_post = False
    else:
        row = q2.iloc[-1]
        use_post = True

    posteam, defteam = str(row["posteam"]), str(row["defteam"])
    if use_post:
        ps, ds = float(row["posteam_score_post"]), float(row["defteam_score_post"])
    else:
        ps, ds = float(row["posteam_score"]), float(row["defteam_score"])

    if team == posteam:
        return ps - ds
    if team == defteam:
        return ds - ps
    return None


def final_result(game: pd.DataFrame, team: str) -> str | None:
    scored = game.dropna(subset=["home_team", "away_team", "home_score", "away_score"])
    if scored.empty:
        return None
    last = scored.iloc[-1]
    home, away = str(last["home_team"]), str(last["away_team"])
    hs, as_ = float(last["home_score"]), float(last["away_score"])
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


def analyze_season(season: int) -> list[dict]:
    pbp = nfl.load_pbp(seasons=season).to_pandas()
    rows: list[dict] = []
    for game_id, game in pbp.groupby("game_id", sort=False):
        game = game.sort_values("play_id")
        recv = h2_receiving_team(game)
        if not recv:
            continue
        result = final_result(game, recv)
        if result is None:
            continue
        margin = margin_entering_last_30s(game, recv)
        if margin is None:
            continue
        scorers = late_h1_scoring_teams(game)
        sandwich = recv in scorers
        rows.append(
            {
                "season": season,
                "game_id": game_id,
                "h2_recv": recv,
                "margin_before_30s": margin,
                "leading_before_30s": margin > 0,
                "tied_before_30s": margin == 0,
                "trailing_before_30s": margin < 0,
                "sandwich": sandwich,
                "result": result,
                "won": result == "W",
            }
        )
    return rows


def win_rate(df: pd.DataFrame) -> tuple[int, int, int, float]:
    decided = df[df["result"].isin(["W", "L"])]
    n = len(decided)
    w = int(decided["won"].sum())
    ties = int((df["result"] == "T").sum())
    return w, n, ties, (w / n if n else float("nan"))


def fmt(label: str, sub: pd.DataFrame) -> str:
    w, n, ties, rate = win_rate(sub)
    return f"{label}: {w}/{n} = {rate:.1%}  (n={len(sub)}, ties={ties})"


def main() -> None:
    all_rows: list[dict] = []
    for s in SEASONS:
        print(f"Loading {s}...")
        rows = analyze_season(s)
        print(f"  {len(rows)} games")
        all_rows.extend(rows)

    df = pd.DataFrame(all_rows)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT_DIR / "h2_receive_by_lead_and_sandwich.csv", index=False)

    print("\n========== ALL H2 RECEIVERS ==========")
    print(fmt("All", df))
    print(fmt("Leading before last 30s", df[df["leading_before_30s"]]))
    print(fmt("Not leading before last 30s", df[~df["leading_before_30s"]]))
    print(fmt("  (tied)", df[df["tied_before_30s"]]))
    print(fmt("  (trailing)", df[df["trailing_before_30s"]]))

    print("\n========== SANDWICH ==========")
    sand = df[df["sandwich"]]
    print(fmt("All sandwich", sand))
    print(fmt("Leading before last 30s", sand[sand["leading_before_30s"]]))
    print(fmt("Not leading before last 30s", sand[~sand["leading_before_30s"]]))
    print(fmt("  (tied)", sand[sand["tied_before_30s"]]))
    print(fmt("  (trailing)", sand[sand["trailing_before_30s"]]))

    print("\n========== NO SANDWICH ==========")
    nos = df[~df["sandwich"]]
    print(fmt("All no sandwich", nos))
    print(fmt("Leading before last 30s", nos[nos["leading_before_30s"]]))
    print(fmt("Not leading before last 30s", nos[~nos["leading_before_30s"]]))
    print(fmt("  (tied)", nos[nos["tied_before_30s"]]))
    print(fmt("  (trailing)", nos[nos["trailing_before_30s"]]))

    print("\n========== 2x2 SUMMARY (win%) ==========")
    rows_out = []
    for lead_label, lead_mask in [
        ("Leading before 30s", df["leading_before_30s"]),
        ("Not leading before 30s", ~df["leading_before_30s"]),
    ]:
        for sand_label, sand_mask in [
            ("Sandwich", df["sandwich"]),
            ("No sandwich", ~df["sandwich"]),
            ("All", pd.Series(True, index=df.index)),
        ]:
            sub = df[lead_mask & sand_mask]
            w, n, ties, rate = win_rate(sub)
            rows_out.append(
                {
                    "lead_state": lead_label,
                    "sandwich": sand_label,
                    "wins": w,
                    "decided": n,
                    "win_pct": rate,
                    "n": len(sub),
                    "ties": ties,
                }
            )
            print(f"{lead_label} | {sand_label}: {w}/{n} = {rate:.1%} (n={len(sub)})")

    pd.DataFrame(rows_out).to_csv(OUT_DIR / "h2_receive_2x2_summary.csv", index=False)
    print(f"\nWrote {OUT_DIR}")


if __name__ == "__main__":
    main()

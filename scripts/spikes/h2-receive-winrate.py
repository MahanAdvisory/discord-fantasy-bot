"""H2 opening-receive win rate, with vs without late-H1 sandwich (2015–2025)."""

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
        scorers = late_h1_scoring_teams(game)
        sandwich = recv in scorers
        rows.append(
            {
                "season": season,
                "game_id": game_id,
                "h2_recv": recv,
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


def main() -> None:
    all_rows: list[dict] = []
    for s in SEASONS:
        print(f"Loading {s}...")
        rows = analyze_season(s)
        print(f"  {len(rows)} games with H2 receive")
        all_rows.extend(rows)

    df = pd.DataFrame(all_rows)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT_DIR / "h2_receive_baseline.csv", index=False)

    print("\n========== H2 RECEIVE WIN RATE (2015–2025) ==========")
    for label, sub in [
        ("All H2 receivers", df),
        ("Sandwich (late H1 score + H2 receive)", df[df["sandwich"]]),
        ("No sandwich (H2 receive only)", df[~df["sandwich"]]),
    ]:
        w, n, ties, rate = win_rate(sub)
        print(
            f"{label}: {w}/{n} = {rate:.1%}  "
            f"(games={len(sub)}, ties={ties} excluded from %)"
        )

    w_s, n_s, _, r_s = win_rate(df[df["sandwich"]])
    w_n, n_n, _, r_n = win_rate(df[~df["sandwich"]])
    print(f"\nDelta (sandwich − no sandwich): {r_s - r_n:+.1%} points")
    print(f"Wrote {OUT_DIR / 'h2_receive_baseline.csv'}")


if __name__ == "__main__":
    main()

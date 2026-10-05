"""
Late-H1 first-down runs outside RZ (3:30–1:30 left) vs sandwich / win.

Window: Q2, half_seconds_remaining in [90, 210], down==1, yardline_100 > 20,
play_type in {run, pass}, exclude kneels/spikes/no_play.

Outcomes (for posteam):
  - sandwich: score with ≤30s left in H1 AND receive H2 kickoff
  - win: final score win (ties dropped from win models)

Models: logistic regression with cluster-robust SE by game_id.
Controls: score_differential, yardline_100, half_seconds_remaining, ydstogo,
          posteam_timeouts_remaining, is_home, season.

Also: Patriots 2015–2019 usage deep-dive.
"""

from __future__ import annotations

from pathlib import Path

import nflreadpy as nfl
import numpy as np
import pandas as pd

OUT_DIR = Path(__file__).resolve().parent / "output" / "late-h1-1st-down-run"
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
    out: set[str] = set()
    for _, row in late.iterrows():
        t = scoring_team(row)
        if t:
            out.add(t)
    return out


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
        return "W" if hs > as_ else ("L" if hs < as_ else "T")
    if team == away:
        return "W" if as_ > hs else ("L" if as_ < hs else "T")
    return None


def game_meta(game: pd.DataFrame) -> dict[str, object]:
    recv = h2_receiving_team(game)
    scorers = late_h1_scoring_teams(game)
    sandwich_teams = set()
    if recv and recv in scorers:
        sandwich_teams.add(recv)
    # final results for both sides
    home = game["home_team"].dropna().iloc[0]
    away = game["away_team"].dropna().iloc[0]
    return {
        "h2_recv": recv,
        "sandwich_teams": sandwich_teams,
        "home_team": str(home),
        "away_team": str(away),
        "result_home": final_result(game, str(home)),
        "result_away": final_result(game, str(away)),
    }


def extract_plays(season: int) -> pd.DataFrame:
    pbp = nfl.load_pbp(seasons=season).to_pandas()
    rows: list[dict] = []
    for game_id, game in pbp.groupby("game_id", sort=False):
        game = game.sort_values("play_id")
        meta = game_meta(game)
        window = game[
            (game["qtr"] == 2)
            & (game["half_seconds_remaining"].between(90, 210))
            & (game["down"] == 1)
            & (game["yardline_100"] > 20)
            & (game["play_type"].isin(["run", "pass"]))
        ].copy()
        if "qb_kneel" in window.columns:
            window = window[window["qb_kneel"] != 1]
        if "qb_spike" in window.columns:
            window = window[window["qb_spike"] != 1]
        if window.empty:
            continue

        for _, play in window.iterrows():
            team = str(play["posteam"])
            is_rush = play["play_type"] == "run"
            if team == meta["home_team"]:
                result = meta["result_home"]
            elif team == meta["away_team"]:
                result = meta["result_away"]
            else:
                continue
            sandwich = team in meta["sandwich_teams"]
            sd = play.get("score_differential")
            rows.append(
                {
                    "season": season,
                    "week": int(play["week"]) if pd.notna(play.get("week")) else None,
                    "game_id": game_id,
                    "play_id": play.get("play_id"),
                    "posteam": team,
                    "is_rush": int(is_rush),
                    "play_type": play["play_type"],
                    "half_seconds_remaining": float(play["half_seconds_remaining"]),
                    "yardline_100": float(play["yardline_100"]),
                    "ydstogo": float(play["ydstogo"]) if pd.notna(play.get("ydstogo")) else 10.0,
                    "score_differential": float(sd) if pd.notna(sd) else 0.0,
                    "leading": int(float(sd) > 0) if pd.notna(sd) else 0,
                    "tied": int(float(sd) == 0) if pd.notna(sd) else 0,
                    "trailing": int(float(sd) < 0) if pd.notna(sd) else 0,
                    "posteam_timeouts_remaining": (
                        float(play["posteam_timeouts_remaining"])
                        if pd.notna(play.get("posteam_timeouts_remaining"))
                        else 3.0
                    ),
                    "is_home": int(str(play.get("posteam_type")) == "home"),
                    "sandwich": int(sandwich),
                    "won": 1 if result == "W" else (0 if result == "L" else np.nan),
                    "result": result,
                    "desc": play.get("desc"),
                }
            )
    return pd.DataFrame(rows)


def logit_rush_effect(df: pd.DataFrame, outcome: str, label: str) -> dict:
    """Fit logistic regression; return OR for is_rush with cluster-robust SE."""
    import statsmodels.formula.api as smf

    sub = df.dropna(subset=[outcome, "is_rush", "score_differential"]).copy()
    if outcome == "won":
        sub = sub[sub[outcome].isin([0, 1])]
    sub[outcome] = sub[outcome].astype(int)

    # Raw rates
    raw = (
        sub.groupby("is_rush")[outcome]
        .agg(["mean", "count"])
        .rename(columns={"mean": "rate", "count": "n"})
    )
    rush_rate = float(raw.loc[1, "rate"]) if 1 in raw.index else float("nan")
    pass_rate = float(raw.loc[0, "rate"]) if 0 in raw.index else float("nan")

    formula = (
        f"{outcome} ~ is_rush + score_differential + yardline_100 + "
        "half_seconds_remaining + ydstogo + posteam_timeouts_remaining + "
        "is_home + C(season)"
    )
    try:
        model = smf.logit(formula, data=sub).fit(
            disp=False,
            cov_type="cluster",
            cov_kwds={"groups": sub["game_id"]},
        )
        params = model.params
        conf = model.conf_int()
        or_ = float(np.exp(params["is_rush"]))
        lo = float(np.exp(conf.loc["is_rush", 0]))
        hi = float(np.exp(conf.loc["is_rush", 1]))
        pval = float(model.pvalues["is_rush"])
        # Marginal: predicted probs at mean covariates, rush vs pass
        base = sub.copy()
        base["is_rush"] = 0
        p0 = float(model.predict(base).mean())
        base["is_rush"] = 1
        p1 = float(model.predict(base).mean())
        return {
            "label": label,
            "outcome": outcome,
            "n": len(sub),
            "n_rush": int((sub["is_rush"] == 1).sum()),
            "n_pass": int((sub["is_rush"] == 0).sum()),
            "raw_rush_rate": rush_rate,
            "raw_pass_rate": pass_rate,
            "raw_diff": rush_rate - pass_rate,
            "or": or_,
            "or_lo": lo,
            "or_hi": hi,
            "p": pval,
            "adj_prob_rush": p1,
            "adj_prob_pass": p0,
            "adj_diff": p1 - p0,
            "converged": bool(model.mle_retvals.get("converged", True)),
        }
    except Exception as e:
        return {
            "label": label,
            "outcome": outcome,
            "n": len(sub),
            "error": str(e),
        }


def summarize_rates(df: pd.DataFrame, title: str) -> None:
    print(f"\n=== {title} ===")
    print(f"plays={len(df)}  rush%={df['is_rush'].mean():.1%}")
    for outcome in ["sandwich", "won"]:
        sub = df.dropna(subset=[outcome])
        g = sub.groupby("is_rush")[outcome].agg(["mean", "count"])
        print(f"  {outcome}:")
        for k, name in [(0, "pass"), (1, "rush")]:
            if k in g.index:
                print(f"    {name}: {g.loc[k, 'mean']:.1%} (n={int(g.loc[k, 'count'])})")


def main() -> None:
    frames = []
    for s in SEASONS:
        print(f"Loading {s}...")
        frames.append(extract_plays(s))
        print(f"  {len(frames[-1])} qualifying 1st downs")

    df = pd.concat(frames, ignore_index=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT_DIR / "plays.csv", index=False)

    summarize_rates(df, "ALL 2015-2025")
    summarize_rates(df[df["leading"] == 1], "LEADING only")
    summarize_rates(df[df["trailing"] == 1], "TRAILING only")
    summarize_rates(df[df["tied"] == 1], "TIED only")

    results = []
    for label, sub in [
        ("all", df),
        ("leading", df[df["leading"] == 1]),
        ("not_leading", df[df["leading"] == 0]),
        ("trailing", df[df["trailing"] == 1]),
    ]:
        for outcome in ["sandwich", "won"]:
            results.append(logit_rush_effect(sub, outcome, label))

    res_df = pd.DataFrame(results)
    res_df.to_csv(OUT_DIR / "logit_results.csv", index=False)
    print("\n=== ADJUSTED LOGIT (is_rush OR, cluster by game) ===")
    cols = [
        "label",
        "outcome",
        "n",
        "raw_rush_rate",
        "raw_pass_rate",
        "raw_diff",
        "or",
        "or_lo",
        "or_hi",
        "p",
        "adj_diff",
    ]
    print(res_df[[c for c in cols if c in res_df.columns]].to_string(index=False))

    # Game-level: team-game rush share among qualifying plays
    print("\n=== GAME-LEVEL (team-games with >=1 qualifying play) ===")
    g = (
        df.groupby(["game_id", "posteam", "season"], as_index=False)
        .agg(
            n_plays=("is_rush", "size"),
            n_rush=("is_rush", "sum"),
            sandwich=("sandwich", "max"),
            won=("won", "max"),
            mean_sd=("score_differential", "mean"),
            any_leading=("leading", "max"),
        )
    )
    g["rush_share"] = g["n_rush"] / g["n_plays"]
    g["any_rush"] = (g["n_rush"] > 0).astype(int)
    g.to_csv(OUT_DIR / "team_games.csv", index=False)

    for outcome in ["sandwich", "won"]:
        sub = g.dropna(subset=[outcome])
        print(f"\n{outcome} by any_rush:")
        print(sub.groupby("any_rush")[outcome].agg(["mean", "count"]))

    # Patriots 2015-2019
    ne = df[(df["posteam"] == "NE") & (df["season"].between(2015, 2019))]
    rest = df[(df["posteam"] != "NE") & (df["season"].between(2015, 2019))]
    print("\n=== PATRIOTS 2015-2019 USAGE ===")
    print(f"NE plays: {len(ne)}  rush%={ne['is_rush'].mean():.1%}")
    print(f"Rest of NFL 2015-19: {len(rest)} rush%={rest['is_rush'].mean():.1%}")
    print("\nNE by season:")
    print(
        ne.groupby("season")
        .agg(plays=("is_rush", "size"), rush_pct=("is_rush", "mean"), sandwich=("sandwich", "mean"), win=("won", "mean"))
        .to_string()
    )
    print("\nNE by leading:")
    print(
        ne.groupby("leading")
        .agg(plays=("is_rush", "size"), rush_pct=("is_rush", "mean"), sandwich=("sandwich", "mean"), win=("won", "mean"))
        .to_string()
    )
    summarize_rates(ne, "NE 2015-2019")
    summarize_rates(rest, "NFL ex-NE 2015-2019")

    # League rush% by team 2015-2019 for context
    era = df[df["season"].between(2015, 2019)]
    by_team = (
        era.groupby("posteam")
        .agg(plays=("is_rush", "size"), rush_pct=("is_rush", "mean"))
        .sort_values("rush_pct", ascending=False)
    )
    print("\nTeam rush% in window 2015-2019 (min 30 plays):")
    print(by_team[by_team["plays"] >= 30].head(15).to_string())
    print("NE rank among teams with >=30 plays:")
    ranked = by_team[by_team["plays"] >= 30].reset_index()
    print(ranked[ranked["posteam"] == "NE"])

    ne.to_csv(OUT_DIR / "ne_2015_2019_plays.csv", index=False)
    print(f"\nWrote {OUT_DIR}")


if __name__ == "__main__":
    main()

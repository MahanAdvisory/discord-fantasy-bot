import numpy as np
import pandas as pd
import statsmodels.formula.api as smf

df = pd.read_csv("scripts/spikes/output/late-h1-1st-down-run/plays.csv")


def model_std(sub: pd.DataFrame, outcome: str, controls: str) -> None:
    s = sub.dropna(subset=[outcome]).copy()
    if outcome == "won":
        s = s[s["won"].isin([0, 1])].copy()
    s[outcome] = s[outcome].astype(int)
    formula = f"{outcome} ~ is_rush + {controls}"
    m = smf.logit(formula, data=s).fit(
        disp=False, cov_type="cluster", cov_kwds={"groups": s["game_id"]}
    )
    base = s.copy()
    base["is_rush"] = 0
    p0 = float(m.predict(base).mean())
    base["is_rush"] = 1
    p1 = float(m.predict(base).mean())
    print(
        f"  model-std {outcome}: pass={p0:.1%} rush={p1:.1%} "
        f"diff={(p1 - p0) * 100:+.2f}pp OR={np.exp(m.params['is_rush']):.3f} "
        f"p={m.pvalues['is_rush']:.3f}"
    )


for label, mask in [("TRAILING", df["trailing"] == 1), ("TIED", df["tied"] == 1)]:
    sub = df[mask].copy()
    print(f"\n======== {label} ========")
    print(f"plays={len(sub)} rush%={sub['is_rush'].mean():.1%}")
    for outcome in ["won", "sandwich"]:
        s = sub.dropna(subset=[outcome])
        if outcome == "won":
            s = s[s["won"].isin([0, 1])]
        g = s.groupby("is_rush")[outcome].agg(["mean", "sum", "count"])
        print(f"\n{outcome}:")
        print(g.to_string())
        if 0 in g.index and 1 in g.index:
            print(f"  rush-pass = {(g.loc[1, 'mean'] - g.loc[0, 'mean']) * 100:+.2f} pp")

    if label == "TRAILING":
        s = sub[sub["won"].isin([0, 1])].copy()
        s["won"] = s["won"].astype(int)
        bins = [-100, -14, -7, -3, 0]
        labels = ["-15 or worse", "-14 to -8", "-7 to -4", "-3 to -1"]
        s["sd_bin"] = pd.cut(s["score_differential"], bins=bins, labels=labels)
        print("\nWin by deficit bin:")
        print(
            s.groupby(["sd_bin", "is_rush"], observed=True)["won"]
            .agg(["mean", "count"])
            .unstack("is_rush")
            .to_string()
        )
        controls = (
            "score_differential + yardline_100 + half_seconds_remaining + "
            "ydstogo + posteam_timeouts_remaining + is_home + C(season)"
        )
        model_std(sub, "won", controls)
        model_std(sub, "sandwich", controls)
    else:
        controls = (
            "yardline_100 + half_seconds_remaining + ydstogo + "
            "posteam_timeouts_remaining + is_home + C(season)"
        )
        model_std(sub, "won", controls)
        model_std(sub, "sandwich", controls)

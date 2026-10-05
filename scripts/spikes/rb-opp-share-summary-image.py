#!/usr/bin/env python3
"""Render RB 66% opportunity-share summary table as a PNG."""

from __future__ import annotations

from pathlib import Path

import nflreadpy as nfl
from PIL import Image, ImageDraw, ImageFont

THRESHOLD = 0.66
SEASONS = [2023, 2024, 2025]
OUT = Path(__file__).resolve().parent / "output" / "team-rush" / "rb-opp-share-66-summary.png"


def load_rows() -> list[dict]:
    df = nfl.load_player_stats(seasons=SEASONS, summary_level="week")
    pdf = df.to_pandas()
    reg = pdf[pdf["season_type"] == "REG"].copy()
    reg["carries"] = reg["carries"].fillna(0).astype(int)
    reg["targets"] = reg["targets"].fillna(0).astype(int)

    # Games played = distinct weeks with a row for that player-team
    weekly = reg[reg["position"] == "RB"].copy()
    rbs = (
        weekly.groupby(["season", "team", "player_id", "player_display_name"], as_index=False)
        .agg(
            carries=("carries", "sum"),
            targets=("targets", "sum"),
            games=("week", "nunique"),
        )
    )
    rbs["opps"] = rbs["carries"] + rbs["targets"]
    team = rbs.groupby(["season", "team"], as_index=False).agg(team_opps=("opps", "sum"))
    rbs = rbs.merge(team, on=["season", "team"])
    rbs = rbs[rbs["team_opps"] > 0]
    rbs["opp_share"] = rbs["opps"] / rbs["team_opps"]
    rbs["opps_per_game"] = rbs["opps"] / rbs["games"].clip(lower=1)

    # One row per player-season: team with most opportunities that year
    season_best = (
        rbs.sort_values(["player_id", "season", "opps"], ascending=[True, True, False])
        .groupby(["player_id", "season", "player_display_name"], as_index=False)
        .head(1)
    )
    clearers = set(rbs.loc[rbs["opp_share"] > THRESHOLD, "player_id"])
    season_best = season_best[season_best["player_id"].isin(clearers)]

    rows = []
    for _player_id, group in season_best.groupby("player_id"):
        cleared = group[group["opp_share"] > THRESHOLD]
        # Weighted opps/game across seasons: total opps / total games
        def opg(frame) -> float:
            games = int(frame["games"].sum())
            return float(frame["opps"].sum() / games) if games else 0.0

        rows.append(
            {
                "player": group["player_display_name"].iloc[0],
                "times": int(len(cleared)),
                "avg_cleared": float(cleared["opp_share"].mean()),
                "avg_all": float(group["opp_share"].mean()),
                "opg_cleared": opg(cleared),
                "opg_all": opg(group),
            }
        )
    rows.sort(key=lambda r: (-r["times"], -r["avg_cleared"]))
    return rows


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        r"C:\Windows\Fonts\segoeuib.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def render(rows: list[dict]) -> Path:
    headers = [
        "Player",
        "Times",
        "Avg share\ncleared",
        "Avg share\nall",
        "Opps/G\ncleared",
        "Opps/G\nall",
    ]
    data = [
        [
            r["player"],
            str(r["times"]),
            f"{100 * r['avg_cleared']:.1f}%",
            f"{100 * r['avg_all']:.1f}%",
            f"{r['opg_cleared']:.1f}",
            f"{r['opg_all']:.1f}",
        ]
        for r in rows
    ]

    title_font = font(28, bold=True)
    subtitle_font = font(16)
    header_font = font(14, bold=True)
    cell_font = font(16)
    footer_font = font(13)

    col_widths = [240, 70, 110, 100, 100, 90]
    pad_x, pad_y = 36, 28
    row_h = 36
    header_h = 52
    title_h = 78
    footer_h = 52
    width = pad_x * 2 + sum(col_widths)
    height = pad_y * 2 + title_h + header_h + row_h * len(data) + footer_h

    img = Image.new("RGB", (width, height), "#101724")
    draw = ImageDraw.Draw(img)

    draw.rectangle([0, 0, width, title_h + pad_y], fill="#182235")
    draw.rectangle([0, title_h + pad_y - 3, width, title_h + pad_y], fill="#68d7ff")

    draw.text((pad_x, pad_y), "RB Opportunity Concentration", fill="#f4f7fb", font=title_font)
    draw.text(
        (pad_x, pad_y + 36),
        f">{THRESHOLD:.0%} of team RB opportunities (carries + targets) · {SEASONS[0]}–{SEASONS[-1]}",
        fill="#91a4c2",
        font=subtitle_font,
    )

    y = pad_y + title_h
    draw.rectangle([pad_x - 8, y, width - pad_x + 8, y + header_h], fill="#24324b")

    x = pad_x
    aligns = ["left", "right", "right", "right", "right", "right"]
    for i, header in enumerate(headers):
        lines = header.split("\n")
        if aligns[i] == "left":
            for li, line in enumerate(lines):
                draw.text((x, y + 8 + li * 18), line, fill="#68d7ff", font=header_font)
        else:
            for li, line in enumerate(lines):
                tw = draw.textlength(line, font=header_font)
                draw.text((x + col_widths[i] - tw, y + 8 + li * 18), line, fill="#68d7ff", font=header_font)
        x += col_widths[i]

    y += header_h
    for idx, row in enumerate(data):
        if idx % 2 == 0:
            draw.rectangle([pad_x - 8, y, width - pad_x + 8, y + row_h], fill="#151f30")
        x = pad_x
        for i, cell in enumerate(row):
            color = "#ffffff" if i > 0 else "#dce6f5"
            if aligns[i] == "left":
                draw.text((x, y + 8), cell, fill=color, font=cell_font)
            else:
                tw = draw.textlength(cell, font=cell_font)
                draw.text((x + col_widths[i] - tw, y + 8), cell, fill=color, font=cell_font)
            x += col_widths[i]
        y += row_h

    draw.text(
        (pad_x, height - footer_h + 6),
        "Opps = carries + targets · Opps/G = total opps ÷ games played · Avg all = seasons played in window",
        fill="#7f91ad",
        font=footer_font,
    )
    draw.text(
        (pad_x, height - footer_h + 26),
        "Data: nflverse",
        fill="#7f91ad",
        font=footer_font,
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT)
    return OUT


if __name__ == "__main__":
    path = render(load_rows())
    print(path)

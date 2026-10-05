#!/usr/bin/env python3
"""PNG companion chart: top 25 RBs peak vs avg opps/g with RZ/GZ annotations."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "scripts/spikes/output/team-rush/rb-opps-peak-avg.json"
OUT = ROOT / "scripts/spikes/output/team-rush/rb-opps-peak-avg-chart.png"


def font(size: int, bold: bool = False):
    for path in (
        r"C:\Windows\Fonts\segoeuib.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()


def main() -> None:
    players = json.loads(DATA.read_text(encoding="utf-8"))["players"][:25]
    left = 210
    top = 110
    row_h = 28
    chart_w = 520
    pad = 28
    width = left + chart_w + 280
    height = top + row_h * len(players) + 70

    img = Image.new("RGB", (width, height), "#101724")
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, width, 88], fill="#182235")
    draw.rectangle([0, 85, width, 88], fill="#68d7ff")

    title_f = font(24, True)
    sub_f = font(14)
    label_f = font(13)
    small_f = font(12)

    draw.text((pad, 18), "RB peak vs 3-year avg opportunities/game", fill="#f4f7fb", font=title_f)
    draw.text(
        (pad, 52),
        "Top 25 by peak opps/g · 2023–2025 · carries+targets · RZ≤20 · GZ≤10 · nflverse PBP",
        fill="#91a4c2",
        font=sub_f,
    )

    max_v = max(p["peakOppsG"] for p in players) * 1.08
    # legend
    draw.rectangle([width - 260, 22, width - 244, 38], fill="#68d7ff")
    draw.text((width - 238, 20), "Peak season", fill="#c7d3e6", font=small_f)
    draw.rectangle([width - 260, 46, width - 244, 62], fill="#4a5d7a")
    draw.text((width - 238, 44), "3-year average", fill="#c7d3e6", font=small_f)

    for i, p in enumerate(players):
        y = top + i * row_h
        name = f"{p['player']} ({p['peakSeason']} {p['peakTeam']})"
        draw.text((pad, y + 4), name[:34], fill="#dce6f5", font=label_f)
        # avg bar (behind)
        aw = int(chart_w * p["avgOppsG"] / max_v)
        pw = int(chart_w * p["peakOppsG"] / max_v)
        draw.rectangle([left, y + 6, left + aw, y + 18], fill="#4a5d7a")
        draw.rectangle([left, y + 8, left + pw, y + 16], fill="#68d7ff")
        note = (
            f"{p['peakOppsG']:.1f} peak  "
            f"C{p['peakCarriesG']:.1f}/T{p['peakTargetsG']:.1f}  "
            f"RZ{p['peakRzG']:.1f}/GZ{p['peakGzG']:.1f}  "
            f"avg {p['avgOppsG']:.1f}"
        )
        draw.text((left + chart_w + 12, y + 4), note, fill="#91a4c2", font=small_f)

    draw.text(
        (pad, height - 36),
        "Bar length = opportunities per game. Right-side numbers = peak season carry/target and zone rates.",
        fill="#7f91ad",
        font=small_f,
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT)
    print(OUT)


if __name__ == "__main__":
    main()

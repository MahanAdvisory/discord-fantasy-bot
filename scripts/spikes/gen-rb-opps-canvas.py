#!/usr/bin/env python3
"""Generate the RB opportunity peak/avg canvas from JSON data."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "scripts/spikes/output/team-rush/rb-opps-peak-avg.compact.json"
# Prefer enriched names from full JSON if present
FULL = ROOT / "scripts/spikes/output/team-rush/rb-opps-peak-avg.json"
OUT = Path(r"C:\Users\zaupe\.cursor\projects\c-Cursor-Projects-discord-fantasy-bot\canvases\rb-opportunity-peak-avg.canvas.tsx")

if FULL.exists():
    players = json.loads(FULL.read_text(encoding="utf-8"))["players"]
else:
    players = json.loads(DATA.read_text(encoding="utf-8"))

data_literal = json.dumps(players, indent=2)

canvas = f'''import {{
  BarChart,
  Callout,
  Divider,
  H1,
  H2,
  Row,
  Select,
  Stack,
  Stat,
  Table,
  Text,
  TextInput,
  useCanvasState,
  useHostTheme,
}} from "cursor/canvas";

type Player = {{
  player: string;
  playerId: string;
  peakSeason: number;
  peakTeam: string;
  peakGames: number;
  peakOppsG: number;
  peakCarriesG: number;
  peakTargetsG: number;
  peakRzG: number;
  peakGzG: number;
  avgOppsG: number;
  avgCarriesG: number;
  avgTargetsG: number;
  avgRzG: number;
  avgGzG: number;
  windowGames: number;
  windowOpps: number;
}};

const PLAYERS: Player[] = {data_literal};

type SortKey =
  | "peakOppsG"
  | "avgOppsG"
  | "peakRzG"
  | "peakGzG"
  | "avgRzG"
  | "avgGzG"
  | "peakCarriesG"
  | "avgCarriesG";

const SORT_OPTIONS = [
  {{ value: "peakOppsG", label: "Peak opps/game" }},
  {{ value: "avgOppsG", label: "Avg opps/game" }},
  {{ value: "peakCarriesG", label: "Peak carries/game" }},
  {{ value: "avgCarriesG", label: "Avg carries/game" }},
  {{ value: "peakRzG", label: "Peak red-zone opps/g" }},
  {{ value: "avgRzG", label: "Avg red-zone opps/g" }},
  {{ value: "peakGzG", label: "Peak green-zone opps/g" }},
  {{ value: "avgGzG", label: "Avg green-zone opps/g" }},
];

function n(v: number, d = 1): string {{
  return v.toFixed(d);
}}

export default function RbOpportunityPeakAvg() {{
  const theme = useHostTheme();
  const [sort, setSort] = useCanvasState<SortKey>("sort", "peakOppsG");
  const [query, setQuery] = useCanvasState("query", "");

  const filtered = PLAYERS.filter((p) => {{
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      p.player.toLowerCase().includes(q) ||
      p.peakTeam.toLowerCase().includes(q) ||
      String(p.peakSeason).includes(q)
    );
  }});

  const sorted = [...filtered].sort((a, b) => (b[sort] as number) - (a[sort] as number));
  const top = sorted.slice(0, 20);
  const chartCats = top.map((p) => p.player.split(" ").slice(-1)[0] ?? p.player);

  return (
    <Stack gap={{20}} style={{{{ padding: 20 }}}}>
      <Stack gap={{6}}>
        <H1>RB opportunities/game — peak season vs 3-year average</H1>
        <Text tone="secondary">
          2023–2025 regular season · Opportunities = carries + targets · Red zone inside the 20 · Green zone inside the 10 · Source: nflverse play-by-play
        </Text>
      </Stack>

      <Row gap={{16}} wrap>
        <Stat value={{String(PLAYERS.length)}} label="RBs (min 80 window opps)" />
        <Stat value={{n(PLAYERS[0]?.peakOppsG ?? 0, 2)}} label={{`Peak leader: ${{PLAYERS[0]?.player ?? ""}}`}} tone="info" />
        <Stat value="8+" label="Min games for peak season" />
      </Row>

      <Callout tone="info" title="How to read this">
        Peak season is each RB's highest opportunities/game year in the window (min 8 games). Avg is total opportunities divided by total games across all seasons played 2023–2025. RZ/GZ counts are opportunities that started inside those zones.
      </Callout>

      <Row gap={{12}} align="end" wrap>
        <Stack gap={{4}} style={{{{ minWidth: 220 }}}}>
          <Text weight="semibold">Sort by</Text>
          <Select
            value={{sort}}
            onChange={{(v) => setSort(v as SortKey)}}
            options={{SORT_OPTIONS}}
          />
        </Stack>
        <Stack gap={{4}} style={{{{ minWidth: 240, flex: 1 }}}}>
          <Text weight="semibold">Filter</Text>
          <TextInput value={{query}} onChange={{setQuery}} placeholder="Player, team, or season…" />
        </Stack>
      </Row>

      <Stack gap={{8}}>
        <H2>Top 20 by current sort — peak vs average opps/game</H2>
        <BarChart
          categories={{chartCats}}
          series={{[
            {{ name: "Peak season opps/g", data: top.map((p) => p.peakOppsG), tone: "info" }},
            {{ name: "3-year avg opps/g", data: top.map((p) => p.avgOppsG), tone: "neutral" }},
          ]}}
          height={{320}}
          valueSuffix="/g"
        />
        <Text tone="secondary" style={{{{ fontSize: 12 }}}}>
          Categories use last name for space. Full names and zone breakdowns are in the table below.
        </Text>
      </Stack>

      <Divider />

      <Stack gap={{8}}>
        <H2>All RBs — peak season breakdown and 3-year averages</H2>
        <Table
          stickyHeader
          striped
          headers={{[
            "Player",
            "Peak",
            "Peak opps/g",
            "Peak carries/g",
            "Peak targets/g",
            "Peak RZ/g",
            "Peak GZ/g",
            "Avg opps/g",
            "Avg carries/g",
            "Avg targets/g",
            "Avg RZ/g",
            "Avg GZ/g",
          ]}}
          columnAlign={{[
            "left",
            "left",
            "right",
            "right",
            "right",
            "right",
            "right",
            "right",
            "right",
            "right",
            "right",
            "right",
          ]}}
          rows={{sorted.map((p) => [
            p.player,
            `${{p.peakSeason}} ${{p.peakTeam}}`,
            n(p.peakOppsG, 2),
            n(p.peakCarriesG),
            n(p.peakTargetsG),
            n(p.peakRzG),
            n(p.peakGzG),
            n(p.avgOppsG, 2),
            n(p.avgCarriesG),
            n(p.avgTargetsG),
            n(p.avgRzG),
            n(p.avgGzG),
          ])}}
        />
        <Text tone="secondary" style={{{{ fontSize: 12, color: theme.textSecondary }}}}>
          Showing {{sorted.length}} of {{PLAYERS.length}} RBs. CSV: scripts/spikes/output/team-rush/rb-opps-peak-avg.csv
        </Text>
      </Stack>
    </Stack>
  );
}}
'''

OUT.write_text(canvas, encoding="utf-8")
print(f"Wrote {OUT} ({len(canvas)} chars, {len(players)} players)")

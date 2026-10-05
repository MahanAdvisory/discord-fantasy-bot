"""Generate color-coded team-game-WR table canvas."""

from __future__ import annotations

import json
from pathlib import Path

OUT = Path(__file__).resolve().parent / "output" / "wr-snap-share-2025"
CANVAS = Path(
    r"C:\Users\zaupe\.cursor\projects\c-Cursor-Projects-discord-fantasy-bot\canvases\wr-snap-share-2025.canvas.tsx"
)


def main() -> None:
    data = json.loads((OUT / "canvas_data.json").read_text(encoding="utf-8"))
    order_js = json.dumps(data["order"])
    teams_js = json.dumps(data["teams"])

    canvas = f"""import {{
  H1,
  H2,
  Row,
  Select,
  Stack,
  Table,
  Text,
  useCanvasState,
  useHostTheme,
}} from "cursor/canvas";

type Week = {{
  w: number;
  opp: string;
  wr1: number;
  wr2: number;
  wr3: number;
  sum: number;
  n1: string;
  n2: string;
  n3: string;
}};

type TeamData = {{
  games: number;
  wr1: number;
  wr2: number;
  wr3: number;
  top3: number;
  weeks: Week[];
}};

const ORDER: string[] = {order_js};
const TEAMS: Record<string, TeamData> = {teams_js};

function snapFill(pct: number, theme: ReturnType<typeof useHostTheme>): string {{
  if (pct >= 90) return theme.fill.primary;
  if (pct >= 75) return theme.fill.secondary;
  if (pct >= 55) return theme.fill.tertiary;
  return theme.fill.quaternary;
}}

function sumFill(sum: number, theme: ReturnType<typeof useHostTheme>): string {{
  if (sum >= 240) return theme.fill.primary;
  if (sum >= 220) return theme.fill.secondary;
  if (sum >= 200) return theme.fill.tertiary;
  return theme.fill.quaternary;
}}

function SnapCell({{ pct }}: {{ pct: number }}) {{
  const theme = useHostTheme();
  return (
    <span
      style={{{{
        display: "block",
        margin: "-6px -8px",
        padding: "6px 8px",
        background: snapFill(pct, theme),
        color: theme.text.primary,
        textAlign: "right",
        fontVariantNumeric: "tabular-nums",
        fontWeight: pct >= 90 ? 600 : 400,
      }}}}
    >
      {{pct.toFixed(1)}}%
    </span>
  );
}}

function SumCell({{ sum }}: {{ sum: number }}) {{
  const theme = useHostTheme();
  return (
    <span
      style={{{{
        display: "block",
        margin: "-6px -8px",
        padding: "6px 8px",
        background: sumFill(sum, theme),
        color: theme.text.primary,
        textAlign: "right",
        fontVariantNumeric: "tabular-nums",
        fontWeight: sum >= 240 ? 600 : 400,
      }}}}
    >
      {{sum.toFixed(1)}}
    </span>
  );
}}

function Legend() {{
  const theme = useHostTheme();
  const item = (label: string, bg: string) => (
    <Row gap={{6}} style={{{{ alignItems: "center" }}}}>
      <span
        style={{{{
          width: 14,
          height: 14,
          background: bg,
          border: "1px solid " + theme.stroke.secondary,
        }}}}
      />
      <Text size="small" tone="secondary">
        {{label}}
      </Text>
    </Row>
  );
  return (
    <Stack gap={{6}}>
      <Row gap={{16}} style={{{{ flexWrap: "wrap" }}}}>
        {{item("WR % ≥90", theme.fill.primary)}}
        {{item("75–89", theme.fill.secondary)}}
        {{item("55–74", theme.fill.tertiary)}}
        {{item("<55", theme.fill.quaternary)}}
      </Row>
      <Text size="small" tone="tertiary">
        Top3 sum uses ≥240 / ≥220 / ≥200 / below (same fill steps).
      </Text>
    </Stack>
  );
}}

export default function WrSnapShare2025() {{
  const theme = useHostTheme();
  const [team, setTeam] = useCanvasState("wrSnapTableTeam", "CIN");

  const options = [
    {{ value: "ALL", label: "All teams" }},
    ...ORDER.map((x) => ({{ value: x, label: x }})),
  ];

  const rows = [] as Parameters<typeof Table>[0]["rows"];

  if (team === "ALL") {{
    for (const t of ORDER) {{
      const td = TEAMS[t];
      for (const x of td.weeks) {{
        rows.push([
          t,
          String(x.w),
          x.opp,
          x.n1,
          <SnapCell pct={{x.wr1}} />,
          x.n2,
          <SnapCell pct={{x.wr2}} />,
          x.n3,
          <SnapCell pct={{x.wr3}} />,
          <SumCell sum={{x.sum}} />,
        ]);
      }}
    }}
  }} else {{
    const td = TEAMS[team] ?? TEAMS[ORDER[0]];
    for (const x of td.weeks) {{
      rows.push([
        team,
        String(x.w),
        x.opp,
        x.n1,
        <SnapCell pct={{x.wr1}} />,
        x.n2,
        <SnapCell pct={{x.wr2}} />,
        x.n3,
        <SnapCell pct={{x.wr3}} />,
        <SumCell sum={{x.sum}} />,
      ]);
    }}
    rows.push([
      team,
      "AVG",
      "—",
      "season mean",
      <SnapCell pct={{td.wr1}} />,
      "season mean",
      <SnapCell pct={{td.wr2}} />,
      "season mean",
      <SnapCell pct={{td.wr3}} />,
      <SumCell sum={{td.top3}} />,
    ]);
  }}

  return (
    <Stack gap={{20}} style={{{{ padding: 24, maxWidth: 1200 }}}}>
      <Stack gap={{8}}>
        <H1>2025 WR snap % · team–game–WR table</H1>
        <Text style={{{{ color: theme.text.secondary }}}}>
          One row per team-game. WR1/WR2/WR3 ranked by that game’s offense snap
          % (PFR via nflreadpy). WR1/2/3 % cells and Top3 sum are color-coded.
          Pick a team for a season AVG summary row. REG only.
        </Text>
      </Stack>

      <Row gap={{16}} style={{{{ alignItems: "flex-start", flexWrap: "wrap" }}}}>
        <Select value={{team}} onChange={{setTeam}} options={{options}} />
        <Legend />
      </Row>

      <H2>
        {{team === "ALL"
          ? "All team-games (" + String(rows.length) + ")"
          : team + " · " + String(rows.length - 1) + " games + AVG"}}
      </H2>

      <Table
        stickyHeader
        striped
        headers={{[
          "Team",
          "Week",
          "Opp",
          "WR1",
          "WR1 %",
          "WR2",
          "WR2 %",
          "WR3",
          "WR3 %",
          "Top3 sum",
        ]}}
        columnAlign={{[
          "left",
          "right",
          "left",
          "left",
          "right",
          "left",
          "right",
          "left",
          "right",
          "right",
        ]}}
        rows={{rows}}
      />

      <Text style={{{{ color: theme.text.tertiary, fontSize: 12 }}}}>
        Source: nflverse snap counts · 2025 REG · offense_pct · WR position only
      </Text>
    </Stack>
  );
}}
"""
    CANVAS.write_text(canvas, encoding="utf-8")
    print(f"Wrote {CANVAS} ({len(canvas):,} chars)")


if __name__ == "__main__":
    main()

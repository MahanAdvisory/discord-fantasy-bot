import json
from pathlib import Path

def parse_file(path: Path) -> list[dict]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith(("Season", "Team", "----", "Wrote")):
            continue
        parts = line.split()
        if len(parts) < 12:
            continue
        total = int(parts[1])
        top1 = int(parts[2])
        rows.append(
            {
                "team": parts[0],
                "total": total,
                "top1": top1,
                "top1_pct": 100 * top1 / total if total else 0,
                "rb_pct": float(parts[7]),
            }
        )
    return rows

summary = []
for year in range(2021, 2026):
    rows = parse_file(Path(f"scripts/spikes/output/team-rush/team-rush-{year}.txt"))
    summary.append(
        {
            "season": year,
            "avg_total": sum(r["total"] for r in rows) / len(rows),
            "avg_top1_pct": sum(r["top1_pct"] for r in rows) / len(rows),
            "avg_rb_pct": sum(r["rb_pct"] for r in rows) / len(rows),
            "max_top1": max(rows, key=lambda r: r["top1_pct"]),
            "max_rb": max(rows, key=lambda r: r["rb_pct"]),
        }
    )
print(json.dumps(summary, indent=2))

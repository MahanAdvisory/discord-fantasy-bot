# nflverse ETL

Python job that downloads nflverse parquet (via [nflreadpy](https://github.com/nflverse/nflreadpy)) and upserts into Postgres (`player_id_crosswalk`, `nfl_player_week_stats`).

## Local

```bash
pip install -r etl/requirements.txt
# DATABASE_URL must point at the app Postgres
python etl/sync_nflverse.py
# optional:
python etl/sync_nflverse.py --seasons 2025 2026 --skip-routes
# zone opps (red ≤20 / green ≤10) come from PBP; skip with --skip-zones
```

Nightly steps: crosswalk → player stats → ffopportunity → snaps → routes → **zone opportunities (PBP)** → FantasyPros roster % → season rollup of opportunity/usage/zones.

Passing aDOT (average depth of target) is passing air yards ÷ pass attempts. `passing_air_yards` is written on every player-stat sync, including older seasons already loaded, so the metric is available without a separate column. If a season's air yards are missing, refresh just the player-stat load:

```bash
python etl/sync_nflverse.py --seasons 2015 2016 2017 2018 2019 2020 2021 2022 2023 2024 2025 --skip-crosswalk --skip-opportunity --skip-snaps --skip-routes --skip-zones --skip-rankings --skip-rollup
```

## Railway

Production service: **nflverse-etl** (cron `0 8 * * *` UTC). It uses `etl/Dockerfile` and the same Postgres `DATABASE_URL` as bot/web.

Nightly default seasons are current NFL year plus the prior two (2026–27 slate is included once August hits). Re-run from the Railway dashboard or `python etl/sync_nflverse.py --seasons 2026` when you need an off-schedule refresh.

Attribution in the Stats UI: nflverse / nflfastR / ffopportunity / FTN (participation) / FantasyPros roster % when used as start-rate fallback.

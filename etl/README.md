# nflverse ETL

Python job that downloads nflverse parquet (via [nflreadpy](https://github.com/nflverse/nflreadpy)) and upserts into Postgres (`player_id_crosswalk`, `nfl_player_week_stats`).

## Local

```bash
pip install -r etl/requirements.txt
# DATABASE_URL must point at the app Postgres
python etl/sync_nflverse.py
# optional:
python etl/sync_nflverse.py --seasons 2024 2025 --skip-routes
```

## Railway

1. Create a **cron** service from `etl/railway.toml` / `etl/Dockerfile`.
2. Set `DATABASE_URL` (same as bot/web).
3. Schedule is `0 8 * * *` UTC (nightly). Re-run manually from Railway dashboard when needed.

Attribution in the Stats UI: nflverse / nflfastR / ffopportunity / FTN (participation) / FantasyPros roster % when used as start-rate fallback.

#!/usr/bin/env python3
"""Ingest nflverse weekly player stats (+ opportunity / snaps / routes) into Postgres."""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from dotenv import load_dotenv

load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))


def _num(v: Any) -> float | None:
    if v is None:
        return None
    try:
        if hasattr(v, "item"):
            v = v.item()
        f = float(v)
        if f != f:  # NaN
            return None
        return f
    except (TypeError, ValueError):
        return None


def _int(v: Any) -> int | None:
    f = _num(v)
    return None if f is None else int(round(f))


def _str(v: Any) -> str | None:
    if v is None:
        return None
    try:
        if hasattr(v, "item"):
            v = v.item()
    except Exception:
        pass
    s = str(v).strip()
    if not s:
        return None
    low = s.lower()
    if low in {"nan", "none", "null", "<na>", "nat", "undefined"}:
        return None
    return s


def _valid_gsis(v: Any) -> str | None:
    s = _str(v)
    if not s:
        return None
    # nflverse GSIS ids look like 00-003xxx; reject garbage
    if s.lower() == "nan" or len(s) < 5:
        return None
    return s


def connect():
    import psycopg

    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL is required")
    # Prisma accepts `?schema=...`; libpq/psycopg does not. The ETL uses the
    # database's default schema, which is public for this application's URLs.
    parts = urlsplit(url)
    query = urlencode([(key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True) if key != "schema"])
    url = urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))
    return psycopg.connect(url)


def upsert_crosswalk(conn, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    sql = """
    INSERT INTO player_id_crosswalk
      (sleeper_player_id, gsis_id, espn_id, pfr_id, full_name, position, team, updated_at)
    VALUES (%(sleeper_player_id)s, %(gsis_id)s, %(espn_id)s, %(pfr_id)s, %(full_name)s, %(position)s, %(team)s, %(updated_at)s)
    ON CONFLICT (sleeper_player_id) DO UPDATE SET
      gsis_id = COALESCE(EXCLUDED.gsis_id, player_id_crosswalk.gsis_id),
      espn_id = COALESCE(EXCLUDED.espn_id, player_id_crosswalk.espn_id),
      pfr_id = COALESCE(EXCLUDED.pfr_id, player_id_crosswalk.pfr_id),
      full_name = COALESCE(EXCLUDED.full_name, player_id_crosswalk.full_name),
      position = COALESCE(EXCLUDED.position, player_id_crosswalk.position),
      team = COALESCE(EXCLUDED.team, player_id_crosswalk.team),
      updated_at = EXCLUDED.updated_at
    """
    with conn.cursor() as cur:
        cur.executemany(sql, rows)
    conn.commit()
    return len(rows)


def load_gsis_to_sleeper(conn) -> dict[str, str]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT gsis_id, sleeper_player_id FROM player_id_crosswalk WHERE gsis_id IS NOT NULL"
        )
        return {r[0]: r[1] for r in cur.fetchall()}


def sync_crosswalk(conn) -> None:
    """Build crosswalk from Sleeper catalog JSON + nflverse players + ff ids."""
    import nflreadpy as nfl

    now = datetime.now(timezone.utc)
    gsis_by_espn: dict[str, dict[str, Any]] = {}
    players = nfl.load_players()
    pdf = players.to_pandas() if hasattr(players, "to_pandas") else players
    for _, r in pdf.iterrows():
        gsis = _valid_gsis(r.get("gsis_id"))
        espn = _str(r.get("espn_id"))
        if not gsis:
            continue
        gsis_by_espn[espn or gsis] = {
            "gsis_id": gsis,
            "espn_id": espn,
            "pfr_id": _str(r.get("pfr_id")),
            "full_name": _str(r.get("display_name") or r.get("player_name")),
            "position": _str(r.get("position")),
            "team": _str(r.get("latest_team") or r.get("team")),
        }

    try:
        ffids = nfl.load_ff_playerids()
        fpdf = ffids.to_pandas() if hasattr(ffids, "to_pandas") else ffids
        for _, r in fpdf.iterrows():
            sleeper = _str(r.get("sleeper_id"))
            gsis = _valid_gsis(r.get("gsis_id"))
            if sleeper and gsis:
                gsis_by_espn[sleeper] = {
                    "gsis_id": gsis,
                    "espn_id": _str(r.get("espn_id")),
                    "pfr_id": _str(r.get("pfr_id")),
                    "full_name": _str(r.get("name") or r.get("player_name")),
                    "position": _str(r.get("position")),
                    "team": _str(r.get("team")),
                    "sleeper_player_id": sleeper,
                }
    except Exception as e:
        print(f"warn: load_ff_playerids failed: {e}", file=sys.stderr)

    rows: list[dict[str, Any]] = []
    seen_gsis: set[str] = set()
    with conn.cursor() as cur:
        cur.execute("SELECT player_id, data FROM sleeper_players")
        for player_id, data in cur.fetchall():
            d = data if isinstance(data, dict) else json.loads(data) if data else {}
            espn = _str(d.get("espn_id"))
            gsis = None
            meta = {}
            if espn and espn in gsis_by_espn:
                meta = gsis_by_espn[espn]
                gsis = _valid_gsis(meta.get("gsis_id"))
            # also match from ffids keyed by sleeper
            if player_id in gsis_by_espn and gsis_by_espn[player_id].get("sleeper_player_id"):
                meta = gsis_by_espn[player_id]
                gsis = _valid_gsis(meta.get("gsis_id"))
            # gsis_id is unique — skip if another sleeper row already claimed it
            if gsis and gsis in seen_gsis:
                gsis = None
            if gsis:
                seen_gsis.add(gsis)
            full = (
                _str(d.get("full_name"))
                or " ".join(x for x in [_str(d.get("first_name")), _str(d.get("last_name"))] if x)
                or meta.get("full_name")
            )
            rows.append(
                {
                    "sleeper_player_id": player_id,
                    "gsis_id": gsis,
                    "espn_id": espn or meta.get("espn_id"),
                    "pfr_id": meta.get("pfr_id"),
                    "full_name": full,
                    "position": _str(d.get("position")) or meta.get("position"),
                    "team": _str(d.get("team")) or meta.get("team"),
                    "updated_at": now,
                }
            )

    # Also insert ffids rows where we have sleeper_id but no catalog row yet
    for key, meta in gsis_by_espn.items():
        sid = meta.get("sleeper_player_id")
        gsis = _valid_gsis(meta.get("gsis_id"))
        if not sid or any(r["sleeper_player_id"] == sid for r in rows):
            continue
        if gsis and gsis in seen_gsis:
            gsis = None
        if gsis:
            seen_gsis.add(gsis)
        rows.append(
            {
                "sleeper_player_id": sid,
                "gsis_id": gsis,
                "espn_id": meta.get("espn_id"),
                "pfr_id": meta.get("pfr_id"),
                "full_name": meta.get("full_name"),
                "position": meta.get("position"),
                "team": meta.get("team"),
                "updated_at": now,
            }
        )

    n = upsert_crosswalk(conn, rows)
    print(f"crosswalk upserted {n} rows")


def row_from_player_stats(r: dict[str, Any], gsis_map: dict[str, str], grain: str) -> dict[str, Any]:
    gsis = _valid_gsis(r.get("player_id") or r.get("gsis_id"))
    week = _int(r.get("week"))
    if grain == "season":
        week = -1
    season = _int(r.get("season")) or 0
    season_type = _str(r.get("season_type")) or "REG"
    player_key = gsis or f"unknown:{r.get('player_name')}:{season}:{week}"
    sleeper = gsis_map.get(gsis) if gsis else None
    now = datetime.now(timezone.utc)
    return {
        "id": str(uuid.uuid4()),
        "player_key": player_key,
        "gsis_id": gsis,
        "sleeper_player_id": sleeper,
        "season": season,
        "week": week if week is not None else 0,
        "season_type": season_type,
        "grain": grain,
        "player_name": _str(r.get("player_display_name") or r.get("player_name")),
        "position": _str(r.get("position")),
        "team": _str(r.get("recent_team") or r.get("team")),
        "opponent": _str(r.get("opponent_team")),
        "games_played": _int(r.get("games") or r.get("games_played")) or (1 if grain == "week" else 0),
        "completions": _int(r.get("completions")),
        "attempts": _int(r.get("attempts")),
        "passing_yards": _int(r.get("passing_yards")),
        "passing_tds": _int(r.get("passing_tds")),
        "interceptions": _int(r.get("interceptions") or r.get("passing_interceptions")),
        "passing_air_yards": _int(r.get("passing_air_yards")),
        "passing_yac": _int(r.get("passing_yards_after_catch")),
        "carries": _int(r.get("carries")),
        "rushing_yards": _int(r.get("rushing_yards")),
        "rushing_tds": _int(r.get("rushing_tds")),
        "rushing_first_downs": _int(r.get("rushing_first_downs")),
        "rushing_fumbles_lost": _int(r.get("rushing_fumbles_lost") or r.get("fumbles_lost")),
        "rushing_epa": _num(r.get("rushing_epa")),
        "targets": _int(r.get("targets")),
        "receptions": _int(r.get("receptions")),
        "receiving_yards": _int(r.get("receiving_yards")),
        "receiving_tds": _int(r.get("receiving_tds")),
        "receiving_first_downs": _int(r.get("receiving_first_downs")),
        "receiving_air_yards": _int(r.get("receiving_air_yards")),
        "receiving_yac": _int(r.get("receiving_yards_after_catch")),
        "receiving_fumbles_lost": _int(r.get("receiving_fumbles_lost")),
        "receiving_epa": _num(r.get("receiving_epa")),
        "target_share": _num(r.get("target_share")),
        "air_yards_share": _num(r.get("air_yards_share")),
        "wopr": _num(r.get("wopr")),
        "racr": _num(r.get("racr")),
        "fantasy_points": _num(r.get("fantasy_points")),
        "fantasy_points_ppr": _num(r.get("fantasy_points_ppr")),
        "fetched_at": now,
        "updated_at": now,
    }


UPSERT_SQL = """
INSERT INTO nfl_player_week_stats (
  id, player_key, gsis_id, sleeper_player_id, season, week, season_type, grain,
  player_name, position, team, opponent, games_played,
  completions, attempts, passing_yards, passing_tds, interceptions, passing_air_yards, passing_yac,
  carries, rushing_yards, rushing_tds, rushing_first_downs, rushing_fumbles_lost, rushing_epa,
  targets, receptions, receiving_yards, receiving_tds, receiving_first_downs, receiving_air_yards, receiving_yac, receiving_fumbles_lost,
  receiving_epa, target_share, air_yards_share, wopr, racr, fantasy_points, fantasy_points_ppr,
  fetched_at, updated_at
) VALUES (
  %(id)s, %(player_key)s, %(gsis_id)s, %(sleeper_player_id)s, %(season)s, %(week)s, %(season_type)s, %(grain)s,
  %(player_name)s, %(position)s, %(team)s, %(opponent)s, %(games_played)s,
  %(completions)s, %(attempts)s, %(passing_yards)s, %(passing_tds)s, %(interceptions)s, %(passing_air_yards)s, %(passing_yac)s,
  %(carries)s, %(rushing_yards)s, %(rushing_tds)s, %(rushing_first_downs)s, %(rushing_fumbles_lost)s, %(rushing_epa)s,
  %(targets)s, %(receptions)s, %(receiving_yards)s, %(receiving_tds)s, %(receiving_first_downs)s, %(receiving_air_yards)s, %(receiving_yac)s, %(receiving_fumbles_lost)s,
  %(receiving_epa)s, %(target_share)s, %(air_yards_share)s, %(wopr)s, %(racr)s, %(fantasy_points)s, %(fantasy_points_ppr)s,
  %(fetched_at)s, %(updated_at)s
)
ON CONFLICT (player_key, season, week, season_type, grain) DO UPDATE SET
  gsis_id = EXCLUDED.gsis_id,
  sleeper_player_id = COALESCE(EXCLUDED.sleeper_player_id, nfl_player_week_stats.sleeper_player_id),
  player_name = EXCLUDED.player_name,
  position = EXCLUDED.position,
  team = EXCLUDED.team,
  opponent = EXCLUDED.opponent,
  games_played = EXCLUDED.games_played,
  completions = EXCLUDED.completions,
  attempts = EXCLUDED.attempts,
  passing_yards = EXCLUDED.passing_yards,
  passing_tds = EXCLUDED.passing_tds,
  interceptions = EXCLUDED.interceptions,
  passing_air_yards = EXCLUDED.passing_air_yards,
  passing_yac = EXCLUDED.passing_yac,
  carries = EXCLUDED.carries,
  rushing_yards = EXCLUDED.rushing_yards,
  rushing_tds = EXCLUDED.rushing_tds,
  rushing_first_downs = EXCLUDED.rushing_first_downs,
  rushing_fumbles_lost = EXCLUDED.rushing_fumbles_lost,
  rushing_epa = EXCLUDED.rushing_epa,
  targets = EXCLUDED.targets,
  receptions = EXCLUDED.receptions,
  receiving_yards = EXCLUDED.receiving_yards,
  receiving_tds = EXCLUDED.receiving_tds,
  receiving_first_downs = EXCLUDED.receiving_first_downs,
  receiving_air_yards = EXCLUDED.receiving_air_yards,
  receiving_yac = EXCLUDED.receiving_yac,
  receiving_fumbles_lost = EXCLUDED.receiving_fumbles_lost,
  receiving_epa = EXCLUDED.receiving_epa,
  target_share = EXCLUDED.target_share,
  air_yards_share = EXCLUDED.air_yards_share,
  wopr = EXCLUDED.wopr,
  racr = EXCLUDED.racr,
  fantasy_points = EXCLUDED.fantasy_points,
  fantasy_points_ppr = EXCLUDED.fantasy_points_ppr,
  updated_at = EXCLUDED.updated_at
"""


def sync_player_stats(conn, seasons: list[int]) -> None:
    import nflreadpy as nfl

    gsis_map = load_gsis_to_sleeper(conn)
    for season in seasons:
        for summary, grain in (("week", "week"), ("reg", "season")):
            print(f"loading player_stats season={season} summary={summary}")
            try:
                df = nfl.load_player_stats(seasons=season, summary_level=summary)
            except TypeError:
                df = nfl.load_player_stats(seasons=season)
                grain = "week"
            pdf = df.to_pandas() if hasattr(df, "to_pandas") else df
            batch: list[dict[str, Any]] = []
            for _, r in pdf.iterrows():
                batch.append(row_from_player_stats(r.to_dict(), gsis_map, grain))
                if len(batch) >= 500:
                    with conn.cursor() as cur:
                        cur.executemany(UPSERT_SQL, batch)
                    conn.commit()
                    batch = []
            if batch:
                with conn.cursor() as cur:
                    cur.executemany(UPSERT_SQL, batch)
                conn.commit()
            print(f"  upserted player_stats {season}/{summary} rows={len(pdf)}")


def sync_ff_opportunity(conn, seasons: list[int]) -> None:
    import nflreadpy as nfl

    for season in seasons:
        print(f"loading ff_opportunity season={season}")
        try:
            df = nfl.load_ff_opportunity(seasons=season, stat_type="weekly")
        except Exception as e:
            print(f"warn: ff_opportunity failed for {season}: {e}", file=sys.stderr)
            continue
        pdf = df.to_pandas() if hasattr(df, "to_pandas") else df
        sql = """
        UPDATE nfl_player_week_stats SET
          receptions_exp = %(receptions_exp)s,
          receiving_yards_exp = %(receiving_yards_exp)s,
          receiving_tds_exp = %(receiving_tds_exp)s,
          rushing_yards_exp = %(rushing_yards_exp)s,
          rushing_tds_exp = %(rushing_tds_exp)s,
          passing_yards_exp = %(passing_yards_exp)s,
          passing_tds_exp = %(passing_tds_exp)s,
          total_fantasy_points_exp = %(total_fantasy_points_exp)s,
          total_fantasy_points_diff = %(total_fantasy_points_diff)s,
          updated_at = %(updated_at)s
        WHERE gsis_id = %(gsis_id)s AND season = %(season)s AND week = %(week)s AND grain = 'week'
        """
        now = datetime.now(timezone.utc)
        batch = []
        for _, r in pdf.iterrows():
            gsis = _str(r.get("player_id") or r.get("gsis_id") or r.get("receiver_player_id") or r.get("rusher_player_id"))
            week = _int(r.get("week"))
            if not gsis or week is None:
                continue
            batch.append(
                {
                    "gsis_id": gsis,
                    "season": season,
                    "week": week,
                    "receptions_exp": _num(r.get("receptions_exp") or r.get("rec_receptions_exp")),
                    "receiving_yards_exp": _num(r.get("rec_yards_gained_exp") or r.get("receiving_yards_exp")),
                    "receiving_tds_exp": _num(r.get("rec_touchdown_exp") or r.get("receiving_tds_exp")),
                    "rushing_yards_exp": _num(r.get("rush_yards_gained_exp") or r.get("rushing_yards_exp")),
                    "rushing_tds_exp": _num(r.get("rush_touchdown_exp") or r.get("rushing_tds_exp")),
                    "passing_yards_exp": _num(r.get("pass_yards_gained_exp") or r.get("passing_yards_exp")),
                    "passing_tds_exp": _num(r.get("pass_touchdown_exp") or r.get("passing_tds_exp")),
                    "total_fantasy_points_exp": _num(r.get("total_fantasy_points_exp")),
                    "total_fantasy_points_diff": _num(r.get("total_fantasy_points_diff")),
                    "updated_at": now,
                }
            )
            if len(batch) >= 500:
                with conn.cursor() as cur:
                    cur.executemany(sql, batch)
                conn.commit()
                batch = []
        if batch:
            with conn.cursor() as cur:
                cur.executemany(sql, batch)
            conn.commit()
        print(f"  updated opportunity rows for {season}: {len(pdf)}")


def sync_snap_counts(conn, seasons: list[int]) -> None:
    import nflreadpy as nfl

    for season in seasons:
        print(f"loading snap_counts season={season}")
        try:
            df = nfl.load_snap_counts(seasons=season)
        except Exception as e:
            print(f"warn: snap_counts failed: {e}", file=sys.stderr)
            continue
        pdf = df.to_pandas() if hasattr(df, "to_pandas") else df
        sql = """
        UPDATE nfl_player_week_stats SET
          offense_snaps = %(offense_snaps)s,
          offense_snap_pct = %(offense_snap_pct)s,
          updated_at = %(updated_at)s
        WHERE (gsis_id = %(gsis_id)s OR player_name = %(player_name)s)
          AND season = %(season)s AND week = %(week)s AND grain = 'week'
        """
        now = datetime.now(timezone.utc)
        n = 0
        with conn.cursor() as cur:
            for _, r in pdf.iterrows():
                cur.execute(
                    sql,
                    {
                        "gsis_id": _str(r.get("pfr_player_id") or r.get("player_id")),
                        "player_name": _str(r.get("player")),
                        "season": season,
                        "week": _int(r.get("week")),
                        "offense_snaps": _int(r.get("offense_snaps")),
                        "offense_snap_pct": _num(r.get("offense_pct")),
                        "updated_at": now,
                    },
                )
                n += 1
                if n % 500 == 0:
                    conn.commit()
        conn.commit()
        print(f"  snap updates attempted={n}")


def _week_from_game_id(game_id: Any) -> int | None:
    """Parse week from nflverse game ids like '2024_01_TEN_CHI'."""
    s = _str(game_id)
    if not s:
        return None
    parts = s.split("_")
    if len(parts) < 2:
        return None
    return _int(parts[1])


_SKILL_ROUTE_POS = {"WR", "TE", "RB", "FB"}


def sync_routes_tprr(conn, seasons: list[int]) -> None:
    """Aggregate route proxies from FTN participation and compute TPRR.

    Participation is play-level: `route` is charted when a pass concept has a
    primary receiver route. Week comes from `nflverse_game_id`. We count each
    WR/TE/RB/FB on the field on plays with a non-empty route as one route run
    (standard free-data proxy; not PFF charted routes).
    """
    import nflreadpy as nfl

    for season in seasons:
        if season < 2016:
            continue
        print(f"loading participation season={season} for routes")
        try:
            part = nfl.load_participation(seasons=season)
        except Exception as e:
            print(f"warn: participation failed: {e}", file=sys.stderr)
            continue
        pdf = part.to_pandas() if hasattr(part, "to_pandas") else part
        if "offense_players" not in pdf.columns or "route" not in pdf.columns:
            print("  missing offense_players/route columns; skip routes")
            continue

        routes: dict[tuple[str, int], int] = {}
        # Prefer vectorized path when week can be derived
        if "week" not in pdf.columns and "nflverse_game_id" in pdf.columns:
            pdf = pdf.copy()
            pdf["week"] = pdf["nflverse_game_id"].map(_week_from_game_id)

        if "gsis_id" in pdf.columns:
            # Rare: player-grain participation export
            for _, r in pdf.iterrows():
                if not _str(r.get("route")):
                    continue
                gsis = _valid_gsis(r.get("gsis_id"))
                week = _int(r.get("week"))
                if not gsis or week is None:
                    continue
                routes[(gsis, week)] = routes.get((gsis, week), 0) + 1
        else:
            for _, r in pdf.iterrows():
                if not _str(r.get("route")):
                    continue
                week = _int(r.get("week"))
                if week is None:
                    continue
                players = (_str(r.get("offense_players")) or "").split(";")
                positions = (_str(r.get("offense_positions")) or "").split(";")
                for i, gsis_raw in enumerate(players):
                    gsis = _valid_gsis(gsis_raw)
                    if not gsis:
                        continue
                    pos = (positions[i].strip().upper() if i < len(positions) else "")
                    # Prefer skill positions when charted (2023+). Older participation
                    # exports omit offense_positions — count all offense players then.
                    if pos and pos not in _SKILL_ROUTE_POS:
                        continue
                    routes[(gsis, week)] = routes.get((gsis, week), 0) + 1

        now = datetime.now(timezone.utc)
        sql = """
        UPDATE nfl_player_week_stats SET
          routes_run = %(routes_run)s,
          targets_per_route = CASE
            WHEN %(routes_run)s > 0 AND targets IS NOT NULL
            THEN targets::float / %(routes_run)s
            ELSE NULL END,
          updated_at = %(updated_at)s
        WHERE gsis_id = %(gsis_id)s AND season = %(season)s AND week = %(week)s AND grain = 'week'
        """
        with conn.cursor() as cur:
            for (gsis, week), count in routes.items():
                cur.execute(
                    sql,
                    {
                        "gsis_id": gsis,
                        "season": season,
                        "week": week,
                        "routes_run": count,
                        "updated_at": now,
                    },
                )
        conn.commit()
        print(f"  route aggregates={len(routes)}")


def sync_fantasypros_roster_pct(conn, seasons: list[int]) -> None:
    import nflreadpy as nfl

    for season in seasons:
        print(f"loading ff_rankings roster %% season={season}")
        try:
            df = nfl.load_ff_rankings()
        except Exception as e:
            print(f"warn: ff_rankings failed: {e}", file=sys.stderr)
            return
        pdf = df.to_pandas() if hasattr(df, "to_pandas") else df
        # Best-effort: apply season-wide roster % onto season grain and latest week rows
        sql = """
        UPDATE nfl_player_week_stats SET
          fantasypros_roster_pct = %(pct)s,
          updated_at = %(updated_at)s
        WHERE (player_name = %(name)s OR sleeper_player_id = %(sleeper)s)
          AND season = %(season)s
        """
        now = datetime.now(timezone.utc)
        n = 0
        with conn.cursor() as cur:
            for _, r in pdf.iterrows():
                pct = _num(r.get("ecr") and None)  # placeholder
                pct = _num(r.get("roster_pct") or r.get("owned") or r.get("player_owned_avg"))
                if pct is None:
                    continue
                if pct <= 1.5:
                    pct = pct * 100.0
                cur.execute(
                    sql,
                    {
                        "pct": pct,
                        "name": _str(r.get("player_name") or r.get("player")),
                        "sleeper": _str(r.get("sleeper_id")),
                        "season": season,
                        "updated_at": now,
                    },
                )
                n += 1
        conn.commit()
        print(f"  fantasypros roster updates={n}")


def rollup_season_opportunity_and_usage(conn, seasons: list[int]) -> None:
    """Aggregate weekly opportunity / routes / snaps onto season grain rows (week=-1)."""
    sql = """
    WITH w AS (
      SELECT
        player_key,
        season,
        season_type,
        SUM(COALESCE(receptions_exp, 0)) AS receptions_exp,
        SUM(COALESCE(receiving_yards_exp, 0)) AS receiving_yards_exp,
        SUM(COALESCE(receiving_tds_exp, 0)) AS receiving_tds_exp,
        SUM(COALESCE(rushing_yards_exp, 0)) AS rushing_yards_exp,
        SUM(COALESCE(rushing_tds_exp, 0)) AS rushing_tds_exp,
        SUM(COALESCE(passing_yards_exp, 0)) AS passing_yards_exp,
        SUM(COALESCE(passing_tds_exp, 0)) AS passing_tds_exp,
        SUM(COALESCE(total_fantasy_points_exp, 0)) AS total_fantasy_points_exp,
        SUM(COALESCE(total_fantasy_points_diff, 0)) AS total_fantasy_points_diff,
        SUM(COALESCE(offense_snaps, 0)) AS offense_snaps,
        AVG(offense_snap_pct) AS offense_snap_pct,
        SUM(COALESCE(routes_run, 0)) AS routes_run,
        MAX(fantasypros_roster_pct) AS fantasypros_roster_pct
      FROM nfl_player_week_stats
      WHERE grain = 'week' AND season = ANY(%(seasons)s) AND week > 0
      GROUP BY player_key, season, season_type
    )
    UPDATE nfl_player_week_stats s SET
      receptions_exp = w.receptions_exp,
      receiving_yards_exp = w.receiving_yards_exp,
      receiving_tds_exp = w.receiving_tds_exp,
      rushing_yards_exp = w.rushing_yards_exp,
      rushing_tds_exp = w.rushing_tds_exp,
      passing_yards_exp = w.passing_yards_exp,
      passing_tds_exp = w.passing_tds_exp,
      total_fantasy_points_exp = w.total_fantasy_points_exp,
      total_fantasy_points_diff = w.total_fantasy_points_diff,
      offense_snaps = NULLIF(w.offense_snaps, 0),
      offense_snap_pct = w.offense_snap_pct,
      routes_run = NULLIF(w.routes_run, 0),
      targets_per_route = CASE
        WHEN w.routes_run > 0 AND s.targets IS NOT NULL
        THEN s.targets::float / w.routes_run
        ELSE NULL END,
      fantasypros_roster_pct = COALESCE(w.fantasypros_roster_pct, s.fantasypros_roster_pct),
      updated_at = NOW()
    FROM w
    WHERE s.player_key = w.player_key
      AND s.season = w.season
      AND s.season_type = w.season_type
      AND s.grain = 'season'
      AND s.week = -1
    """
    with conn.cursor() as cur:
        cur.execute(sql, {"seasons": seasons})
    conn.commit()
    print(f"season rollup opportunity/usage for seasons={seasons}")


def main() -> None:
    parser = argparse.ArgumentParser(description="nflverse → Postgres ETL")
    parser.add_argument("--seasons", nargs="+", type=int, default=None)
    parser.add_argument("--skip-crosswalk", action="store_true")
    parser.add_argument("--skip-player-stats", action="store_true")
    parser.add_argument("--skip-opportunity", action="store_true")
    parser.add_argument("--skip-snaps", action="store_true")
    parser.add_argument("--skip-routes", action="store_true")
    parser.add_argument("--skip-rankings", action="store_true")
    parser.add_argument("--skip-rollup", action="store_true")
    args = parser.parse_args()

    import nflreadpy as nfl

    if args.seasons:
        seasons = args.seasons
    else:
        # Prefer latest completed/in-progress NFL season; avoid empty future calendar years.
        year = datetime.now().year
        try:
            if hasattr(nfl, "most_recent_season"):
                year = int(nfl.most_recent_season())
            elif hasattr(nfl, "get_current_season"):
                year = int(nfl.get_current_season())
        except Exception:
            year = min(year, 2025)
        # Nightly: current + prior two seasons (full history via --seasons 2015 …)
        seasons = sorted({year - 2, year - 1, year})

    conn = connect()
    try:
        if not args.skip_crosswalk:
            sync_crosswalk(conn)
        if not args.skip_player_stats:
            sync_player_stats(conn, seasons)
        if not args.skip_opportunity:
            sync_ff_opportunity(conn, seasons)
        if not args.skip_snaps:
            sync_snap_counts(conn, seasons)
        if not args.skip_routes:
            sync_routes_tprr(conn, seasons)
        if not args.skip_rankings:
            sync_fantasypros_roster_pct(conn, seasons)
        if not args.skip_rollup:
            rollup_season_opportunity_and_usage(conn, seasons)
        print("etl complete", seasons)
    finally:
        conn.close()


if __name__ == "__main__":
    main()

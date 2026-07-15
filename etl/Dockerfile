# syntax=docker/dockerfile:1
FROM python:3.12-slim

WORKDIR /app

COPY etl/requirements.txt /app/etl/requirements.txt
RUN pip install --no-cache-dir -r /app/etl/requirements.txt

COPY etl/sync_nflverse.py /app/etl/sync_nflverse.py

ENV PYTHONUNBUFFERED=1

# Railway cron: one-shot sync then exit
CMD ["python", "/app/etl/sync_nflverse.py"]

import assert from "node:assert/strict";
import test from "node:test";
import {
  describeScheduledReport,
  etClock,
  fallbackNflSeason,
  formatScheduleLine,
  isReportDue,
  parseScheduledReport,
  resolveWeekToken,
} from "./reportSchedule.js";

test("Tuesday 9:00 ET is due once that day", () => {
  const schedule = { enabled: true, weekday: 2, hour: 9, minute: 0, lastFiredOn: null as string | null };
  assert.equal(isReportDue(schedule, { weekday: 2, date: "2026-10-06", hour: 8, minute: 59 }), false);
  assert.equal(isReportDue(schedule, { weekday: 2, date: "2026-10-06", hour: 9, minute: 0 }), true);
  assert.equal(
    isReportDue({ ...schedule, lastFiredOn: "2026-10-06" }, { weekday: 2, date: "2026-10-06", hour: 15, minute: 12 }),
    false,
  );
  assert.equal(isReportDue(schedule, { weekday: 3, date: "2026-10-07", hour: 9, minute: 0 }), false);
  assert.equal(isReportDue({ ...schedule, enabled: false }, { weekday: 2, date: "2026-10-06", hour: 9, minute: 0 }), false);
});

test("9:00 ET stays 9:00 across daylight saving", () => {
  const winter = etClock(new Date("2026-01-06T14:00:00Z"));
  assert.deepEqual(winter, { weekday: 2, date: "2026-01-06", hour: 9, minute: 0 });
  const summer = etClock(new Date("2026-10-06T13:00:00Z"));
  assert.deepEqual(summer, { weekday: 2, date: "2026-10-06", hour: 9, minute: 0 });
});

test("fallback season uses the NFL year outside September", () => {
  assert.equal(fallbackNflSeason({ weekday: 2, date: "2026-10-06", hour: 9, minute: 0 }), 2026);
  assert.equal(fallbackNflSeason({ weekday: 2, date: "2027-01-05", hour: 9, minute: 0 }), 2026);
  assert.equal(fallbackNflSeason({ weekday: 2, date: "2026-08-04", hour: 9, minute: 0 }), 2025);
});

test("relative weeks resolve against the latest loaded week", () => {
  assert.equal(resolveWeekToken("most_recent", 4), 4);
  assert.equal(resolveWeekToken("prior_week", 4), 3);
  assert.equal(resolveWeekToken("1", 4), 1);
  assert.equal(resolveWeekToken("prior_week", 1), null);
  assert.equal(resolveWeekToken("most_recent", null), null);
  assert.equal(resolveWeekToken("season", 4), null);
});

test("growth schedules keep week tokens until run time", () => {
  const weekOne = parseScheduledReport({
    report: "stats-growth",
    metric: "tgt_pct",
    position: "WR",
    season: null,
    startWeek: "1",
    endWeek: "most_recent",
    direction: "gain",
    limit: 10,
    minVolume: null,
    scoring: "ppr",
    passTd: 4,
    tePremium: false,
  });
  const prior = parseScheduledReport({
    report: "stats-growth",
    metric: "tgt_pct",
    position: "wr",
    season: null,
    startWeek: "prior_week",
    endWeek: "most_recent",
    direction: "gain",
    limit: 10,
    minVolume: null,
    scoring: null,
    passTd: null,
    tePremium: null,
  });
  assert.equal(describeScheduledReport(weekOne), "WR Tgt% gains, W1 → most recent");
  assert.equal(describeScheduledReport(prior), "WR Tgt% gains, prior week → most recent");
  assert.equal(
    parseScheduledReport({
      report: "stats-growth",
      metric: "tgt_pct",
      position: "WR",
      season: null,
      startWeek: "4",
      endWeek: "4",
      direction: "gain",
      limit: 10,
      minVolume: null,
      scoring: null,
      passTd: null,
      tePremium: null,
    }),
    null,
  );
});

test("leaders and list lines describe the saved report", () => {
  const leaders = parseScheduledReport({
    report: "stats-leaders",
    metric: "tgt_pct",
    position: "WR",
    season: null,
    week: "most_recent",
    limit: 10,
    minVolume: null,
    team: null,
    format: "image",
    scoring: "ppr",
    passTd: 4,
    tePremium: false,
  });
  assert.equal(describeScheduledReport(leaders), "WR Tgt%, most recent");
  const line = formatScheduleLine({
    id: "clxyz123456",
    weekday: 3,
    hour: 9,
    minute: 0,
    params: leaders,
  });
  assert.equal(line, "**clxyz123** · Wednesday 9:00 AM ET · WR Tgt%, most recent");
});

import assert from "node:assert/strict";
import test from "node:test";
import { leadersScatterConfig, receivingScatterConfig } from "./statsImage.js";

test("receiving scatter metrics use the specified volume axes", () => {
  for (const metric of ["tgt_pct", "adot", "rec_epa"]) {
    const config = leadersScatterConfig(metric);
    assert.equal(config?.x.metric, "tgt");
    assert.equal(config?.y.metric, metric);
  }
  for (const metric of ["tprr", "yprr", "fd_rr"]) {
    const config = leadersScatterConfig(metric);
    assert.equal(config?.x.metric, "routes");
    assert.equal(config?.y.metric, metric);
  }
  const snapPct = leadersScatterConfig("snap_pct");
  assert.equal(snapPct?.x.metric, "snaps");
  assert.equal(snapPct?.y.metric, "snap_pct");
});

test("receiving volume metrics chart target share or YPRR", () => {
  for (const metric of ["tgt", "rec", "rec_yds", "air_yds", "rec_fd"]) {
    const config = leadersScatterConfig(metric);
    assert.equal(config?.x.metric, "tgt");
    assert.equal(config?.y.metric, "tgt_pct");
  }
  const routes = leadersScatterConfig("routes");
  assert.equal(routes?.x.metric, "routes");
  assert.equal(routes?.y.metric, "yprr");
});

test("rushing and passing metrics use carry and pass-attempt axes", () => {
  for (const metric of ["rush_epa", "fd_carry"]) {
    const config = leadersScatterConfig(metric);
    assert.equal(config?.x.metric, "att");
    assert.equal(config?.y.metric, metric);
  }
  for (const metric of ["rush_yds", "rush_fd"]) {
    const config = leadersScatterConfig(metric);
    assert.equal(config?.x.metric, "att");
    assert.equal(config?.y.metric, "fd_carry");
  }
  const passing = leadersScatterConfig("pass_yds");
  assert.equal(passing?.x.metric, "pass_att");
  assert.equal(passing?.y.metric, "ypa");
});

test("legacy receiving config remains an alias", () => {
  assert.equal(receivingScatterConfig("rush_yds")?.y.metric, "fd_carry");
});

test("fantasy metrics retain the table image", () => {
  for (const metric of ["fpts", "vorp"]) {
    assert.equal(leadersScatterConfig(metric), null);
  }
});

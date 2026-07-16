import assert from "node:assert/strict";
import test from "node:test";
import { receivingScatterConfig } from "./statsImage.js";

test("receiving scatter metrics use the specified volume axes", () => {
  for (const metric of ["tgt_pct", "adot", "rec_epa", "snap_pct"]) {
    const config = receivingScatterConfig(metric);
    assert.equal(config?.x.metric, "tgt");
    assert.equal(config?.y.metric, metric);
  }
  for (const metric of ["tprr", "yprr", "fd_rr"]) {
    const config = receivingScatterConfig(metric);
    assert.equal(config?.x.metric, "routes");
    assert.equal(config?.y.metric, metric);
  }
});

test("receiving volume metrics chart target share or YPRR", () => {
  for (const metric of ["tgt", "rec", "rec_yds", "air_yds", "rec_fd"]) {
    const config = receivingScatterConfig(metric);
    assert.equal(config?.x.metric, "tgt");
    assert.equal(config?.y.metric, "tgt_pct");
  }
  const routes = receivingScatterConfig("routes");
  assert.equal(routes?.x.metric, "routes");
  assert.equal(routes?.y.metric, "yprr");
});

test("non-receiving metrics retain the table image", () => {
  for (const metric of ["fpts", "rush_yds", "pass_yds", "vorp"]) {
    assert.equal(receivingScatterConfig(metric), null);
  }
});

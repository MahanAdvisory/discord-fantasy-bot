import assert from "node:assert/strict";
import test from "node:test";
import { logRecord } from "./logging.js";

test("logRecord emits one JSON object per line with required fields", () => {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (msg: unknown) => {
    lines.push(String(msg));
  };
  try {
    logRecord("info", "test_message", { foo: 1, bar: "x" });
  } finally {
    console.log = orig;
  }
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
  assert.equal(parsed.level, "info");
  assert.equal(parsed.msg, "test_message");
  assert.equal(parsed.service, "discord-fantasy-bot");
  assert.equal(parsed.foo, 1);
  assert.equal(parsed.bar, "x");
  assert.ok(typeof parsed.ts === "string");
});

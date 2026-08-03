import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMonth } from "../src/stats.mjs";

test("accepts a canonical report month", () => {
  assert.equal(normalizeMonth("2026-08"), "2026-08");
});

test("rejects malformed report months", () => {
  const now = new Date("2026-08-03T12:00:00+03:00");
  assert.equal(normalizeMonth("2026-13", now), "2026-08");
  assert.equal(normalizeMonth("2026-8", now), "2026-08");
});

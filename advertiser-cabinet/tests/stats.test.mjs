import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { normalizeMonth, observePoolErrors } from "../src/stats.mjs";

test("accepts a canonical report month", () => {
  assert.equal(normalizeMonth("2026-08"), "2026-08");
});

test("rejects malformed report months", () => {
  const now = new Date("2026-08-03T12:00:00+03:00");
  assert.equal(normalizeMonth("2026-13", now), "2026-08");
  assert.equal(normalizeMonth("2026-8", now), "2026-08");
});

test("handles and records idle PostgreSQL pool errors without terminating", () => {
  const pool = new EventEmitter();
  const messages = [];
  observePoolErrors(pool, (message) => messages.push(message));
  const error = Object.assign(
    new Error("terminating connection due to administrator command"),
    { code: "57P01" },
  );

  assert.doesNotThrow(() => pool.emit("error", error));
  assert.deepEqual(JSON.parse(messages[0]), {
    level: "error",
    event: "database_pool_error",
    code: "57P01",
    message: "terminating connection due to administrator command",
  });
});

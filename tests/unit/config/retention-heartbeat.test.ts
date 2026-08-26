import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assessRetentionHeartbeat,
  createRetentionHeartbeat,
  RetentionHeartbeatError,
  retentionHeartbeatPolicy,
} from "../../../deploy/prod/retention-heartbeat.mjs";

describe("retention worker heartbeat", () => {
  it("derives the running grace period from the effective database budget", () => {
    expect(retentionHeartbeatPolicy({})).toEqual({
      intervalMs: 21_600_000,
      runningMaxAgeMs: 180_000,
      sleepingMarginMs: 60_000,
    });
    expect(retentionHeartbeatPolicy({
      DATA_RETENTION_INTERVAL_SECONDS: "300",
      RETENTION_DATABASE_QUERY_TIMEOUT_MS: "300000",
    })).toEqual({
      intervalMs: 300_000,
      runningMaxAgeMs: 360_000,
      sleepingMarginMs: 60_000,
    });
    expect(() => retentionHeartbeatPolicy({
      RETENTION_DATABASE_QUERY_TIMEOUT_MS: "0300",
    })).toThrow("canonical decimal integer");
  });

  it("accepts recent progress and rejects stale or future running timestamps", () => {
    const policy = {
      intervalMs: 300_000,
      runningMaxAgeMs: 180_000,
      sleepingMarginMs: 60_000,
    };
    const running = {
      version: 1,
      state: "running",
      lastProgressAt: 1_000,
      lastSuccessAt: null,
      nextRunAt: null,
    };

    expect(assessRetentionHeartbeat(running, policy, 181_000)).toEqual({
      healthy: true,
      reason: null,
    });
    expect(assessRetentionHeartbeat(running, policy, 181_001)).toEqual({
      healthy: false,
      reason: "retention cleanup made no progress",
    });
    expect(assessRetentionHeartbeat(
      { ...running, lastProgressAt: 2_000 },
      policy,
      1_999,
    )).toEqual({ healthy: false, reason: "future heartbeat" });
  });

  it("bounds sleeping health by the reviewed next-run deadline", () => {
    const policy = {
      intervalMs: 300_000,
      runningMaxAgeMs: 180_000,
      sleepingMarginMs: 60_000,
    };
    const sleeping = {
      version: 1,
      state: "sleeping",
      lastProgressAt: 10_000,
      lastSuccessAt: 10_000,
      nextRunAt: 310_000,
    };

    expect(assessRetentionHeartbeat(sleeping, policy, 370_000).healthy).toBe(true);
    expect(assessRetentionHeartbeat(sleeping, policy, 370_001)).toEqual({
      healthy: false,
      reason: "retention cleanup missed its next run",
    });
    expect(assessRetentionHeartbeat(
      { ...sleeping, nextRunAt: 310_001 },
      policy,
      10_000,
    )).toEqual({ healthy: false, reason: "invalid sleeping heartbeat" });
    expect(assessRetentionHeartbeat(
      { ...sleeping, lastSuccessAt: 10_001 },
      policy,
      10_000,
    )).toEqual({ healthy: false, reason: "future heartbeat" });
    expect(assessRetentionHeartbeat(
      { ...sleeping, lastSuccessAt: 9_999 },
      policy,
      10_000,
    )).toEqual({ healthy: false, reason: "invalid sleeping heartbeat" });
    expect(assessRetentionHeartbeat(
      { ...sleeping, nextRunAt: 10_000 },
      policy,
      10_000,
    )).toEqual({ healthy: false, reason: "invalid sleeping heartbeat" });
  });

  it("atomically replaces JSON state and throttles only redundant progress writes", () => {
    const directory = mkdtempSync(join(tmpdir(), "clean-pay-retention-heartbeat-"));
    const filePath = join(directory, "heartbeat.json");
    let current = 1_000;
    try {
      const heartbeat = createRetentionHeartbeat({
        filePath,
        intervalMs: 10_000,
        now: () => current,
      });

      heartbeat.running();
      expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual({
        version: 1,
        state: "running",
        lastProgressAt: 1_000,
        lastSuccessAt: null,
        nextRunAt: null,
      });

      current = 1_500;
      heartbeat.progress();
      expect(JSON.parse(readFileSync(filePath, "utf8")).lastProgressAt).toBe(1_000);

      current = 2_000;
      heartbeat.progress();
      expect(JSON.parse(readFileSync(filePath, "utf8")).lastProgressAt).toBe(2_000);

      current = 3_000;
      heartbeat.sleeping(5_000);
      expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual({
        version: 1,
        state: "sleeping",
        lastProgressAt: 3_000,
        lastSuccessAt: 3_000,
        nextRunAt: 8_000,
      });
      expect(readdirSync(directory)).toEqual(["heartbeat.json"]);

      current = 2_999;
      expect(() => heartbeat.running()).toThrowError(RetentionHeartbeatError);
      expect(() => heartbeat.running()).toThrow("clock moved backwards");
      expect(JSON.parse(readFileSync(filePath, "utf8")).lastProgressAt).toBe(3_000);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("uses a dedicated controlled error when atomic state publication fails", () => {
    const directory = mkdtempSync(join(tmpdir(), "clean-pay-retention-heartbeat-"));
    const filePath = join(directory, "missing", "heartbeat.json");
    try {
      const heartbeat = createRetentionHeartbeat({
        filePath,
        intervalMs: 10_000,
        now: () => 1_000,
      });

      let thrown: unknown;
      try {
        heartbeat.running();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(RetentionHeartbeatError);
      expect((thrown as Error).message).toBe(
        "Retention heartbeat state could not be written",
      );
      expect((thrown as Error).message).not.toContain(filePath);
      expect(readdirSync(directory)).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not echo malformed heartbeat content from the healthcheck", () => {
    const source = readFileSync(
      "deploy/prod/retention-heartbeat.mjs",
      "utf8",
    );

    expect(source).toContain('process.stderr.write("Retention heartbeat unhealthy\\n")');
    expect(source).not.toContain("error.message");
  });
});

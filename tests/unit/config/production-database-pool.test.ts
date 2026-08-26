import { PrismaPg } from "@prisma/adapter-pg";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import {
  assertNoLegacyDatabasePoolUrlParameters,
  createPostgresPool,
  postgresPoolMetrics,
  prismaPgAdapterOptions,
  prismaPgPoolOptions,
} from "../../../deploy/prod/database-pool.mjs";

const connectionString = "postgresql://user:password@db.example/app?sslmode=require";

describe("production PrismaPg pool configuration", () => {
  it("passes an explicitly owned application pg.Pool to PrismaPg", async () => {
    const pool = createPostgresPool({
      connectionString,
      role: "application",
      env: {
        NODE_ENV: "test",
        DATABASE_POOL_MAX: "3",
        DATABASE_CONNECTION_TIMEOUT_MS: "1250",
        DATABASE_IDLE_TIMEOUT_MS: "20000",
        DATABASE_QUERY_TIMEOUT_MS: "9000",
        DATABASE_STATEMENT_TIMEOUT_MS: "8000",
        DATABASE_IDLE_TRANSACTION_TIMEOUT_MS: "7000",
        DATABASE_LOCK_TIMEOUT_MS: "6000",
      },
    });
    const adapter = new PrismaPg(pool) as unknown as {
      externalPool: Pool;
    };

    expect(adapter.externalPool).toBe(pool);
    expect(pool.options).toMatchObject({
      connectionString,
      max: 3,
      connectionTimeoutMillis: 1_250,
      idleTimeoutMillis: 20_000,
      query_timeout: 9_000,
      statement_timeout: 8_000,
      idle_in_transaction_session_timeout: 7_000,
      options: "-c lock_timeout=6000",
      application_name: "clean-pay-app",
    });
    await pool.end();
  });

  it("uses a separate small pool and longer statement budget for retention", () => {
    expect(prismaPgPoolOptions({
      connectionString,
      role: "retention",
      env: { NODE_ENV: "test" },
    })).toMatchObject({
      max: 2,
      connectionTimeoutMillis: 5_000,
      query_timeout: 120_000,
      statement_timeout: 120_000,
      options: "-c lock_timeout=30000",
      application_name: "clean-pay-retention",
    });
  });

  it("keeps readiness on a fixed isolated pool budget", () => {
    expect(prismaPgPoolOptions({
      connectionString,
      role: "readiness",
      env: {
        NODE_ENV: "test",
        READINESS_DATABASE_POOL_MAX: "50",
      },
    })).toMatchObject({
      max: 1,
      connectionTimeoutMillis: 4_000,
      query_timeout: 4_000,
      statement_timeout: 4_000,
      options: "-c lock_timeout=4000",
      application_name: "clean-pay-readiness",
    });
  });

  it("passes the validated DATABASE_URL schema to an external PrismaPg pool", () => {
    expect(prismaPgAdapterOptions(
      "postgresql://user:password@db.example/app?schema=tenant_a&sslmode=require",
      { disposeExternalPool: true },
    )).toEqual({ schema: "tenant_a", disposeExternalPool: true });
    expect(prismaPgAdapterOptions(connectionString)).toEqual({});
    expect(() => prismaPgAdapterOptions(
      "postgresql://user:password@db.example/app?schema=one&schema=two",
    )).toThrow("must not repeat");
    expect(() => prismaPgAdapterOptions(
      "postgresql://user:password@db.example/app?Schema=tenant_a",
    )).toThrow("canonical lowercase spelling");
  });

  it("reports saturation and recovery using documented pg.Pool counters", () => {
    const counters = {
      totalCount: 2,
      idleCount: 0,
      waitingCount: 4,
      options: { max: 2 },
    } as Pool;

    expect(postgresPoolMetrics(counters, "application")).toEqual({
      role: "application",
      active: 2,
      idle: 0,
      waiting: 4,
      maximum: 2,
      exhausted: 1,
    });

    Object.assign(counters, { idleCount: 2, waitingCount: 0 });
    expect(postgresPoolMetrics(counters, "application")).toMatchObject({
      active: 0,
      idle: 2,
      waiting: 0,
      exhausted: 0,
    });
    expect(() => postgresPoolMetrics(counters, "tenant-controlled"))
      .toThrow("Unsupported observable database role");
  });

  it.each([
    "connection_limit=2",
    "pool_timeout=3",
    "connect_timeout=4",
    "statement_timeout=5",
    "idle_in_transaction_session_timeout=6",
    "application_name=misleading",
  ])("rejects ignored or role-overriding DATABASE_URL option %s", (query) => {
    expect(() => assertNoLegacyDatabasePoolUrlParameters(
      `postgresql://user:password@db.example/app?${query}`,
    )).toThrow("role-specific environment setting");
  });

  it("rejects invalid explicit budgets before a network connection is opened", () => {
    expect(() => prismaPgPoolOptions({
      connectionString,
      role: "application",
      env: { NODE_ENV: "test", DATABASE_POOL_MAX: "0" },
    })).toThrow("DATABASE_POOL_MAX");
    expect(() => prismaPgPoolOptions({
      connectionString,
      role: "application",
      env: { NODE_ENV: "test", DATABASE_CONNECTION_TIMEOUT_MS: "1e3" },
    })).toThrow("canonical decimal integer");
  });
});

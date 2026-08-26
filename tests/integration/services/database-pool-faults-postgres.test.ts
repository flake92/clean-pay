import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPostgresPool,
  postgresPoolMetrics,
} from "../../../deploy/prod/database-pool.mjs";

const realDatabaseUrl = process.env.REAL_DATABASE_URL;
const describeWithPostgres = realDatabaseUrl ? describe : describe.skip;

describe("PostgreSQL connection refusal budget", () => {
  it("fails a refused connection within the declared acquisition budget", async () => {
    const refusedPool: Pool = createPostgresPool({
      connectionString: "postgresql://fixture:fixture@127.0.0.1:1/fixture",
      role: "application",
      env: {
        NODE_ENV: "test",
        DATABASE_CONNECTION_TIMEOUT_MS: "250",
      },
    });

    try {
      const startedAt = performance.now();
      await expect(refusedPool.query("SELECT 1")).rejects.toBeInstanceOf(Error);
      expect(performance.now() - startedAt).toBeLessThan(1_500);
    } finally {
      await refusedPool.end();
    }
  });
});

describeWithPostgres("PostgreSQL pool fault budgets", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createPostgresPool({
      connectionString: realDatabaseUrl as string,
      role: "application",
      env: {
        NODE_ENV: "test",
        DATABASE_POOL_MAX: "2",
        DATABASE_CONNECTION_TIMEOUT_MS: "500",
        DATABASE_IDLE_TIMEOUT_MS: "5000",
        DATABASE_QUERY_TIMEOUT_MS: "1000",
        DATABASE_STATEMENT_TIMEOUT_MS: "750",
        DATABASE_IDLE_TRANSACTION_TIMEOUT_MS: "1000",
        DATABASE_LOCK_TIMEOUT_MS: "250",
      },
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("applies server-side role settings and recovers after a slow-query timeout", async () => {
    const settings = await pool.query<{
      applicationName: string;
      lockTimeout: string;
      statementTimeout: string;
    }>(`
      SELECT
        current_setting('application_name') AS "applicationName",
        current_setting('lock_timeout') AS "lockTimeout",
        current_setting('statement_timeout') AS "statementTimeout"
    `);
    expect(settings.rows[0]).toEqual({
      applicationName: "clean-pay-app",
      lockTimeout: "250ms",
      statementTimeout: "750ms",
    });

    const startedAt = performance.now();
    await expect(pool.query("SELECT pg_sleep(2)")).rejects.toBeInstanceOf(Error);
    expect(performance.now() - startedAt).toBeLessThan(2_000);

    await expect(pool.query<{ value: number }>("SELECT 1::int AS value"))
      .resolves.toMatchObject({ rows: [{ value: 1 }] });
  });

  it("bounds lock waits and automatically reuses the pool afterwards", async () => {
    const lockKey = Math.floor(Math.random() * 1_000_000_000);
    let holder: PoolClient | undefined;
    let waiter: PoolClient | undefined;

    try {
      [holder, waiter] = await Promise.all([pool.connect(), pool.connect()]);
      await holder.query("SELECT pg_advisory_lock($1)", [lockKey]);

      const startedAt = performance.now();
      await expect(waiter.query("SELECT pg_advisory_lock($1)", [lockKey]))
        .rejects.toMatchObject({ code: "55P03" });
      expect(performance.now() - startedAt).toBeLessThan(1_500);

      await expect(waiter.query<{ value: number }>("SELECT 1::int AS value"))
        .resolves.toMatchObject({ rows: [{ value: 1 }] });
    } finally {
      if (holder) {
        await holder.query("SELECT pg_advisory_unlock($1)", [lockKey])
          .catch(() => undefined);
      }
      holder?.release();
      waiter?.release();
    }

    await expect(pool.query<{ value: number }>("SELECT 1::int AS value"))
      .resolves.toMatchObject({ rows: [{ value: 1 }] });
  });

  it("times out a saturated acquisition queue, exposes exhaustion, and recovers", async () => {
    const clients = await Promise.all([pool.connect(), pool.connect()]);

    try {
      const startedAt = performance.now();
      const queued = pool.connect();
      expect(postgresPoolMetrics(pool, "application")).toMatchObject({
        active: 2,
        idle: 0,
        waiting: 1,
        maximum: 2,
        exhausted: 1,
      });

      await expect(queued).rejects.toThrow(/timeout exceeded when trying to connect/i);
      expect(performance.now() - startedAt).toBeLessThan(1_500);
      expect(postgresPoolMetrics(pool, "application").waiting).toBe(0);
    } finally {
      for (const client of clients) client.release();
    }

    await expect(pool.query<{ value: number }>("SELECT 1::int AS value"))
      .resolves.toMatchObject({ rows: [{ value: 1 }] });
    expect(postgresPoolMetrics(pool, "application")).toMatchObject({
      waiting: 0,
      exhausted: 0,
    });
  });
});

import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  createPrismaMigrationStatusEnvironment,
  proveNoPendingPrismaMigrations,
} from "../../../deploy/prod/prisma-migration-status.mjs";

const environment = Object.freeze({
  DATABASE_URL:
    "postgresql://clean_pay_app:app-status-only-4Vr8Nm2Kp7Xs5Lc9Qw3D@postgres:5432/clean_pay?schema=public",
  HOLD_OPERATOR_DATABASE_URL:
    "postgresql://clean_pay_hold:hold-status-only-8Lc3Vr7Nm2Kp9Xs5Qw4D@postgres:5432/clean_pay?schema=public",
  MIGRATION_DATABASE_URL:
    "postgresql://clean_pay_migration:migration-status-only-7Kp3Xs9Vr2Nm5Lc8Qw4D@postgres:5432/clean_pay?schema=public",
  NODE_ENV: "test",
  POSTGRES_DB: "clean_pay",
  POSTGRES_PASSWORD: "bootstrap-status-only-9Xs4Lc8Nm2Vr7Kp5Qw3D",
  POSTGRES_USER: "clean_pay_bootstrap",
  RETENTION_DATABASE_URL:
    "postgresql://clean_pay_retention:retention-status-only-6Nm3Kp8Xs2Vr9Lc5Qw4D@postgres:5432/clean_pay?schema=public",
});

describe("Prisma migration status boundary", () => {
  it("projects provision credentials to one validated bootstrap child identity", () => {
    const child = createPrismaMigrationStatusEnvironment(environment);
    const databaseUrl = new URL(child.DATABASE_URL);

    expect(child).toEqual({
      DATABASE_URL:
        "postgresql://clean_pay_bootstrap:bootstrap-status-only-9Xs4Lc8Nm2Vr7Kp5Qw3D@postgres:5432/clean_pay?schema=public",
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_ENV: "production",
    });
    expect(databaseUrl.username).toBe("clean_pay_bootstrap");
    expect(Object.keys(child).sort()).toEqual([
      "DATABASE_URL",
      "NEXT_TELEMETRY_DISABLED",
      "NODE_ENV",
    ]);
    expect(JSON.stringify(child)).not.toContain("clean_pay_migration");
    expect(JSON.stringify(child)).not.toContain("clean_pay_app");
    expect(Object.isFrozen(child)).toBe(true);
  });

  it("accepts the configured postgres bootstrap identity without weakening runtime roles", () => {
    const child = createPrismaMigrationStatusEnvironment({
      ...environment,
      POSTGRES_USER: "postgres",
    });

    expect(new URL(child.DATABASE_URL).username).toBe("postgres");
    expect(child).not.toHaveProperty("CLEAN_PAY_RUNTIME_ROLE");
  });

  it("verifies the reviewed database contract before invoking Prisma", async () => {
    const order: string[] = [];
    const verify = vi.fn(async (input) => {
      order.push("verify");
      expect(input).toEqual({ environment, mode: "verify" });
      return { manifestVersion: "2026-08-26.6", mode: "verify" } as const;
    });
    const execute = vi.fn(async (childEnvironment) => {
      order.push("execute");
      expect(Object.keys(childEnvironment).sort()).toEqual([
        "DATABASE_URL",
        "NEXT_TELEMETRY_DISABLED",
        "NODE_ENV",
      ]);
    });

    await proveNoPendingPrismaMigrations({ environment, execute, verify });

    expect(order).toEqual(["verify", "execute"]);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not invoke Prisma when the reviewed database contract fails", async () => {
    const execute = vi.fn();
    const verify = vi.fn(async () => {
      throw new Error("synthetic reviewed state mismatch");
    });

    await expect(proveNoPendingPrismaMigrations({
      environment,
      execute,
      verify,
    })).rejects.toThrow("synthetic reviewed state mismatch");
    expect(execute).not.toHaveBeenCalled();
  });

  it("invokes only the pinned local CLI and suppresses credential-bearing output", () => {
    const source = readFileSync(
      "deploy/prod/prisma-migration-status.mjs",
      "utf8",
    );

    expect(source).toContain(
      'spawn(process.execPath, [prismaCli, "migrate", "status"],',
    );
    expect(source).toContain('stdio: "ignore"');
    expect(source).not.toMatch(/\bshell\s*:/u);
    expect(source).not.toContain("configuration.bootstrap.raw]");
  });
});

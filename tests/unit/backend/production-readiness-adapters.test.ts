import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adapterConstructor: vi.fn(),
  getEnv: vi.fn(),
  loggerError: vi.fn(),
  prismaConstructor: vi.fn(),
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class PrismaPg {
    constructor(options: unknown, adapterOptions?: unknown) {
      mocks.adapterConstructor(options, adapterOptions);
    }
  },
}));
vi.mock("@prisma/client", () => ({
  PrismaClient: class PrismaClient {
    readonly marker = "ready";

    constructor(options: unknown) { mocks.prismaConstructor(options); }

    readMarker() { return this.marker; }
  },
}));
vi.mock("@/backend/config/env", () => ({
  getEnv: mocks.getEnv,
}));
vi.mock("@/backend/observability/logger", () => ({
  logger: { error: mocks.loggerError },
}));

describe("production readiness adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEnv.mockReturnValue({
      databaseUrl: "postgresql://user:password@db.example/app",
    });
  });

  it("does not create the application pool until the Prisma client is used", async () => {
    const globals = globalThis as {
      prisma?: unknown;
      cleanPayApplicationDatabasePool?: unknown;
      cleanPayReadinessDatabasePool?: unknown;
    };
    delete globals.prisma;
    delete globals.cleanPayApplicationDatabasePool;
    delete globals.cleanPayReadinessDatabasePool;
    vi.resetModules();

    const prismaModule = await import("@/backend/database/prisma");
    expect(mocks.getEnv).not.toHaveBeenCalled();
    expect(mocks.adapterConstructor).not.toHaveBeenCalled();

    prismaModule.getPrismaClient();

    const pool = mocks.adapterConstructor.mock.calls[0]?.[0] as {
      options?: Record<string, unknown>;
    };
    expect(pool.options).toMatchObject({
      max: 8,
      connectionTimeoutMillis: 5_000,
      application_name: "clean-pay-app",
    });
    expect(mocks.adapterConstructor.mock.calls[0]?.[1]).toEqual({
      disposeExternalPool: true,
    });
    expect(mocks.prismaConstructor).toHaveBeenCalledOnce();
  });

  it("creates a dedicated bounded database client", async () => {
    const globals = globalThis as {
      readinessPrisma?: unknown;
      cleanPayApplicationDatabasePool?: unknown;
      cleanPayReadinessDatabasePool?: unknown;
    };
    delete globals.readinessPrisma;
    delete globals.cleanPayApplicationDatabasePool;
    delete globals.cleanPayReadinessDatabasePool;
    vi.resetModules();

    const readinessModule = await import("@/backend/database/readiness-prisma");
    expect(mocks.getEnv).not.toHaveBeenCalled();
    expect(mocks.adapterConstructor).not.toHaveBeenCalled();

    readinessModule.getReadinessPrismaClient();

    const pool = mocks.adapterConstructor.mock.calls[0]?.[0] as {
      options?: Record<string, unknown>;
    };
    expect(pool.options).toMatchObject({
      connectionString: "postgresql://user:password@db.example/app",
      max: 1,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 4_000,
      query_timeout: 4_000,
      statement_timeout: 4_000,
      idle_in_transaction_session_timeout: 4_000,
      options: "-c lock_timeout=4000",
      application_name: "clean-pay-readiness",
    });
    expect(mocks.adapterConstructor.mock.calls[0]?.[1]).toEqual({
      disposeExternalPool: true,
    });
    expect(mocks.prismaConstructor).toHaveBeenCalledWith(expect.objectContaining({
      adapter: expect.anything(),
      log: ["error"],
    }));

    const lazyClient = readinessModule.readinessPrisma as unknown as {
      marker: string;
      readMarker(): string;
    };
    expect(lazyClient.marker).toBe("ready");
    expect(lazyClient.readMarker()).toBe("ready");
  });

  it("reuses both shared role pools and exports bounded runtime metrics", async () => {
    const globals = globalThis as {
      cleanPayApplicationDatabasePool?: unknown;
      cleanPayReadinessDatabasePool?: unknown;
    };
    delete globals.cleanPayApplicationDatabasePool;
    delete globals.cleanPayReadinessDatabasePool;
    vi.resetModules();

    const pools = await import("@/backend/database/pools");
    const application = pools.getApplicationDatabasePool();
    const readiness = pools.getReadinessDatabasePool();

    expect(pools.getApplicationDatabasePool()).toBe(application);
    expect(pools.getReadinessDatabasePool()).toBe(readiness);
    expect(readiness).not.toBe(application);
    expect(pools.runtimeDatabasePoolMetrics()).toEqual([
      {
        role: "application",
        active: 0,
        idle: 0,
        waiting: 0,
        maximum: 8,
        exhausted: 0,
      },
      {
        role: "readiness",
        active: 0,
        idle: 0,
        waiting: 0,
        maximum: 1,
        exhausted: 0,
      },
    ]);

    (application as { emit(event: string, error: Error): boolean }).emit(
      "error",
      Object.assign(new Error("must-not-log"), {
        code: "57P01",
        connectionString: "postgresql://must-not-log",
      }),
    );
    expect(mocks.loggerError).toHaveBeenCalledWith(
      "database_pool_error",
      { role: "application", errorName: "Error", code: "57P01" },
      { source: "database.pool" },
    );
  });
});

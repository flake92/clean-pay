import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adapterConstructor: vi.fn(),
  prismaConstructor: vi.fn(),
  createProductionReadinessGateway: vi.fn(),
  runDetailedReadinessUseCase: vi.fn(),
  getPublicReadinessUseCase: vi.fn(),
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class PrismaPg {
    constructor(options: unknown) { mocks.adapterConstructor(options); }
  },
}));
vi.mock("@prisma/client", () => ({
  PrismaClient: class PrismaClient {
    constructor(options: unknown) { mocks.prismaConstructor(options); }
  },
}));
vi.mock("@/backend/config/env", () => ({
  getEnv: () => ({ databaseUrl: "postgresql://user:password@db.example/app" }),
}));
vi.mock("@/backend/health/checks", () => ({
  createProductionReadinessGateway: mocks.createProductionReadinessGateway,
}));
vi.mock("@/application/health/readiness", () => ({
  runDetailedReadiness: mocks.runDetailedReadinessUseCase,
  getPublicReadiness: mocks.getPublicReadinessUseCase,
}));

import { getPublicReadiness, runDetailedReadiness } from "@/backend/health/readiness";

describe("production readiness adapters", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a dedicated bounded database client", async () => {
    delete (globalThis as { readinessPrisma?: unknown }).readinessPrisma;
    vi.resetModules();

    await import("@/backend/database/readiness-prisma");

    expect(mocks.adapterConstructor).toHaveBeenCalledWith({
      connectionString: "postgresql://user:password@db.example/app",
      max: 1,
      connectionTimeoutMillis: 4_000,
      query_timeout: 4_000,
      statement_timeout: 4_000,
    });
    expect(mocks.prismaConstructor).toHaveBeenCalledWith(expect.objectContaining({
      adapter: expect.anything(),
      log: ["error"],
    }));
  });

  it("delegates detailed and public readiness through a fresh production gateway", async () => {
    const gateway = { database: vi.fn() };
    mocks.createProductionReadinessGateway.mockReturnValue(gateway);
    mocks.runDetailedReadinessUseCase.mockResolvedValue({ status: "ok" });
    mocks.getPublicReadinessUseCase.mockResolvedValue({ status: "ok" });

    await expect(runDetailedReadiness()).resolves.toEqual({ status: "ok" });
    await expect(getPublicReadiness(123)).resolves.toEqual({ status: "ok" });
    expect(mocks.runDetailedReadinessUseCase).toHaveBeenCalledWith(gateway);
    expect(mocks.getPublicReadinessUseCase).toHaveBeenCalledWith(gateway, 123);
    expect(mocks.createProductionReadinessGateway).toHaveBeenCalledTimes(2);
  });
});

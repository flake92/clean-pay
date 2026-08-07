import type { AuditLogger } from "@/backend/services/audit-logger";
import type { CacheStore } from "@/backend/services/cache-store";
import type { CryptoService } from "@/backend/services/crypto-service";
import type { ExternalGateway } from "@/backend/services/external-gateway";
import type { SessionStore } from "@/backend/services/session-store";
import type { UserStore } from "@/backend/services/user-store";
import { nodeCryptoService } from "@/backend/services/node-crypto-service";
import { prismaAuditLogger } from "@/backend/services/prisma-audit-logger";
import { redisCacheStore } from "@/backend/services/redis-cache-store";

export type ServiceRegistry = {
  userStore: UserStore;
  sessionStore: SessionStore;
  cacheStore: CacheStore;
  cryptoService: CryptoService;
  externalGateway: ExternalGateway;
  auditLogger: AuditLogger;
};

let registry: ServiceRegistry | null = null;

export function getServiceRegistry(): ServiceRegistry {
  if (!registry) {
    throw new Error("Service registry not initialized. Call initServiceRegistry() first.");
  }
  return registry;
}

export function initServiceRegistry(services: Partial<ServiceRegistry> = {}): ServiceRegistry {
  registry = {
    userStore: services.userStore ?? createPrismaUserStore(),
    sessionStore: services.sessionStore ?? createPrismaSessionStore(),
    cacheStore: services.cacheStore ?? redisCacheStore,
    cryptoService: services.cryptoService ?? nodeCryptoService,
    externalGateway: services.externalGateway ?? createHttpExternalGateway(),
    auditLogger: services.auditLogger ?? prismaAuditLogger,
  };
  return registry;
}

function createPrismaUserStore(): UserStore {
  // Lazy import to avoid circular dependency
  const { prismaUserStore } = require("@/backend/services/prisma-user-store");
  return prismaUserStore;
}

function createPrismaSessionStore(): SessionStore {
  const { prismaSessionStore } = require("@/backend/services/prisma-session-store");
  return prismaSessionStore;
}

function createHttpExternalGateway(): ExternalGateway {
  const { httpExternalGateway } = require("@/backend/services/http-external-gateway");
  return httpExternalGateway;
}

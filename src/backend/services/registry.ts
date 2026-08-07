import type { AuditLogger } from "@/backend/services/audit-logger";
import type { CacheStore } from "@/backend/services/cache-store";
import type { CryptoService } from "@/backend/services/crypto-service";
import type { ExternalGateway } from "@/backend/services/external-gateway";
import type { MergeConfirmationStore } from "@/backend/services/merge-confirmation-store";
import type { PaymentOperationStore } from "@/backend/services/payment-operation-store";
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
  mergeConfirmationStore: MergeConfirmationStore;
  paymentOperationStore: PaymentOperationStore;
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
    mergeConfirmationStore: services.mergeConfirmationStore ?? createPrismaMergeConfirmationStore(),
    paymentOperationStore: services.paymentOperationStore ?? createPrismaPaymentOperationStore(),
  };
  return registry;
}

function createPrismaUserStore(): UserStore {
  // Lazy import to avoid circular dependency
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { prismaUserStore } = require("@/backend/services/prisma-user-store") as { prismaUserStore: UserStore };
  return prismaUserStore;
}

function createPrismaSessionStore(): SessionStore {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { prismaSessionStore } = require("@/backend/services/prisma-session-store") as { prismaSessionStore: SessionStore };
  return prismaSessionStore;
}

function createHttpExternalGateway(): ExternalGateway {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { httpExternalGateway } = require("@/backend/services/http-external-gateway") as { httpExternalGateway: ExternalGateway };
  return httpExternalGateway;
}

function createPrismaMergeConfirmationStore(): MergeConfirmationStore {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { prismaMergeConfirmationStore } = require("@/backend/services/prisma-merge-confirmation-store") as { prismaMergeConfirmationStore: MergeConfirmationStore };
  return prismaMergeConfirmationStore;
}

function createPrismaPaymentOperationStore(): PaymentOperationStore {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { prismaPaymentOperationStore } = require("@/backend/services/prisma-payment-operation-store") as { prismaPaymentOperationStore: PaymentOperationStore };
  return prismaPaymentOperationStore;
}

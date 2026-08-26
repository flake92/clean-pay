import { createCipheriv, createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  decryptKeyringSecret,
  encryptKeyringSecret,
  encryptSecret,
} from "@/backend/security/crypto";
import {
  assertEncryptionRewrapRuntimeEnvironment,
  encryptionRewrapExitCode,
  parseEncryptionRewrapArguments,
} from "../../../deploy/prod/encryption-rewrap-command.mjs";
import {
  encryptionKeyCommitment,
  encryptionKeyringFromEnvironment,
  encryptionRewrapPurposes,
  runEncryptionRewrap,
} from "../../../deploy/prod/encryption-rewrap.mjs";

type SessionRow = {
  id: string;
  remnashopAccessTokenEncrypted: string | null;
  remnashopRefreshTokenEncrypted: string | null;
  remnashopRefreshRecoveryEncrypted: string | null;
};

type SuccessorRow = {
  id: string;
  successorTokenEncrypted: string;
};

type CallbackRow = {
  id: string;
  callbackResultEncrypted: string | null;
};

const rewrapCommandSource = readFileSync(
  "deploy/prod/encryption-rewrap-command.mjs",
  "utf8",
);

function page<T extends { id: string }>(rows: T[], query: {
  where?: unknown;
  take: number;
}) {
  const afterId = (query.where as { id?: { gt?: string } } | undefined)
    ?.id?.gt;
  const nextIndex = afterId
    ? rows.findIndex(({ id }) => id > afterId)
    : 0;
  const start = nextIndex < 0 ? rows.length : nextIndex;
  return rows.slice(start, start + query.take).map((row) => ({ ...row }));
}

function scansCurrentEnvelopes(where: unknown) {
  const serialized = JSON.stringify(where ?? {});
  return serialized === "{}" || serialized.includes('"not":null');
}

function encryptV1Envelope(
  value: string,
  entry: { id: string; secret: string },
  purpose: string,
) {
  const iv = randomBytes(12);
  const prefix = `v1.${entry.id}`;
  const key = createHmac("sha256", entry.secret)
    .update(`clean-pay:secret-encryption:v1:${purpose}`)
    .digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${prefix}.${purpose}`, "utf8"));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    prefix,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

describe("bounded encryption rewrap", () => {
  it("requires the application role and rejects leaked database credentials before connecting", () => {
    expect(() => assertEncryptionRewrapRuntimeEnvironment({
      DATABASE_URL:
        "postgresql://clean_pay_app:db-app-unit-8Nc4Kp2Vr7Xm9Ls5Qw3H@postgres:5432/clean_pay?schema=public",
    })).toThrow("CLEAN_PAY_RUNTIME_ROLE=application is required");

    expect(() => assertEncryptionRewrapRuntimeEnvironment({
      CLEAN_PAY_RUNTIME_ROLE: "application",
      DATABASE_URL:
        "postgresql://clean_pay_app:db-app-unit-8Nc4Kp2Vr7Xm9Ls5Qw3H@postgres:5432/clean_pay?schema=public",
      POSTGRES_PASSWORD: "must-not-reach-the-application-role",
    })).toThrow(
      "POSTGRES_PASSWORD must not be present in a role-scoped runtime environment",
    );
  });

  it("does not enable Prisma's unsanitized automatic error logger", () => {
    expect(rewrapCommandSource).not.toMatch(/\blog\s*:\s*\[\s*["']error["']/);
    expect(rewrapCommandSource).toContain(
      "Encryption rewrap failed without logging row identifiers or key material.",
    );
  });
  it("reports, CAS-rewraps and retires key A for non-empty mixed stores", async () => {
    const secretA = "synthetic-rotation-secret-A-4Vr8Nm2Kq7Xs5Lp9"; // gitleaks:allow -- synthetic test credential
    const secretB = "synthetic-rotation-secret-B-9Kq3Xs7Vr5Nm2Lp8"; // gitleaks:allow -- synthetic test credential
    const keyA = {
      primary: { id: "shared-key", secret: secretA },
      previous: [],
    };
    const mixed = {
      primary: { id: "shared-key", secret: secretB },
      previous: [{ id: "shared-key", secret: secretA }],
    };
    const keyB = {
      primary: mixed.primary,
      previous: [],
    };
    const sessions: SessionRow[] = [{
      id: "session-row",
      remnashopAccessTokenEncrypted: encryptSecret("provider-access", secretA),
      remnashopRefreshTokenEncrypted: encryptV1Envelope(
        "provider-refresh",
        keyA.primary,
        encryptionRewrapPurposes.providerToken,
      ),
      remnashopRefreshRecoveryEncrypted: encryptKeyringSecret(
        JSON.stringify({ version: 1, accessToken: "recovery-access" }),
        keyA,
        encryptionRewrapPurposes.providerToken,
      ),
    }];
    const successors: SuccessorRow[] = [{
      id: "successor-row",
      successorTokenEncrypted: encryptKeyringSecret(
        "lost-response-successor",
        keyA,
        encryptionRewrapPurposes.refreshSuccessor,
      ),
    }];
    const callbacks: CallbackRow[] = [{
      id: "callback-row",
      callbackResultEncrypted: encryptKeyringSecret(
        JSON.stringify({ version: 1, session: { webSessionId: "synthetic" } }),
        keyA,
        encryptionRewrapPurposes.telegramCallback,
      ),
    }];
    const currentPrefix = [
      "v2",
      mixed.primary.id,
      encryptionKeyCommitment(mixed.primary.secret),
      "",
    ].join(".");
    const prisma = {
      webSession: {
        findMany: vi.fn(async (query: {
          where?: unknown;
          take: number;
        }) =>
          page(sessions.filter((row) => [
            row.remnashopAccessTokenEncrypted,
            row.remnashopRefreshTokenEncrypted,
            row.remnashopRefreshRecoveryEncrypted,
          ].some((value) => value && (
            scansCurrentEnvelopes(query.where) || !value.startsWith(currentPrefix)
          ))), query)),
        updateMany: vi.fn(async ({
          where,
          data,
        }: {
          where: Partial<SessionRow> & { id: string };
          data: Partial<SessionRow>;
        }) => {
          const row = sessions.find(({ id }) => id === where.id);
          const matches = row && Object.entries(where).every(
            ([field, value]) => row[field as keyof SessionRow] === value,
          );
          if (!row || !matches) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        }),
      },
      webRefreshToken: {
        findMany: vi.fn(async (query: {
          where?: unknown;
          take: number;
        }) => page(successors.filter((row) =>
          scansCurrentEnvelopes(query.where)
          || !row.successorTokenEncrypted.startsWith(currentPrefix)), query)),
        updateMany: vi.fn(async ({
          where,
          data,
        }: {
          where: SuccessorRow;
          data: Pick<SuccessorRow, "successorTokenEncrypted">;
        }) => {
          const row = successors.find(({ id }) => id === where.id);
          if (!row || row.successorTokenEncrypted !== where.successorTokenEncrypted) {
            return { count: 0 };
          }
          Object.assign(row, data);
          return { count: 1 };
        }),
      },
      telegramAuthState: {
        findMany: vi.fn(async (query: {
          where?: unknown;
          take: number;
        }) =>
          page(callbacks.filter((row) =>
            row.callbackResultEncrypted
            && (
              scansCurrentEnvelopes(query.where)
              || !row.callbackResultEncrypted.startsWith(currentPrefix)
            )), query)),
        updateMany: vi.fn(async ({
          where,
          data,
        }: {
          where: CallbackRow & { callbackResultEncrypted: string };
          data: Pick<CallbackRow, "callbackResultEncrypted">;
        }) => {
          const row = callbacks.find(({ id }) => id === where.id);
          if (!row || row.callbackResultEncrypted !== where.callbackResultEncrypted) {
            return { count: 0 };
          }
          Object.assign(row, data);
          return { count: 1 };
        }),
      },
    };

    const dryRun = await runEncryptionRewrap(prisma, mixed, {
      batchSize: 1,
      maxBatches: 10,
    });
    expect(dryRun).toMatchObject({
      mode: "report",
      complete: true,
      needsRewrap: 5,
      rewrapped: 0,
      unreadable: 0,
      oldKeyUsage: { "shared-key": 5 },
      retirementReady: false,
    });
    expect(sessions[0].remnashopAccessTokenEncrypted).not.toMatch(/^v2\.shared-key\./);

    const applied = await runEncryptionRewrap(prisma, mixed, {
      apply: true,
      batchSize: 1,
      maxBatches: 10,
    });
    expect(applied).toMatchObject({
      mode: "apply",
      complete: true,
      needsRewrap: 5,
      rewrapped: 5,
      conflicts: 0,
      unreadable: 0,
      oldKeyUsage: { "shared-key": 5 },
    });
    for (const store of [
      prisma.webSession,
      prisma.webRefreshToken,
      prisma.telegramAuthState,
    ]) {
      expect(store.findMany.mock.calls.some(([query]) =>
        Boolean((query.where as { id?: { gt?: string } }).id?.gt)
      )).toBe(true);
      expect(store.findMany.mock.calls.every(([query]) =>
        !Object.hasOwn(query, "cursor") && !Object.hasOwn(query, "skip")
      )).toBe(true);
    }

    expect(decryptKeyringSecret(
      sessions[0].remnashopAccessTokenEncrypted!,
      keyB,
      encryptionRewrapPurposes.providerToken,
    ).value).toBe("provider-access");
    expect(decryptKeyringSecret(
      sessions[0].remnashopRefreshTokenEncrypted!,
      keyB,
      encryptionRewrapPurposes.providerToken,
    ).value).toBe("provider-refresh");
    expect(decryptKeyringSecret(
      sessions[0].remnashopRefreshRecoveryEncrypted!,
      keyB,
      encryptionRewrapPurposes.providerToken,
    ).value).toContain("recovery-access");
    expect(decryptKeyringSecret(
      successors[0].successorTokenEncrypted,
      keyB,
      encryptionRewrapPurposes.refreshSuccessor,
    ).value).toBe("lost-response-successor");
    expect(decryptKeyringSecret(
      callbacks[0].callbackResultEncrypted!,
      keyB,
      encryptionRewrapPurposes.telegramCallback,
    ).value).toContain("webSessionId");

    await expect(runEncryptionRewrap(prisma, keyB, {
      retirementCheck: true,
      batchSize: 1,
      maxBatches: 10,
    })).resolves.toMatchObject({
      mode: "report",
      complete: true,
      needsRewrap: 0,
      unreadable: 0,
      retirementReady: true,
    });
  });

  it("does not report false retirement when a same-id secret was changed without the old key", async () => {
    const keyA = {
      primary: {
        id: "primary",
        secret: "synthetic-rotation-secret-A-4Vr8Nm2Kq7Xs5Lp9", // gitleaks:allow -- synthetic test credential
      },
      previous: [],
    };
    const keyB = {
      primary: {
        id: "primary",
        secret: "synthetic-rotation-secret-B-9Kq3Xs7Vr5Nm2Lp8", // gitleaks:allow -- synthetic test credential
      },
      previous: [],
    };
    const encrypted = encryptKeyringSecret(
      "provider-access",
      keyA,
      encryptionRewrapPurposes.providerToken,
    );
    const row = {
      id: "same-id-old-binding",
      remnashopAccessTokenEncrypted: encrypted,
      remnashopRefreshTokenEncrypted: null,
      remnashopRefreshRecoveryEncrypted: null,
    };
    const prisma = {
      webSession: {
        findMany: vi.fn(async (query: {
          where: { OR: Array<{ remnashopAccessTokenEncrypted?: { not: { startsWith: string } } }> };
        }) => {
          const currentPrefix = query.where.OR[0]
            ?.remnashopAccessTokenEncrypted?.not.startsWith;
          return currentPrefix && !encrypted.startsWith(currentPrefix) ? [row] : [];
        }),
        updateMany: vi.fn(),
      },
      webRefreshToken: { findMany: vi.fn(async () => []), updateMany: vi.fn() },
      telegramAuthState: { findMany: vi.fn(async () => []), updateMany: vi.fn() },
    };

    await expect(runEncryptionRewrap(prisma, keyB, {
      batchSize: 10,
      maxBatches: 2,
    })).resolves.toMatchObject({
      complete: true,
      scannedRows: 1,
      scannedCiphertexts: 1,
      needsRewrap: 0,
      unreadable: 1,
      retirementReady: false,
    });
  });

  it("decrypts current envelopes during strict retirement checks and fails closed on corruption", async () => {
    const keyring = {
      primary: {
        id: "current-key",
        secret: "synthetic-current-secret-4Vr8Nm2Kq7Xs5Lp9",
      },
      previous: [],
    };
    const envelope = encryptKeyringSecret(
      "provider-access",
      keyring,
      encryptionRewrapPurposes.providerToken,
    );
    const parts = envelope.split(".");
    parts[4] = `${parts[4]![0] === "A" ? "B" : "A"}${parts[4]!.slice(1)}`;
    const corrupted = parts.join(".");
    const row = {
      id: "corrupted-current-envelope",
      remnashopAccessTokenEncrypted: corrupted,
      remnashopRefreshTokenEncrypted: null,
      remnashopRefreshRecoveryEncrypted: null,
    };
    const prisma = {
      webSession: {
        findMany: vi.fn(async (query: { where?: unknown }) =>
          scansCurrentEnvelopes(query.where) ? [row] : []),
        updateMany: vi.fn(),
      },
      webRefreshToken: { findMany: vi.fn(async () => []), updateMany: vi.fn() },
      telegramAuthState: { findMany: vi.fn(async () => []), updateMany: vi.fn() },
    };

    const ordinaryReport = await runEncryptionRewrap(prisma, keyring, {
      batchSize: 10,
      maxBatches: 2,
    });
    expect(ordinaryReport).toMatchObject({
      scannedRows: 0,
      unreadable: 0,
      retirementReady: false,
    });

    const retirementReport = await runEncryptionRewrap(prisma, keyring, {
      retirementCheck: true,
      batchSize: 10,
      maxBatches: 2,
    });
    expect(retirementReport).toMatchObject({
      complete: true,
      scannedRows: 1,
      scannedCiphertexts: 1,
      needsRewrap: 0,
      unreadable: 1,
      retirementReady: false,
    });
    expect(encryptionRewrapExitCode(
      retirementReport,
      { retirementCheck: true },
    )).toBe(1);
    expect(prisma.webSession.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          OR: expect.arrayContaining([
            { remnashopAccessTokenEncrypted: { not: null } },
          ]),
        },
      }),
    );
  });

  it("reports a lost CAS instead of overwriting a concurrently changed ciphertext", async () => {
    const keyA = {
      primary: {
        id: "shared-key",
        secret: "synthetic-rotation-secret-A-4Vr8Nm2Kq7Xs5Lp9", // gitleaks:allow -- synthetic test credential
      },
      previous: [],
    };
    const mixed = {
      primary: {
        id: "shared-key",
        secret: "synthetic-rotation-secret-B-9Kq3Xs7Vr5Nm2Lp8", // gitleaks:allow -- synthetic test credential
      },
      previous: [keyA.primary],
    };
    const encrypted = encryptKeyringSecret(
      "provider-access",
      keyA,
      encryptionRewrapPurposes.providerToken,
    );
    const row = {
      id: "cas-conflict",
      remnashopAccessTokenEncrypted: encrypted,
      remnashopRefreshTokenEncrypted: null,
      remnashopRefreshRecoveryEncrypted: null,
    };
    const prisma = {
      webSession: {
        findMany: vi.fn(async () => [row]),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      webRefreshToken: { findMany: vi.fn(async () => []), updateMany: vi.fn() },
      telegramAuthState: { findMany: vi.fn(async () => []), updateMany: vi.fn() },
    };

    await expect(runEncryptionRewrap(prisma, mixed, {
      apply: true,
      batchSize: 10,
      maxBatches: 2,
    })).resolves.toMatchObject({
      complete: true,
      needsRewrap: 1,
      rewrapped: 0,
      conflicts: 1,
      unreadable: 0,
    });
    expect(row.remnashopAccessTokenEncrypted).toBe(encrypted);
    expect(prisma.webSession.updateMany).toHaveBeenCalledWith({
      where: { id: row.id, remnashopAccessTokenEncrypted: encrypted },
      data: {
        remnashopAccessTokenEncrypted: expect.stringMatching(
          /^v2\.shared-key\.[A-Za-z0-9_-]{22}\./,
        ),
      },
    });
  });

  it("parses explicit bounded modes and makes retirement checks fail closed", () => {
    expect(encryptionKeyringFromEnvironment({
      NODE_ENV: "test",
      WEB_REFRESH_KEY_ID: "shared-key",
      WEB_REFRESH_SECRET: "synthetic-rotation-secret-B-9Kq3Xs7Vr5Nm2Lp8", // gitleaks:allow -- synthetic test credential
      WEB_REFRESH_PREVIOUS_KEYS: JSON.stringify({
        "shared-key": "synthetic-rotation-secret-A-4Vr8Nm2Kq7Xs5Lp9", // gitleaks:allow -- synthetic test credential
      }),
    })).toMatchObject({
      primary: { id: "shared-key" },
      previous: [{ id: "shared-key" }],
    });
    expect(parseEncryptionRewrapArguments([])).toEqual({
      apply: false,
      retirementCheck: false,
      batchSize: 100,
      maxBatches: 10,
    });
    expect(parseEncryptionRewrapArguments([
      "--apply",
      "--batch-size=25",
      "--max-batches=4",
    ])).toEqual({
      apply: true,
      retirementCheck: false,
      batchSize: 25,
      maxBatches: 4,
    });
    expect(parseEncryptionRewrapArguments(["--retirement-check"]))
      .toMatchObject({ apply: false, retirementCheck: true });
    expect(() => parseEncryptionRewrapArguments([
      "--apply",
      "--dry-run",
    ])).toThrow("Select exactly one");

    const ready = {
      complete: true,
      needsRewrap: 0,
      unreadable: 0,
      conflicts: 0,
      retirementReady: true,
    };
    expect(encryptionRewrapExitCode(ready, { retirementCheck: true })).toBe(0);
    for (const blocked of [
      { ...ready, complete: false, retirementReady: false },
      { ...ready, needsRewrap: 1, retirementReady: false },
      { ...ready, unreadable: 1, retirementReady: false },
      { ...ready, conflicts: 1, retirementReady: false },
    ]) {
      expect(encryptionRewrapExitCode(blocked, { retirementCheck: true })).toBe(1);
    }
    expect(encryptionRewrapExitCode(
      { ...ready, complete: false, retirementReady: false },
      { retirementCheck: false },
    )).toBe(0);
  });
});

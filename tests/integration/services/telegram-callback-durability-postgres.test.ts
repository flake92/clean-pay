import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "user-agent": "durable-pg-test" })),
  cookies: vi.fn(async () => ({
    get: () => undefined,
    set: () => undefined,
    delete: () => undefined,
  })),
}));

const realDatabaseUrl = process.env.REAL_DATABASE_URL;
const describeWithPostgres = realDatabaseUrl ? describe : describe.skip;

describeWithPostgres("durable Telegram callback PostgreSQL fault markers", () => {
  let prisma: typeof import("@/backend/database/prisma")["prisma"];
  let durable: typeof import("@/backend/integrations/telegram/durable-callback");
  let protectRemnashopToken: typeof import("@/backend/integrations/remnashop/token-protection")["protectRemnashopToken"];
  let recoverRemnashopTelegramSession: typeof import("@/backend/integrations/remnashop/session-authorization")["recoverRemnashopTelegramSession"];
  let getTelegramAccountMergeConfirmation: typeof import("@/backend/integrations/auth/telegram-account-merge-store")["getTelegramAccountMergeConfirmation"];
  const userIds: string[] = [];
  const authStateIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = realDatabaseUrl as string;
    vi.stubEnv(
      "WEB_REFRESH_SECRET",
      "telegram-callback-postgres-key-7Vr3Nm8Wp2Kq5Xs9",
    );
    vi.stubEnv("WEB_REFRESH_KEY_ID", "callback-pg");
    delete (globalThis as typeof globalThis & { prisma?: unknown }).prisma;
    ({ prisma } = await import("@/backend/database/prisma"));
    durable = await import(
      "@/backend/integrations/telegram/durable-callback"
    );
    ({ protectRemnashopToken } = await import(
      "@/backend/integrations/remnashop/token-protection"
    ));
    ({ recoverRemnashopTelegramSession } = await import(
      "@/backend/integrations/remnashop/session-authorization"
    ));
    ({ getTelegramAccountMergeConfirmation } = await import(
      "@/backend/integrations/auth/telegram-account-merge-store"
    ));
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.telegramAuthState.deleteMany({
        where: { id: { in: authStateIds } },
      });
      await prisma.webUser.deleteMany({ where: { id: { in: userIds } } });
      await prisma.$disconnect();
    }
    vi.unstubAllEnvs();
  });

  it("rolls back losing sessions, fences leases and replays one exact bootstrap", async () => {
    const base = new Date();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const state = `state-${suffix}`;
    const nonce = `nonce-${suffix}`;
    const verifier = `verifier-${suffix}`;
    const code = `code-${suffix}`;
    const { sha256 } = await import("@/backend/security/crypto");
    const proof = {
      stateHash: sha256(state),
      nonceHash: sha256(nonce),
      codeVerifierHash: sha256(verifier),
    };
    const user = await prisma.webUser.create({
      data: {
        email: `durable-callback-${suffix}@example.test`,
        emailVerified: true,
        telegramId: `77${Date.now().toString().slice(-8)}`,
      },
    });
    userIds.push(user.id);
    const authState = await prisma.telegramAuthState.create({
      data: {
        ...proof,
        redirectTo: "/cabinet",
        expiresAt: new Date(base.getTime() + 10 * 60_000),
      },
    });
    authStateIds.push(authState.id);
    const verified = {
      authState: {
        id: authState.id,
        targetUserId: null,
        redirectTo: "/cabinet",
      },
      identity: {
        telegramId: user.telegramId!,
        telegramUsername: "durable_pg",
        fullName: "Durable PG",
        photoUrl: null,
        providerSession: null,
      },
    };
    const consumed = {
      user: {
        id: user.id,
        upstreamAccountId: null,
        email: user.email,
        emailVerified: true,
        telegramId: user.telegramId,
      },
      redirectTo: "/cabinet",
      providerSession: null,
      linked: false,
      telegramId: user.telegramId!,
      telegramUsername: "durable_pg",
      mergeConfirmation: null,
    };
    const outcome = {
      redirectTo: "/cabinet",
      session: { userId: user.id, requiresTelegramRecovery: true },
      audit: { userId: user.id, remnashopLinked: false },
    };

    const ownership = await durable.claimDurableTelegramProviderReady({
      authState,
      proof,
      codeHash: sha256(code),
      now: base,
    });
    const phases = [
      (await prisma.telegramAuthState.findUniqueOrThrow({
        where: { id: authState.id },
      })).callbackStatus,
    ];
    await durable.markDurableTelegramProviderDispatching(
      ownership,
      verified.authState,
      base,
    );
    phases.push((await prisma.telegramAuthState.findUniqueOrThrow({
      where: { id: authState.id },
    })).callbackStatus);
    await durable.checkpointDurableTelegramIdentity(ownership, verified, base);
    await durable.markDurableTelegramRemnashopDispatching(
      ownership,
      verified,
      base,
    );
    phases.push((await prisma.telegramAuthState.findUniqueOrThrow({
      where: { id: authState.id },
    })).callbackStatus);
    await durable.checkpointDurableTelegramProvider(ownership, verified, base);

    const leaseBefore = (await prisma.telegramAuthState.findUniqueOrThrow({
      where: { id: authState.id },
    })).callbackLeaseExpiresAt!;
    await durable.runWithDurableTelegramCallbackLease(
      ownership,
      "PROVIDER_AUTHENTICATED",
      () => new Promise<void>((resolve) => setTimeout(resolve, 25)),
      { heartbeatMs: 5 },
    );
    const leaseAfter = (await prisma.telegramAuthState.findUniqueOrThrow({
      where: { id: authState.id },
    })).callbackLeaseExpiresAt!;
    expect(leaseAfter.getTime()).toBeGreaterThanOrEqual(leaseBefore.getTime());

    await durable.checkpointDurableTelegramIdentityResolved(
      ownership,
      consumed,
      base,
    );
    await durable.checkpointDurableTelegramOutcome(ownership, outcome, base);
    phases.push((await prisma.telegramAuthState.findUniqueOrThrow({
      where: { id: authState.id },
    })).callbackStatus);
    expect(phases).toEqual([
      "PROVIDER_READY",
      "PROVIDER_DISPATCHING",
      "REMNASHOP_DISPATCHING",
      "OUTCOME_READY",
    ]);

    const sessionCreatedAt = new Date(
      base.getTime() + 19 * 60_000 + 58_000,
    );
    const attempts = await Promise.allSettled([
      durable.createDurableTelegramCallbackSession(
        ownership,
        outcome,
        sessionCreatedAt,
      ),
      durable.createDurableTelegramCallbackSession(
        ownership,
        outcome,
        sessionCreatedAt,
      ),
    ]);
    const fulfilled = attempts.filter(
      (item): item is PromiseFulfilledResult<
        Awaited<ReturnType<typeof durable.createDurableTelegramCallbackSession>>
      > => item.status === "fulfilled",
    );
    expect(fulfilled).toHaveLength(1);
    expect(attempts.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect(await prisma.webSession.count({ where: { userId: user.id } })).toBe(1);

    const replay = fulfilled[0]!.value.replay;
    expect(replay.session?.bootstrapRefreshToken).toEqual(expect.any(String));
    const exactSessionId = replay.session!.webSessionId;
    await prisma.webSession.update({
      where: { id: exactSessionId },
      data: {
        remnashopAccessTokenEncrypted: protectRemnashopToken("stored-access"),
        remnashopRefreshTokenEncrypted: protectRemnashopToken("stored-refresh"),
        remnashopAccessExpiresAt: new Date(base.getTime() + 30 * 60_000),
        remnashopRefreshExpiresAt: new Date(base.getTime() + 60 * 60_000),
      },
    });
    const providerRecovery = vi.fn();
    await expect(recoverRemnashopTelegramSession(
      exactSessionId,
      user.id,
      providerRecovery,
    )).resolves.toMatchObject({
      accessToken: "stored-access",
      refreshToken: "stored-refresh",
    });
    expect(providerRecovery).not.toHaveBeenCalled();

    // Simulate a crash after the recovery transaction committed its exact
    // token bundle but before the callback checkpoint advanced. The durable
    // dispatch marker can prove the commit from this WebSession and must not
    // call the provider again.
    await durable.markDurableTelegramRecoveryDispatching(
      ownership,
      replay,
      sessionCreatedAt,
    );

    await prisma.telegramAuthState.update({
      where: { id: authState.id },
      data: { callbackLeaseExpiresAt: new Date(sessionCreatedAt.getTime() - 1) },
    });
    const resumeAt = new Date(sessionCreatedAt.getTime() + 1);
    const resumes = await Promise.all([
      durable.loadDurableTelegramCallback(state, code, proof, resumeAt),
      durable.loadDurableTelegramCallback(state, code, proof, resumeAt),
    ]);
    expect(resumes.map(({ status }) => status).sort()).toEqual([
      "processing",
      "resume",
    ]);
    const resume = resumes.find((item) => item.status === "resume");
    expect(resume).toMatchObject({
      status: "resume",
      checkpoint: {
        phase: "SESSION_CREATED",
        replay: {
          session: {
            webSessionId: exactSessionId,
            requiresTelegramRecovery: false,
          },
        },
      },
    });
    if (!resume || resume.status !== "resume") {
      throw new Error("Expected one PostgreSQL callback lease winner");
    }

    // Complete one second before the absolute in-flight deadline. Completion
    // atomically renews access for 15 minutes, leaving the entire 10-minute
    // lost-response replay tail usable without rotating the bootstrap token.
    const completedAt = new Date(base.getTime() + 19 * 60_000 + 59_000);
    await durable.completeDurableTelegramSession(
      resume.ownership,
      resume.checkpoint.phase === "SESSION_CREATED"
        ? resume.checkpoint.replay
        : replay,
      completedAt,
    );
    await expect(durable.loadDurableTelegramCallback(
      state,
      code,
      proof,
      new Date(base.getTime() + 29 * 60_000 + 58_000),
    )).resolves.toMatchObject({
      status: "completed",
      outcome: {
        session: {
          webSessionId: exactSessionId,
          bootstrapRefreshToken: replay.session!.bootstrapRefreshToken,
        },
      },
    });
    await expect(durable.loadDurableTelegramCallback(
      state,
      code,
      { ...proof, nonceHash: sha256("attacker-nonce") },
      new Date(base.getTime() + 29 * 60_000 + 58_000),
    )).resolves.toEqual({ status: "none" });
    expect(await prisma.webSession.count({ where: { userId: user.id } })).toBe(1);
    const replayableSession = await prisma.webSession.findUniqueOrThrow({
      where: { id: exactSessionId },
    });
    expect(replayableSession.accessTokenExpiresAt.getTime()).toBe(
      completedAt.getTime() + 15 * 60_000,
    );

    await prisma.telegramAuthState.update({
      where: { id: authState.id },
      data: {
        callbackResultExpiresAt: new Date(base.getTime() - 1),
      },
    });
    await expect(durable.loadDurableTelegramCallback(
      state,
      code,
      proof,
      base,
    )).resolves.toMatchObject({ status: "failed" });
    const scrubbed = await prisma.telegramAuthState.findUniqueOrThrow({
      where: { id: authState.id },
    });
    expect(scrubbed.callbackResultEncrypted).toBeNull();
    expect(scrubbed.callbackClaimTokenHash).toBeNull();
    expect(scrubbed.callbackLeaseExpiresAt).toBeNull();
  }, 60_000);

  it("keeps the exact merge confirmation usable through a late replay cookie", async () => {
    const base = new Date();
    const suffix = `merge-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const { sha256 } = await import("@/backend/security/crypto");
    const state = `state-${suffix}`;
    const code = `code-${suffix}`;
    const proof = {
      stateHash: sha256(state),
      nonceHash: sha256(`nonce-${suffix}`),
      codeVerifierHash: sha256(`verifier-${suffix}`),
    };
    const user = await prisma.webUser.create({
      data: {
        email: `${suffix}@example.test`,
        emailVerified: true,
        telegramId: `88${Date.now().toString().slice(-8)}`,
      },
    });
    userIds.push(user.id);
    const authState = await prisma.telegramAuthState.create({
      data: {
        ...proof,
        redirectTo: "/link-account",
        expiresAt: new Date(base.getTime() + 10 * 60_000),
      },
    });
    authStateIds.push(authState.id);
    const mergeToken = `merge-token-${suffix}`;
    await prisma.accountMergeConfirmation.create({
      data: {
        userId: user.id,
        tokenHash: sha256(mergeToken),
        telegramId: user.telegramId!,
        sourceEmail: user.email,
        targetEmail: user.email!,
        sourceRemnashopUserId: `source-${suffix}`,
        targetRemnashopUserId: `target-${suffix}`,
        expiresAt: new Date(base.getTime() + 60_000),
      },
    });
    const verified = {
      authState: {
        id: authState.id,
        targetUserId: null,
        redirectTo: "/link-account",
      },
      identity: {
        telegramId: user.telegramId!,
        telegramUsername: "durable_merge_pg",
        fullName: "Durable Merge PG",
        photoUrl: null,
        providerSession: null,
      },
    };
    const consumed = {
      user: {
        id: user.id,
        upstreamAccountId: null,
        email: user.email,
        emailVerified: true,
        telegramId: user.telegramId,
      },
      redirectTo: "/link-account",
      providerSession: null,
      linked: false,
      telegramId: user.telegramId!,
      telegramUsername: "durable_merge_pg",
      mergeConfirmation: { required: true, token: mergeToken },
    };
    const outcome = {
      redirectTo: "/link-account",
      mergeConfirmation: { token: mergeToken },
      audit: { userId: user.id, remnashopLinked: false },
    };
    const ownership = await durable.claimDurableTelegramProviderReady({
      authState,
      proof,
      codeHash: sha256(code),
      now: base,
    });
    await durable.markDurableTelegramProviderDispatching(
      ownership,
      verified.authState,
      base,
    );
    await durable.checkpointDurableTelegramIdentity(ownership, verified, base);
    await durable.markDurableTelegramRemnashopDispatching(
      ownership,
      verified,
      base,
    );
    await durable.checkpointDurableTelegramProvider(ownership, verified, base);
    await durable.checkpointDurableTelegramIdentityResolved(
      ownership,
      consumed,
      base,
    );
    await durable.checkpointDurableTelegramOutcome(ownership, outcome, base);

    const completedAt = new Date(base.getTime() + 19 * 60_000 + 59_000);
    await durable.completeDurableTelegramMerge(ownership, outcome, completedAt);

    const lastReplayAt = new Date(base.getTime() + 29 * 60_000 + 58_000);
    await expect(durable.loadDurableTelegramCallback(
      state,
      code,
      proof,
      lastReplayAt,
    )).resolves.toMatchObject({
      status: "completed",
      outcome: { mergeConfirmation: { token: mergeToken } },
    });
    const confirmation = await getTelegramAccountMergeConfirmation(
      mergeToken,
      user.id,
    );
    expect(confirmation.expiresAt.getTime()).toBe(
      completedAt.getTime() + 20 * 60_000,
    );
    expect(confirmation.expiresAt.getTime() - lastReplayAt.getTime())
      .toBeGreaterThanOrEqual(10 * 60_000);
  }, 60_000);
});

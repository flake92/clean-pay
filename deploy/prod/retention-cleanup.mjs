const DAY_MS = 24 * 60 * 60 * 1_000;

function boundedDays(env, name, fallback, min, max) {
  const raw = env[name]?.trim();

  if (!raw) return fallback;

  const value = Number(raw);

  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }

  return value;
}

export function retentionPolicy(env = process.env) {
  const policy = {
    authStateDays: boundedDays(env, "AUTH_STATE_RETENTION_DAYS", 7, 1, 30),
    sessionDays: boundedDays(env, "SESSION_RETENTION_DAYS", 90, 30, 365),
    auditInfoDays: boundedDays(env, "AUDIT_INFO_RETENTION_DAYS", 180, 30, 730),
    auditSecurityDays: boundedDays(env, "AUDIT_SECURITY_RETENTION_DAYS", 365, 90, 2_555),
    rateLimitDays: boundedDays(env, "RATE_LIMIT_RETENTION_DAYS", 30, 1, 180),
  };

  if (policy.auditSecurityDays < policy.auditInfoDays) {
    throw new Error("AUDIT_SECURITY_RETENTION_DAYS must be at least AUDIT_INFO_RETENTION_DAYS");
  }

  return policy;
}

function before(now, days) {
  return new Date(now.getTime() - days * DAY_MS);
}

export async function runRetentionCleanup(prisma, policy, now = new Date()) {
  const authCutoff = before(now, policy.authStateDays);
  const sessionCutoff = before(now, policy.sessionDays);
  const auditInfoCutoff = before(now, policy.auditInfoDays);
  const auditSecurityCutoff = before(now, policy.auditSecurityDays);
  const rateLimitCutoff = before(now, policy.rateLimitDays);

  const results = {};
  results.webAuthnChallenges = (await prisma.webAuthnChallenge.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: authCutoff } },
        { consumedAt: { not: null, lt: authCutoff } },
      ],
    },
  })).count;
  results.telegramAuthStates = (await prisma.telegramAuthState.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: authCutoff } },
        { consumedAt: { not: null, lt: authCutoff } },
      ],
    },
  })).count;
  results.emailVerificationCodes = (await prisma.emailVerificationCode.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: authCutoff } },
        { consumedAt: { not: null, lt: authCutoff } },
      ],
    },
  })).count;
  results.accountMergeConfirmations = (await prisma.accountMergeConfirmation.deleteMany({
    where: { expiresAt: { lt: authCutoff } },
  })).count;
  results.webSessions = (await prisma.webSession.deleteMany({
    where: {
      OR: [
        { revokedAt: { not: null, lt: sessionCutoff } },
        { refreshExpiresAt: { lt: sessionCutoff } },
      ],
    },
  })).count;
  results.auditInfo = (await prisma.auditLog.deleteMany({
    where: { severity: "INFO", createdAt: { lt: auditInfoCutoff } },
  })).count;
  results.auditSecurity = (await prisma.auditLog.deleteMany({
    where: {
      severity: { in: ["WARN", "ERROR"] },
      createdAt: { lt: auditSecurityCutoff },
    },
  })).count;
  results.rateLimitEvents = (await prisma.rateLimitEvent.deleteMany({
    where: { occurredAt: { lt: rateLimitCutoff } },
  })).count;

  return results;
}

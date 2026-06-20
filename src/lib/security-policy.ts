export const securityPolicy = {
  emailVerificationCodeTtlMinutes: 15,
  emailVerificationMaxAttempts: 5,
  accessSessionTtlMinutes: 15,
  refreshSessionTtlDays: 30,
} as const;

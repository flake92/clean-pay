export const PROVIDER_SESSION_RECOVERY_REQUIRED =
  "PROVIDER_SESSION_RECOVERY_REQUIRED" as const;

export function isProviderSessionRecoveryRequired(error: unknown) {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === PROVIDER_SESSION_RECOVERY_REQUIRED,
  );
}

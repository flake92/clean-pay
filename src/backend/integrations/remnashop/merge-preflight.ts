import type { RemnashopMergeUsersResponse } from "@/backend/integrations/remnashop/api-client";

/** Both the Telegram callback gateway and the account-merge gateway report the
 * same merge preflight to their application ports. Normalizing the upstream DTO
 * here keeps the two call sites from disagreeing about identifier coercion or
 * field naming, and keeps normalization out of the HTTP transport module. */
export function normalizeRemnashopMergePreflight(
  result: RemnashopMergeUsersResponse,
) {
  return {
    conflicts: result.conflicts,
    dryRun: result.dry_run,
    sourceAccountId: String(result.source_user_id),
    targetAccountId: String(result.target_user_id),
    target: {
      accountId: String(result.target.id),
      email: result.target.email,
      emailVerified: result.target.is_email_verified,
      telegramId: result.target.telegram_id === null
        ? null
        : String(result.target.telegram_id),
    },
    requiresRelogin: result.requires_relogin,
  };
}

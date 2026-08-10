import { ServiceError } from "@/backend/errors/service-error";
import { accountAccessIssue } from "@/shared/domain/account-access-policy";

export const refreshTokenGraceMs = 10_000;

export function assertEmailVerificationPolicy(
  user: {
    email?: string | null;
    emailVerified: boolean;
    telegramId: string | null;
  },
  { requireVerifiedEmail = false }: { requireVerifiedEmail?: boolean } = {},
) {
  const issue = accountAccessIssue(user, { requireVerifiedEmail });
  if (issue === "EMAIL_REQUIRED") {
    throw new ServiceError(
      issue,
      401,
      "E-mail and password must be linked before continuing",
    );
  }
  if (issue) {
    throw new ServiceError(
      issue,
      403,
      "E-mail must be verified before continuing",
    );
  }
}

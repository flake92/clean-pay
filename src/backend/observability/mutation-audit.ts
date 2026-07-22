import { BffError } from "@/backend/integrations/remnashop/errors";
import { auditLog } from "@/backend/observability/audit";

type MutationAuditInput<T> = {
  action: string;
  userId: string;
  metadata?: Record<string, unknown>;
  mutate: () => Promise<T>;
};

function failureMetadata(error: unknown) {
  if (error instanceof BffError) {
    return {
      errorCode: error.code,
      errorStatus: error.status,
    };
  }

  return { errorCode: "UNEXPECTED_ERROR" };
}

export async function auditedMutation<T>({
  action,
  userId,
  metadata = {},
  mutate,
}: MutationAuditInput<T>) {
  await auditLog({
    action: `${action}_attempted`,
    userId,
    metadata,
  });

  try {
    const result = await mutate();

    await auditLog({
      action: `${action}_succeeded`,
      userId,
      metadata,
    });

    return result;
  } catch (error) {
    await auditLog({
      action: `${action}_failed`,
      userId,
      severity: "WARN",
      metadata: {
        ...metadata,
        ...failureMetadata(error),
      },
    });

    throw error;
  }
}

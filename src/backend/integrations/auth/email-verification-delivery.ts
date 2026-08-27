import { ServiceError } from "@/backend/errors/service-error";
import { remnashopValidatedRequest } from "@/backend/integrations/remnashop/api-client-runtime";
import type {
  RequestEmailVerificationRequest,
  RequestEmailVerificationResponse,
} from "@/backend/integrations/remnashop/contracts";
import { authDebugLog } from "@/backend/observability/auth-debug-log";

function transientDeliveryFailure(error: unknown) {
  return error instanceof ServiceError
    && error.code === "UPSTREAM_UNAVAILABLE"
    && String(error.debug?.message ?? error.message).toLowerCase().includes("failed to send verification email");
}

export async function requestRemnashopEmailVerification(input: {
  accessToken: string;
  body: RequestEmailVerificationRequest;
  source: string;
}) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await remnashopValidatedRequest<RequestEmailVerificationResponse>(
        "/auth/email/request-verification",
        {
          method: "POST",
          accessToken: input.accessToken,
          body: input.body,
        },
      );
    } catch (error) {
      if (!transientDeliveryFailure(error) || attempt === maxAttempts) throw error;
      authDebugLog("email_verification_request_retry_scheduled", {
        source: input.source,
        attempt,
        nextAttempt: attempt + 1,
        maxAttempts,
      });
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
  throw new ServiceError("UPSTREAM_UNAVAILABLE", 502, "Failed to send verification email");
}

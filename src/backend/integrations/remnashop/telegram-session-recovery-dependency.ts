import { ServiceError } from "@/backend/errors/service-error";
import type { getCurrentSession } from "@/backend/integrations/sessions/web-session-service";

export type CurrentRemnashopSession = NonNullable<
  Awaited<ReturnType<typeof getCurrentSession>>
>;

export type RemnashopTelegramRecoveryResult = {
  accessToken: string;
  refreshToken: string;
  session: CurrentRemnashopSession;
} | null;

export type RemnashopTelegramRecovery = (
  session: CurrentRemnashopSession,
) => Promise<RemnashopTelegramRecoveryResult>;

export async function missingRemnashopTelegramRecovery(): Promise<never> {
  throw new ServiceError(
    "INTERNAL_ERROR",
    500,
    "Remnashop Telegram recovery dependency was not supplied",
  );
}

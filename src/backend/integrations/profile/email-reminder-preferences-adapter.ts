import type { EmailReminderPreferenceViewModel } from "@/application/models/profile";
import {
  EmailReminderPreferenceGatewayError,
  type EmailReminderPreferenceActor,
  type EmailReminderPreferenceCommands,
  type EmailReminderPreferenceReader,
} from "@/application/profile/ports/email-reminder-preferences";
import { ServiceError } from "@/backend/errors/service-error";
import {
  getRemnashopNotificationPreferences,
  updateRemnashopNotificationPreferences,
} from "@/backend/integrations/remnashop/api-client";
import { getAuthorizedRemnashopTokens } from "@/backend/integrations/remnashop/session-authorization";
import { getStoredAuthorizedRemnashopTokens } from "@/backend/integrations/remnashop/stored-session-authorization";
import { assertRateLimit } from "@/backend/limits/rate-limit";
import { auditedMutation } from "@/backend/observability/mutation-audit";

type AuthorizedPreferenceSession = {
  accessToken: string;
  session: { id: string; userId: string };
};

type PreferenceAuthorizer = () => Promise<AuthorizedPreferenceSession>;

type PreferenceApi = {
  load(accessToken: string): Promise<unknown>;
  update(accessToken: string, enabled: boolean): Promise<unknown>;
};

const productionApi: PreferenceApi = {
  load: getRemnashopNotificationPreferences,
  update: (accessToken, enabled) => updateRemnashopNotificationPreferences(accessToken, {
    subscription_expiration_email_enabled: enabled,
  }),
};

function parsePreference(value: unknown): EmailReminderPreferenceViewModel {
  if (!value || typeof value !== "object") {
    throw new EmailReminderPreferenceGatewayError("UPSTREAM_UNAVAILABLE");
  }

  const candidate = value as Record<string, unknown>;
  const daysBefore = candidate.days_before;
  const senderEmail = candidate.sender_email;
  if (
    typeof candidate.subscription_expiration_email_enabled !== "boolean"
    || typeof candidate.email_eligible !== "boolean"
    || (senderEmail !== null && typeof senderEmail !== "string")
    || !Array.isArray(daysBefore)
    || daysBefore.length > 10
    || daysBefore.some((day) => !Number.isSafeInteger(day) || day < 1 || day > 365)
    || new Set(daysBefore).size !== daysBefore.length
  ) {
    throw new EmailReminderPreferenceGatewayError("UPSTREAM_UNAVAILABLE");
  }

  const normalizedSenderEmail = typeof senderEmail === "string" && senderEmail.trim()
    ? senderEmail
    : null;
  const normalizedDaysBefore = daysBefore as number[];

  return {
    enabled: candidate.subscription_expiration_email_enabled,
    emailEligible: candidate.email_eligible,
    senderEmail: normalizedSenderEmail,
    daysBefore: [...normalizedDaysBefore],
  };
}

function gatewayFailure(error: unknown): EmailReminderPreferenceGatewayError {
  if (error instanceof EmailReminderPreferenceGatewayError) return error;
  if (error instanceof ServiceError) {
    if (error.status === 401) return new EmailReminderPreferenceGatewayError("UNAUTHORIZED");
    if (error.code === "RATE_LIMITED") {
      return new EmailReminderPreferenceGatewayError("RATE_LIMITED");
    }
    if (error.code === "EMAIL_REQUIRED" || error.code === "EMAIL_NOT_VERIFIED") {
      return new EmailReminderPreferenceGatewayError(error.code);
    }
    if (error.code === "VALIDATION_ERROR") {
      return new EmailReminderPreferenceGatewayError("VALIDATION_ERROR");
    }
    return new EmailReminderPreferenceGatewayError("UPSTREAM_UNAVAILABLE");
  }
  return new EmailReminderPreferenceGatewayError("UPSTREAM_UNAVAILABLE");
}

function actorContext(actor: EmailReminderPreferenceActor) {
  return actor.context as AuthorizedPreferenceSession;
}

export function createEmailReminderPreferenceReader(
  authorize: PreferenceAuthorizer = () => getStoredAuthorizedRemnashopTokens({
    allowUnverifiedEmail: true,
  }),
  api: PreferenceApi = productionApi,
): EmailReminderPreferenceReader {
  return {
    async load() {
      try {
        const authorized = await authorize();
        return parsePreference(await api.load(authorized.accessToken));
      } catch (error) {
        throw gatewayFailure(error);
      }
    },
  };
}

export function createEmailReminderPreferenceCommands(
  authorize: PreferenceAuthorizer = () => getAuthorizedRemnashopTokens({
    allowUnverifiedEmail: true,
  }),
  api: PreferenceApi = productionApi,
): EmailReminderPreferenceCommands {
  return {
    async loadActor() {
      try {
        const authorized = await authorize();
        return {
          context: authorized,
          userId: authorized.session.userId,
        };
      } catch (error) {
        throw gatewayFailure(error);
      }
    },
    async assertRateLimit(actor) {
      try {
        await assertRateLimit({
          action: "email_reminder_preference",
          sessionId: actorContext(actor).session.id,
          limit: 10,
          windowSeconds: 15 * 60,
        });
      } catch (error) {
        throw gatewayFailure(error);
      }
    },
    async update(actor, enabled) {
      const authorized = actorContext(actor);
      try {
        return await auditedMutation({
          action: "email_reminder_preference",
          userId: actor.userId,
          metadata: { enabled },
          mutate: async () => parsePreference(
            await api.update(authorized.accessToken, enabled),
          ),
        });
      } catch (error) {
        throw gatewayFailure(error);
      }
    },
  };
}

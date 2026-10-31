import type {
  EmailUnsubscribeCategory,
  PushSubscriptionInput,
} from "@/application/models/notifications";
import {
  NotificationChannelGatewayError,
  type EmailUnsubscribeGateway,
  type NotificationFeedGateway,
  type PushActor,
  type PushSubscriptionCommands,
} from "@/application/notifications/ports/notification-channels";
import { ServiceError } from "@/backend/errors/service-error";
import {
  deleteRemnashopPushSubscription,
  fetchRemnashopFeedMedia,
  getRemnashopFeed,
  getRemnashopFeedUnread,
  markRemnashopFeedRead,
  getRemnashopPushKey,
  getRemnashopPushStatus,
  remnashopUnsubscribeEmail,
  saveRemnashopPushSubscription,
} from "@/backend/integrations/remnashop/api-client";
import { assertTargetRateLimit } from "@/backend/limits/rate-limit";
import { auditedMutation } from "@/backend/observability/mutation-audit";

type AuthorizedSession = {
  accessToken: string;
  session: { id: string; userId: string };
};

type Authorizer = () => Promise<AuthorizedSession>;

function gatewayFailure(error: unknown): NotificationChannelGatewayError {
  if (error instanceof NotificationChannelGatewayError) return error;
  if (error instanceof ServiceError) {
    if (error.status === 401) return new NotificationChannelGatewayError("UNAUTHORIZED");
    if (error.code === "RATE_LIMITED") return new NotificationChannelGatewayError("RATE_LIMITED");
    if (error.status === 409) return new NotificationChannelGatewayError("PUSH_DISABLED");
    if (error.status === 422) {
      return new NotificationChannelGatewayError("UNSUPPORTED_PUSH_SERVICE");
    }
    if (error.status === 400) return new NotificationChannelGatewayError("INVALID_TOKEN");
    if (error.status === 404) return new NotificationChannelGatewayError("NOT_FOUND");
  }
  return new NotificationChannelGatewayError("UPSTREAM_UNAVAILABLE");
}

function context(actor: PushActor) {
  return actor.context as AuthorizedSession;
}

export function createPushSubscriptionCommands(authorize: Authorizer): PushSubscriptionCommands {
  return {
    async loadActor() {
      try {
        const authorized = await authorize();
        return { context: authorized, userId: authorized.session.userId };
      } catch (error) {
        throw gatewayFailure(error);
      }
    },
    async assertRateLimit(actor) {
      try {
        await assertTargetRateLimit({
          action: "push_subscription",
          sessionId: context(actor).session.id,
          limit: 20,
          windowSeconds: 15 * 60,
        });
      } catch (error) {
        throw gatewayFailure(error);
      }
    },
    async publicKey() {
      try {
        const key = await getRemnashopPushKey();
        return key.enabled ? key.public_key : null;
      } catch (error) {
        throw gatewayFailure(error);
      }
    },
    async devices(actor) {
      try {
        return (await getRemnashopPushStatus(context(actor).accessToken)).devices;
      } catch (error) {
        throw gatewayFailure(error);
      }
    },
    async save(actor, input: PushSubscriptionInput) {
      try {
        return await auditedMutation({
          action: "push_subscription",
          userId: actor.userId,
          metadata: { operation: "save" },
          mutate: async () => (await saveRemnashopPushSubscription(context(actor).accessToken, {
            endpoint: input.endpoint,
            keys: { p256dh: input.p256dh, auth: input.auth },
            ...(input.userAgent ? { user_agent: input.userAgent } : {}),
          })).devices,
        });
      } catch (error) {
        throw gatewayFailure(error);
      }
    },
    async remove(actor, endpoint) {
      try {
        return await auditedMutation({
          action: "push_subscription",
          userId: actor.userId,
          metadata: { operation: "remove" },
          mutate: async () => (
            await deleteRemnashopPushSubscription(context(actor).accessToken, endpoint)
          ).devices,
        });
      } catch (error) {
        throw gatewayFailure(error);
      }
    },
  };
}

export function createNotificationFeedGateway(authorize: Authorizer): NotificationFeedGateway {
  async function guarded<T>(work: () => Promise<T>) {
    try {
      return await work();
    } catch (error) {
      throw gatewayFailure(error);
    }
  }

  return {
    loadActor: () => guarded(async () => {
      const authorized = await authorize();
      return { context: authorized, userId: authorized.session.userId };
    }),
    page: (actor, beforeId) => guarded(async () => {
      const page = await getRemnashopFeed(context(actor).accessToken, beforeId);
      return {
        items: page.items.map((item) => ({
          id: item.id,
          category: item.category,
          html: item.text_html,
          buttons: item.buttons,
          mediaType: item.media_type,
          createdAt: item.created_at,
          read: item.read,
        })),
        unreadCount: page.unread_count,
        nextBeforeId: page.next_before_id,
      };
    }),
    unread: (actor) => guarded(async () => (
      await getRemnashopFeedUnread(context(actor).accessToken)
    ).unread_count),
    markRead: (actor, upToId) => guarded(async () => (
      await markRemnashopFeedRead(context(actor).accessToken, upToId)
    ).unread_count),
    media: (actor, itemId) => guarded(async () => {
      const response = await fetchRemnashopFeedMedia(context(actor).accessToken, itemId);
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new NotificationChannelGatewayError(
          response.status === 404 ? "NOT_FOUND" : "UPSTREAM_UNAVAILABLE",
        );
      }
      return {
        body: response.body,
        contentType: response.headers.get("content-type") ?? "application/octet-stream",
      };
    }),
  };
}

export function createEmailUnsubscribeGateway(): EmailUnsubscribeGateway {
  return {
    async unsubscribe(token): Promise<EmailUnsubscribeCategory> {
      try {
        const result = await remnashopUnsubscribeEmail(token);
        return result.category === "NEWS" ? "news" : "service";
      } catch (error) {
        throw gatewayFailure(error);
      }
    },
  };
}

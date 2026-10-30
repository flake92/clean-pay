import type {
  PushCommandResult,
  PushSetupViewModel,
  PushSubscriptionInput,
} from "@/application/models/notifications";
import {
  NotificationChannelGatewayError,
  type PushSubscriptionCommands,
} from "@/application/notifications/ports/notification-channels";

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

function failure(error: unknown): PushCommandResult {
  const code = error instanceof NotificationChannelGatewayError ? error.code : "INTERNAL_ERROR";
  const messages: Record<string, string> = {
    PUSH_DISABLED: "Push-уведомления на сервере пока не настроены.",
    RATE_LIMITED: "Слишком много изменений. Попробуйте позже.",
    UNAUTHORIZED: "Сессия истекла. Войдите снова.",
    UNSUPPORTED_PUSH_SERVICE: "Этот браузер использует неподдерживаемый сервис уведомлений.",
    VALIDATION_ERROR: "Браузер вернул некорректную подписку на уведомления.",
  };
  return {
    ok: false,
    code,
    message: messages[code] ?? "Не удалось изменить уведомления. Попробуйте позже.",
  };
}

export function parsePushSubscriptionInput(value: unknown): PushSubscriptionInput | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const { endpoint, p256dh, auth, userAgent } = candidate;
  if (
    typeof endpoint !== "string"
    || endpoint.length < 12
    || endpoint.length > 2048
    || !endpoint.startsWith("https://")
    || typeof p256dh !== "string"
    || p256dh.length < 80
    || p256dh.length > 128
    || !BASE64URL.test(p256dh)
    || typeof auth !== "string"
    || auth.length < 16
    || auth.length > 64
    || !BASE64URL.test(auth)
    || (userAgent !== null && userAgent !== undefined && typeof userAgent !== "string")
  ) {
    return null;
  }
  return {
    endpoint,
    p256dh,
    auth,
    userAgent: typeof userAgent === "string" ? userAgent.slice(0, 256) : null,
  };
}

export async function loadPushSetup(
  commands: PushSubscriptionCommands,
): Promise<PushSetupViewModel> {
  try {
    const actor = await commands.loadActor();
    const [publicKey, devices] = await Promise.all([
      commands.publicKey(),
      commands.devices(actor),
    ]);
    return publicKey ? { status: "ready", publicKey, devices } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

export async function savePushSubscription(
  commands: PushSubscriptionCommands,
  value: unknown,
): Promise<PushCommandResult> {
  const input = parsePushSubscriptionInput(value);
  if (!input) return failure(new NotificationChannelGatewayError("VALIDATION_ERROR"));
  try {
    const actor = await commands.loadActor();
    await commands.assertRateLimit(actor);
    const devices = await commands.save(actor, input);
    return { ok: true, devices, message: "Уведомления на этом устройстве включены." };
  } catch (error) {
    return failure(error);
  }
}

export async function removePushSubscription(
  commands: PushSubscriptionCommands,
  endpoint: unknown,
): Promise<PushCommandResult> {
  if (typeof endpoint !== "string" || endpoint.length < 12 || endpoint.length > 2048) {
    return failure(new NotificationChannelGatewayError("VALIDATION_ERROR"));
  }
  try {
    const actor = await commands.loadActor();
    await commands.assertRateLimit(actor);
    const devices = await commands.remove(actor, endpoint);
    return { ok: true, devices, message: "Уведомления на этом устройстве отключены." };
  } catch (error) {
    return failure(error);
  }
}

import type {
  NotificationFeedResult,
  NotificationMediaResult,
} from "@/application/models/notifications";
import {
  NotificationChannelGatewayError,
  type NotificationFeedGateway,
} from "@/application/notifications/ports/notification-channels";

function positiveId(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function failureCode(error: unknown) {
  return error instanceof NotificationChannelGatewayError ? error.code : "INTERNAL_ERROR";
}

export async function loadNotificationFeed(
  gateway: NotificationFeedGateway,
  beforeId?: unknown,
): Promise<NotificationFeedResult> {
  try {
    const actor = await gateway.loadActor();
    return { ok: true, page: await gateway.page(actor, positiveId(beforeId) ?? undefined) };
  } catch (error) {
    return { ok: false, code: failureCode(error) };
  }
}

// The badge is decoration: any failure simply shows no count.
export async function loadUnreadNotifications(gateway: NotificationFeedGateway) {
  try {
    return await gateway.unread(await gateway.loadActor());
  } catch {
    return 0;
  }
}

export async function markNotificationsRead(gateway: NotificationFeedGateway, upToId: unknown) {
  const id = positiveId(upToId);
  if (id === null) return null;
  try {
    return await gateway.markRead(await gateway.loadActor(), id);
  } catch {
    return null;
  }
}

export async function loadNotificationMedia(
  gateway: NotificationFeedGateway,
  rawId: string,
): Promise<NotificationMediaResult> {
  const id = /^[1-9][0-9]{0,17}$/.test(rawId) ? Number(rawId) : null;
  if (id === null || !Number.isSafeInteger(id)) return { ok: false, code: "NOT_FOUND" };
  try {
    return { ok: true, media: await gateway.media(await gateway.loadActor(), id) };
  } catch (error) {
    return { ok: false, code: failureCode(error) };
  }
}

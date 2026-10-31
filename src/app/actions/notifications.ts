"use server";

import {
  productionEmailUnsubscribeGateway,
  productionNotificationFeedGateway,
  productionPushSubscriptionCommands,
} from "@/app/_composition/session-gateways";
import type {
  EmailUnsubscribeResult,
  NotificationFeedResult,
  PushCommandResult,
  PushSetupViewModel,
} from "@/application/models/notifications";
import {
  loadNotificationFeed,
  loadUnreadNotifications,
  markNotificationsRead,
} from "@/application/notifications/notification-feed";
import {
  loadPushSetup,
  removePushSubscription,
  savePushSubscription,
} from "@/application/notifications/push-subscription";
import { unsubscribeEmail } from "@/application/notifications/unsubscribe-email";

export async function loadPushSetupAction(): Promise<PushSetupViewModel> {
  return loadPushSetup(productionPushSubscriptionCommands);
}

export async function savePushSubscriptionAction(input: unknown): Promise<PushCommandResult> {
  return savePushSubscription(productionPushSubscriptionCommands, input);
}

export async function removePushSubscriptionAction(endpoint: unknown): Promise<PushCommandResult> {
  return removePushSubscription(productionPushSubscriptionCommands, endpoint);
}

export async function loadNotificationFeedAction(
  beforeId: unknown,
): Promise<NotificationFeedResult> {
  return loadNotificationFeed(productionNotificationFeedGateway, beforeId);
}

export async function loadUnreadNotificationsAction(): Promise<number> {
  return loadUnreadNotifications(productionNotificationFeedGateway);
}

export async function markNotificationsReadAction(upToId: unknown): Promise<number | null> {
  return markNotificationsRead(productionNotificationFeedGateway, upToId);
}

export async function unsubscribeEmailAction(token: unknown): Promise<EmailUnsubscribeResult> {
  return unsubscribeEmail(productionEmailUnsubscribeGateway, token);
}

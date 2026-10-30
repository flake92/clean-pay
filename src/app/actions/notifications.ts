"use server";

import {
  productionEmailUnsubscribeGateway,
  productionPushSubscriptionCommands,
} from "@/app/_composition/session-gateways";
import type {
  EmailUnsubscribeResult,
  PushCommandResult,
  PushSetupViewModel,
} from "@/application/models/notifications";
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

export async function unsubscribeEmailAction(token: unknown): Promise<EmailUnsubscribeResult> {
  return unsubscribeEmail(productionEmailUnsubscribeGateway, token);
}

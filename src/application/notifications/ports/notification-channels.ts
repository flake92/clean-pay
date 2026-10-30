import type {
  EmailUnsubscribeCategory,
  PushSubscriptionInput,
} from "@/application/models/notifications";

export type PushActor = {
  context: unknown;
  userId: string;
};

export interface PushSubscriptionCommands {
  loadActor(): Promise<PushActor>;
  assertRateLimit(actor: PushActor): Promise<void>;
  publicKey(): Promise<string | null>;
  devices(actor: PushActor): Promise<number>;
  save(actor: PushActor, input: PushSubscriptionInput): Promise<number>;
  remove(actor: PushActor, endpoint: string): Promise<number>;
}

export interface EmailUnsubscribeGateway {
  unsubscribe(token: string): Promise<EmailUnsubscribeCategory>;
}

export class NotificationChannelGatewayError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

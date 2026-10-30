export type PushSetupViewModel =
  | { status: "ready"; publicKey: string; devices: number }
  | { status: "unavailable" };

export type PushSubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
};

export type PushCommandResult =
  | { ok: true; devices: number; message: string }
  | { ok: false; code: string; message: string };

export type EmailUnsubscribeCategory = "service" | "news";

export type EmailUnsubscribeResult =
  | { ok: true; category: EmailUnsubscribeCategory; message: string }
  | { ok: false; code: string; message: string };

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

export type NotificationFeedItemView = {
  id: number;
  category: "SERVICE" | "NEWS";
  html: string;
  buttons: Array<Array<{ text: string; url: string }>>;
  mediaType: string | null;
  createdAt: string;
  read: boolean;
};

export type NotificationFeedPage = {
  items: NotificationFeedItemView[];
  unreadCount: number;
  nextBeforeId: number | null;
};

export type NotificationFeedResult =
  | { ok: true; page: NotificationFeedPage }
  | { ok: false; code: string };

export type NotificationMedia = {
  body: ReadableStream<Uint8Array>;
  contentType: string;
};

export type NotificationMediaResult =
  | { ok: true; media: NotificationMedia }
  | { ok: false; code: string };

export type EmailUnsubscribeCategory = "service" | "news";

export type EmailUnsubscribeResult =
  | { ok: true; category: EmailUnsubscribeCategory; message: string }
  | { ok: false; code: string; message: string };

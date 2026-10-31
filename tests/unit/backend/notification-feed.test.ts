import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  feed: vi.fn(),
  media: vi.fn(),
  read: vi.fn(),
  unread: vi.fn(),
}));

vi.mock("@/backend/integrations/remnashop/api-client", () => ({
  fetchRemnashopFeedMedia: mocks.media,
  getRemnashopFeed: mocks.feed,
  getRemnashopFeedUnread: mocks.unread,
  markRemnashopFeedRead: mocks.read,
}));
vi.mock("@/backend/limits/rate-limit", () => ({ assertTargetRateLimit: vi.fn() }));
vi.mock("@/backend/observability/mutation-audit", () => ({ auditedMutation: vi.fn() }));

import {
  loadNotificationFeed,
  loadNotificationMedia,
  loadUnreadNotifications,
  markNotificationsRead,
} from "@/application/notifications/notification-feed";
import { ServiceError } from "@/backend/errors/service-error";
import { createNotificationFeedGateway } from "@/backend/integrations/notifications/notification-channels-adapter";

const authorization = {
  accessToken: "provider-access",
  session: { id: "session-1", userId: "user-1" },
};
const gateway = createNotificationFeedGateway(async () => authorization);

describe("notification feed", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps a page and passes the cursor", async () => {
    mocks.feed.mockResolvedValue({
      items: [{
        id: 7,
        category: "NEWS",
        text_html: "<b>Новость</b>",
        buttons: [[{ text: "Поддержка", url: "https://t.me/support" }]],
        media_type: "PHOTO",
        created_at: "2026-10-31T10:00:00Z",
        read: false,
      }],
      unread_count: 1,
      next_before_id: 7,
    });

    await expect(loadNotificationFeed(gateway, 9)).resolves.toEqual({
      ok: true,
      page: {
        items: [{
          id: 7,
          category: "NEWS",
          html: "<b>Новость</b>",
          buttons: [[{ text: "Поддержка", url: "https://t.me/support" }]],
          mediaType: "PHOTO",
          createdAt: "2026-10-31T10:00:00Z",
          read: false,
        }],
        unreadCount: 1,
        nextBeforeId: 7,
      },
    });
    expect(mocks.feed).toHaveBeenCalledWith("provider-access", 9);

    await loadNotificationFeed(gateway, "9; drop");
    expect(mocks.feed).toHaveBeenLastCalledWith("provider-access", undefined);
  });

  it("reports an expired session and an outage", async () => {
    const expired = createNotificationFeedGateway(async () => {
      throw new ServiceError("UNAUTHORIZED", 401, "expired");
    });
    await expect(loadNotificationFeed(expired)).resolves.toEqual({ ok: false, code: "UNAUTHORIZED" });
    mocks.feed.mockRejectedValue(new Error("down"));
    await expect(loadNotificationFeed(gateway)).resolves.toEqual({
      ok: false,
      code: "UPSTREAM_UNAVAILABLE",
    });
  });

  it("treats the unread badge and read marks as best effort", async () => {
    mocks.unread.mockResolvedValueOnce({ unread_count: 3 });
    await expect(loadUnreadNotifications(gateway)).resolves.toBe(3);
    mocks.unread.mockRejectedValueOnce(new Error("down"));
    await expect(loadUnreadNotifications(gateway)).resolves.toBe(0);

    mocks.read.mockResolvedValueOnce({ unread_count: 0 });
    await expect(markNotificationsRead(gateway, 7)).resolves.toBe(0);
    await expect(markNotificationsRead(gateway, "7")).resolves.toBeNull();
    mocks.read.mockRejectedValueOnce(new Error("down"));
    await expect(markNotificationsRead(gateway, 7)).resolves.toBeNull();
  });

  it("streams media only for a valid id and hides upstream failures", async () => {
    await expect(loadNotificationMedia(gateway, "../1")).resolves.toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(mocks.media).not.toHaveBeenCalled();

    const body = new Response("x").body;
    mocks.media.mockResolvedValueOnce(
      new Response(body, { headers: { "content-type": "image/jpeg" } }),
    );
    await expect(loadNotificationMedia(gateway, "7")).resolves.toMatchObject({
      ok: true,
      media: { contentType: "image/jpeg" },
    });

    mocks.media.mockResolvedValueOnce(new Response("no", { status: 404 }));
    await expect(loadNotificationMedia(gateway, "8")).resolves.toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    mocks.media.mockResolvedValueOnce(new Response("bad", { status: 502 }));
    await expect(loadNotificationMedia(gateway, "9")).resolves.toEqual({
      ok: false,
      code: "UPSTREAM_UNAVAILABLE",
    });
  });
});

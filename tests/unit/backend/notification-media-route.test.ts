import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock("@/app/_composition/session-gateways", () => ({
  productionNotificationFeedGateway: {},
}));
vi.mock("@/application/notifications/notification-feed", () => ({
  loadNotificationMedia: mocks.load,
}));

import { GET } from "@/app/api/notifications/media/[id]/route";

function request(range?: string) {
  return GET(
    new Request("https://cabinet.test/api/notifications/media/7", {
      headers: range ? { range } : {},
    }),
    { params: Promise.resolve({ id: "7" }) },
  );
}

describe("notification media route", () => {
  beforeEach(() => {
    mocks.load.mockReset();
    mocks.load.mockImplementation(async () => ({
      ok: true,
      media: { body: new Response("0123456789").body, contentType: "video/mp4" },
    }));
  });

  it("announces byte ranges on a plain request", async () => {
    const response = await request();

    expect(response.status).toBe(200);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    await expect(response.text()).resolves.toBe("0123456789");
  });

  it.each([
    ["bytes=0-1", "01", "bytes 0-1/10"],
    ["bytes=8-", "89", "bytes 8-9/10"],
    ["bytes=-3", "789", "bytes 7-9/10"],
    ["bytes=5-99", "56789", "bytes 5-9/10"],
  ])("answers %s with the partial content Safari asks for", async (range, body, contentRange) => {
    const response = await request(range);

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(contentRange);
    expect(response.headers.get("content-length")).toBe(String(body.length));
    expect(response.headers.get("content-type")).toBe("video/mp4");
    await expect(response.text()).resolves.toBe(body);
  });

  it("rejects a range outside the file", async () => {
    const response = await request("bytes=50-60");

    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */10");
  });

  it("serves the whole file for a range it does not understand", async () => {
    const response = await request("bytes=0-1,4-5");

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("0123456789");
  });

  it("maps gateway failures to statuses", async () => {
    mocks.load.mockResolvedValueOnce({ ok: false, code: "NOT_FOUND" });
    expect((await request()).status).toBe(404);
    mocks.load.mockResolvedValueOnce({ ok: false, code: "UPSTREAM_UNAVAILABLE" });
    expect((await request()).status).toBe(503);
  });
});

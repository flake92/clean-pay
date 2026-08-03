import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getAuthenticatedBffJson,
  getCachedBffJson,
  invalidateCachedBffJson,
} from "@/frontend/lib/bff-cache";

describe("BFF request coalescing", () => {
  afterEach(() => {
    invalidateCachedBffJson();
    vi.unstubAllGlobals();
  });

  it("shares one fetch between overlapping consumers", async () => {
    let resolveResponse!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchMock = vi.fn(() => response);
    vi.stubGlobal("fetch", fetchMock);

    const first = getCachedBffJson<{ value: number }>("/api/bff/auth/me");
    const second = getCachedBffJson<{ value: number }>("/api/bff/auth/me");
    resolveResponse(Response.json({ data: { value: 1 } }));

    await expect(first).resolves.toMatchObject({ data: { value: 1 } });
    await expect(second).resolves.toMatchObject({ data: { value: 1 } });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/bff/auth/me", {
      cache: "no-store",
    });
  });

  it("does not retain a resolved profile across a later request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: { user: "first" } }))
      .mockResolvedValueOnce(Response.json({ data: { user: "second" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCachedBffJson("/api/bff/auth/me")).resolves.toMatchObject({
      data: { user: "first" },
    });
    await expect(getCachedBffJson("/api/bff/auth/me")).resolves.toMatchObject({
      data: { user: "second" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rechecks identity after a pre-auth request races with completed login", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: "UNAUTHORIZED", message: "Login required" } },
          { status: 401 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({ data: { user: { email: "user@example.com" } } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getAuthenticatedBffJson<{ user: { email: string } }>(
        "/api/bff/auth/me",
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { user: { email: "user@example.com" } },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import { readBffError } from "@/frontend/lib/client-api";

function stubLocation(pathname: string, search = "") {
  const replace = vi.fn();

  vi.stubGlobal("window", {
    location: {
      origin: "https://pay.example.com",
      pathname,
      search,
      replace,
    },
  });

  return replace;
}

describe("client API auth handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("redirects protected client pages to login after API 401", async () => {
    const replace = stubLocation("/cabinet", "?tab=devices");

    await readBffError(
      Response.json({ error: { code: "UNAUTHORIZED", message: "Войдите в аккаунт, чтобы продолжить." } }, { status: 401 }),
    );

    expect(replace).toHaveBeenCalledWith("https://pay.example.com/login?redirect_to=%2Fcabinet%3Ftab%3Ddevices");
  });

  it("does not redirect auth pages after API 401", async () => {
    const replace = stubLocation("/login");

    await readBffError(
      Response.json({ error: { code: "AUTH_FAILED", message: "Bad credentials" } }, { status: 401 }),
    );

    expect(replace).not.toHaveBeenCalled();
  });

  it("does not redirect profile when the current password is invalid", async () => {
    const replace = stubLocation("/profile");

    const error = await readBffError(
      Response.json(
        { error: { code: "CURRENT_PASSWORD_INVALID", message: "Текущий пароль неверный." } },
        { status: 401 },
      ),
    );

    expect(error.message).toBe("Текущий пароль неверный.");
    expect(replace).not.toHaveBeenCalled();
  });
});

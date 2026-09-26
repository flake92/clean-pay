import { describe, expect, it, vi } from "vitest";

import {
  browserMutationPolicy,
  declaredServerActionBodyExceedsLimit,
  isServerActionRequest,
  serverActionBodyExceedsLimit,
  serverActionBodyLimitBytes,
  validateRequestSource,
} from "@/shared/edge/proxy-mutation-policy";

function stream(...chunkSizes: number[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const size of chunkSizes) controller.enqueue(new Uint8Array(size));
      controller.close();
    },
  });
}

describe("proxy browser mutation policy", () => {
  it("uses the exact trusted Origin and falls back to Referer only when Origin is absent", () => {
    expect(validateRequestSource({
      headers: new Headers({ origin: "https://pay.example.com" }),
      trustedAppUrl: "https://pay.example.com/path",
    })).toEqual({ ok: true });
    expect(validateRequestSource({
      headers: new Headers({ referer: "https://pay.example.com/form" }),
      trustedAppUrl: "https://pay.example.com",
    })).toEqual({ ok: true });
    expect(validateRequestSource({
      headers: new Headers({
        origin: "null",
        referer: "https://pay.example.com/form",
      }),
      trustedAppUrl: "https://pay.example.com",
    })).toEqual({ ok: false, reason: "untrusted_origin", status: 403 });
  });

  it("treats only the two owned Clean Pay origins as one explicit trust group", () => {
    for (const [trustedAppUrl, source] of [
      ["https://cleanvpn.edge-connect.uk", "https://oplata.clear-vpn.org"],
      ["https://oplata.clear-vpn.org", "https://cleanvpn.edge-connect.uk"],
    ]) {
      expect(validateRequestSource({
        headers: new Headers({ origin: source }),
        trustedAppUrl,
      })).toEqual({ ok: true });
      expect(validateRequestSource({
        headers: new Headers({ referer: `${source}/support?from=profile` }),
        trustedAppUrl,
      })).toEqual({ ok: true });
    }
  });

  it.each([
    "https://attacker.example",
    "https://oplata.clear-vpn.org.attacker.example",
    "http://oplata.clear-vpn.org",
    "https://oplata.clear-vpn.org:444",
    "https://user:password@oplata.clear-vpn.org",
  ])("rejects a non-member of the Clean Pay origin group: %s", (origin) => {
    expect(validateRequestSource({
      headers: new Headers({ origin }),
      trustedAppUrl: "https://cleanvpn.edge-connect.uk",
    })).toEqual({ ok: false, reason: "untrusted_origin", status: 403 });
  });

  it("does not enable the Clean Pay aliases for an unrelated installation", () => {
    expect(validateRequestSource({
      headers: new Headers({ origin: "https://oplata.clear-vpn.org" }),
      trustedAppUrl: "https://pay.example.com",
    })).toEqual({ ok: false, reason: "untrusted_origin", status: 403 });
  });

  it("recognizes only POST Server Action transports", () => {
    expect(isServerActionRequest("POST", new Headers({ "next-action": "id" }))).toBe(true);
    expect(isServerActionRequest("POST", new Headers({
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    }))).toBe(true);
    expect(isServerActionRequest("POST", new Headers({
      "content-type": "multipart/form-data; boundary=test",
    }))).toBe(true);
    expect(isServerActionRequest("POST", new Headers({
      "content-type": "text/plain;charset=UTF-8",
    }))).toBe(false);
    expect(isServerActionRequest("GET", new Headers({ "next-action": "id" }))).toBe(false);
  });

  it("treats the exact body limit as valid and rejects larger or unsafe declarations", () => {
    expect(declaredServerActionBodyExceedsLimit(String(serverActionBodyLimitBytes))).toBe(false);
    expect(declaredServerActionBodyExceedsLimit(String(serverActionBodyLimitBytes + 1))).toBe(true);
    expect(declaredServerActionBodyExceedsLimit("9007199254740992")).toBe(true);
    expect(declaredServerActionBodyExceedsLimit("invalid")).toBe(false);
    expect(declaredServerActionBodyExceedsLimit(null)).toBe(false);
  });

  it("bounds streamed bodies across chunks without consuming an exact-limit request", async () => {
    await expect(serverActionBodyExceedsLimit({
      headers: new Headers(),
      cloneBody: () => stream(2, 2),
      limit: 4,
    })).resolves.toBe(false);
    await expect(serverActionBodyExceedsLimit({
      headers: new Headers(),
      cloneBody: () => stream(2, 3),
      limit: 4,
    })).resolves.toBe(true);
  });

  it("validates source before cloning a Server Action body and short-circuits declarations", async () => {
    const untrustedClone = vi.fn(() => stream(1));
    await expect(browserMutationPolicy({
      method: "POST",
      pathname: "/login",
      headers: new Headers({
        "next-action": "id",
        origin: "https://evil.example",
      }),
      trustedAppUrl: "https://pay.example.com",
      hasAccessCookie: false,
      hasRefreshCookie: false,
      cloneBody: untrustedClone,
    })).resolves.toEqual({ ok: false, reason: "untrusted_origin", status: 403 });
    expect(untrustedClone).not.toHaveBeenCalled();

    const oversizedClone = vi.fn(() => stream(1));
    await expect(browserMutationPolicy({
      method: "POST",
      pathname: "/login",
      headers: new Headers({
        "next-action": "id",
        origin: "https://pay.example.com",
        "content-length": String(serverActionBodyLimitBytes + 1),
      }),
      trustedAppUrl: "https://pay.example.com",
      hasAccessCookie: false,
      hasRefreshCookie: false,
      cloneBody: oversizedClone,
    })).resolves.toEqual({
      ok: false,
      reason: "request_body_too_large",
      status: 413,
    });
    expect(oversizedClone).not.toHaveBeenCalled();
  });

  it("applies the Server Action byte limit after accepting the owned public alias", async () => {
    const exactClone = vi.fn(() => stream(serverActionBodyLimitBytes));
    await expect(browserMutationPolicy({
      method: "POST",
      pathname: "/support",
      headers: new Headers({
        "next-action": "id",
        origin: "https://oplata.clear-vpn.org",
      }),
      trustedAppUrl: "https://cleanvpn.edge-connect.uk",
      hasAccessCookie: true,
      hasRefreshCookie: true,
      cloneBody: exactClone,
    })).resolves.toEqual({ ok: true });
    expect(exactClone).toHaveBeenCalledOnce();

    const oversizedClone = vi.fn(() => stream(serverActionBodyLimitBytes + 1));
    await expect(browserMutationPolicy({
      method: "POST",
      pathname: "/support",
      headers: new Headers({
        "next-action": "id",
        origin: "https://oplata.clear-vpn.org",
      }),
      trustedAppUrl: "https://cleanvpn.edge-connect.uk",
      hasAccessCookie: true,
      hasRefreshCookie: true,
      cloneBody: oversizedClone,
    })).resolves.toEqual({
      ok: false,
      reason: "request_body_too_large",
      status: 413,
    });
  });

  it("keeps anonymous Telegram starts open but validates session-bearing starts and callbacks", async () => {
    const common = {
      headers: new Headers({ origin: "https://evil.example" }),
      trustedAppUrl: "https://pay.example.com",
      cloneBody: () => null,
    };
    await expect(browserMutationPolicy({
      ...common,
      method: "GET",
      pathname: "/auth/telegram/start",
      hasAccessCookie: false,
      hasRefreshCookie: false,
    })).resolves.toEqual({ ok: true });
    await expect(browserMutationPolicy({
      ...common,
      method: "GET",
      pathname: "/auth/telegram/start",
      hasAccessCookie: true,
      hasRefreshCookie: false,
    })).resolves.toEqual({ ok: false, reason: "untrusted_origin", status: 403 });
    await expect(browserMutationPolicy({
      ...common,
      method: "POST",
      pathname: "/auth/telegram/callback",
      hasAccessCookie: false,
      hasRefreshCookie: false,
    })).resolves.toEqual({ ok: false, reason: "untrusted_origin", status: 403 });
  });
});

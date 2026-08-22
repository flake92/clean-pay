import { beforeEach, describe, expect, it, onTestFailed } from "vitest";

import { e2eCompose } from "../setup/compose";

const baseUrl = process.env.CLEAN_PAY_E2E_BASE_URL ?? "http://localhost:4000";
const oidcBaseUrl = process.env.CLEAN_PAY_E2E_OIDC_URL ?? "http://localhost:8090";

type CookieJar = Record<string, string>;

function normalizedUrl(pathOrUrl: string) {
  if (!pathOrUrl.startsWith("http")) return `${baseUrl}${pathOrUrl}`;
  const url = new URL(pathOrUrl);
  if (url.origin === "http://localhost:4000") {
    return `${baseUrl}${url.pathname}${url.search}${url.hash}`;
  }
  if (url.origin === "http://localhost:8090") {
    return `${oidcBaseUrl}${url.pathname}${url.search}${url.hash}`;
  }
  return pathOrUrl;
}

function storeCookies(jar: CookieJar, response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : response.headers.get("set-cookie")
      ? [response.headers.get("set-cookie")!]
      : [];
  for (const value of values) {
    const pair = value.split(";", 1)[0];
    const separator = pair?.indexOf("=") ?? -1;
    if (pair && separator > 0) jar[pair.slice(0, separator)] = pair.slice(separator + 1);
  }
}

async function http(path: string, init: RequestInit = {}, jar?: CookieJar) {
  const headers = new Headers(init.headers);
  if (jar && Object.keys(jar).length > 0) {
    headers.set("cookie", Object.entries(jar).map(([key, value]) => `${key}=${value}`).join("; "));
  }
  const response = await fetch(normalizedUrl(path), {
    ...init,
    headers,
    redirect: init.redirect ?? "manual",
    signal: init.signal ?? AbortSignal.timeout(20_000),
  });
  if (jar) storeCookies(jar, response);
  return response;
}

async function loginWithTelegramOidc() {
  const jar: CookieJar = {};
  const start = await http("/auth/telegram/start?redirect_to=/cabinet", {}, jar);
  expect([302, 303, 307, 308]).toContain(start.status);

  const authorizationLocation = start.headers.get("location");
  expect(authorizationLocation).toContain("http://localhost:8090/auth");
  const authorization = await http(authorizationLocation!, {}, jar);
  expect([302, 303, 307, 308]).toContain(authorization.status);

  const callbackLocation = authorization.headers.get("location");
  expect(callbackLocation).toContain("/auth/telegram/callback");
  const callback = await http(callbackLocation!, {}, jar);
  expect([302, 303, 307, 308]).toContain(callback.status);
  expect(callback.headers.get("location")).toContain("/cabinet");
  return jar;
}

function logServicesOnFailure() {
  onTestFailed(() => {
    e2eCompose.logs(["app", "postgres", "redis", "remnashop"]);
  });
}

describe("server-rendered application surface", () => {
  beforeEach(() => {
    logServicesOnFailure();
  });

  it.each(["/api/health", "/api/health/liveness"])(
    "%s exposes a concrete health controller",
    async (path) => {
      const response = await http(path);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        status: "ok",
        service: "clean-pay",
      });
    },
  );

  it("reports dependency readiness without a generic response envelope", async () => {
    const response = await http("/api/health/readiness");
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ status: "ok", service: "clean-pay" });
    expect(body).not.toHaveProperty("data");
  });

  it.each(["/login", "/register", "/tariffs", "/support"])(
    "%s is rendered by the server",
    async (path) => {
      const response = await http(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
    },
  );

  it.each(["/cabinet", "/profile", "/payment", "/extend", "/referral"])(
    "%s enforces its session boundary on the server",
    async (path) => {
      const response = await http(path);
      expect([303, 307, 308]).toContain(response.status);
      expect(response.headers.get("location")).toContain("/login");
    },
  );

  it.each([
    "/api/me",
    "/api/logout",
    "/api/bff/auth/me",
    "/api/bff/subscription/current",
    "/api/bff/payments/status",
  ])("%s is not an application transport", async (path) => {
    const response = await http(path);
    expect(response.status).toBe(404);
  });

  it("keeps Telegram OIDC as an explicit external HTTP protocol", async () => {
    const response = await http("/auth/telegram/callback?code=invalid&state=invalid");
    expect([303, 307, 308]).toContain(response.status);
    expect(response.headers.get("location")).toContain("/login?auth=telegram_failed");
  });

  it("keeps the authenticated Telegram user journey available after the transport refactor", async () => {
    const jar = await loginWithTelegramOidc();

    for (const path of [
      "/cabinet",
      "/profile",
      "/payment",
      "/extend",
      "/link-account",
      "/referral",
    ]) {
      const response = await http(path, {}, jar);
      expect(response.status, `${path} unexpectedly redirected or failed`).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      if (path === "/referral") {
        await expect(response.text()).resolves.toContain("Пригласить друзей");
      }
    }

    const login = await http("/login", {}, jar);
    expect([302, 303, 307, 308]).toContain(login.status);
    expect(login.headers.get("location")).toContain("/cabinet");
  });
});

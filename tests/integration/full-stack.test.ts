import { afterEach, describe, expect, it } from "vitest";

import { integrationCompose } from "./setup/compose";

const baseUrl = process.env.CLEAN_PAY_INTEGRATION_BASE_URL ?? "http://localhost:4100";
const mailpitBaseUrl = process.env.CLEAN_PAY_INTEGRATION_MAILPIT_URL ?? "http://localhost:8125";
const oidcBaseUrl = process.env.CLEAN_PAY_INTEGRATION_OIDC_URL ?? "http://localhost:8190";

type CookieJar = Record<string, string>;

function setCookieHeaders(response: Response) {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };

  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const header = response.headers.get("set-cookie");

  return header ? [header] : [];
}

function storeCookies(jar: CookieJar, response: Response) {
  for (const header of setCookieHeaders(response)) {
    const [pair] = header.split(";");
    const separator = pair?.indexOf("=") ?? -1;

    if (!pair || separator <= 0) {
      continue;
    }

    jar[pair.slice(0, separator)] = pair.slice(separator + 1);
  }
}

function cookieHeader(jar: CookieJar) {
  return Object.entries(jar)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

async function http(pathOrUrl: string, init: RequestInit = {}, jar?: CookieJar) {
  const url = normalizeUrl(pathOrUrl);
  const headers = new Headers(init.headers);

  if (jar && Object.keys(jar).length > 0) {
    headers.set("cookie", cookieHeader(jar));
  }

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(url, {
    ...init,
    headers,
    redirect: init.redirect ?? "manual",
  });

  if (jar) {
    storeCookies(jar, response);
  }

  return response;
}

function normalizeUrl(pathOrUrl: string) {
  if (!pathOrUrl.startsWith("http")) {
    return `${baseUrl}${pathOrUrl}`;
  }

  const url = new URL(pathOrUrl);

  if (url.origin === "http://localhost:4100") {
    return `${baseUrl}${url.pathname}${url.search}${url.hash}`;
  }

  if (url.origin === "http://localhost:8190") {
    return `${oidcBaseUrl}${url.pathname}${url.search}${url.hash}`;
  }

  return pathOrUrl;
}

function expectRedirect(response: Response, label: string) {
  expect([302, 303, 307, 308], label).toContain(response.status);
}

async function debugResponse(response: Response) {
  const body = await response.clone().text().catch(() => "");

  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: body.slice(0, 2000),
  };
}

async function expectNot5xx(response: Response, label: string) {
  if (response.status >= 500) {
    throw new Error(`${label} returned ${response.status}: ${JSON.stringify(await debugResponse(response), null, 2)}`);
  }
}

async function loginWithTelegramOidc() {
  const jar: CookieJar = {};
  const start = await http("/auth/telegram/start?redirect_to=/cabinet", {}, jar);

  expectRedirect(start, JSON.stringify(await debugResponse(start)));
  const oidcLocation = start.headers.get("location");

  expect(oidcLocation).toContain("http://localhost:8190/auth");

  const oidc = await http(oidcLocation!, {}, jar);
  expectRedirect(oidc, JSON.stringify(await debugResponse(oidc)));
  const callbackLocation = oidc.headers.get("location");

  expect(callbackLocation).toContain("/auth/telegram/callback");

  const callback = await http(callbackLocation!, {}, jar);
  await expectNot5xx(callback, "GET /auth/telegram/callback");
  expectRedirect(callback, JSON.stringify(await debugResponse(callback)));
  expect(callback.headers.get("location")).toContain("/cabinet");

  return jar;
}

async function clearMailpit() {
  await fetch(`${mailpitBaseUrl}/api/v1/messages`, { method: "DELETE" }).catch(() => undefined);
}

async function mailpitMessages() {
  const response = await fetch(`${mailpitBaseUrl}/api/v1/messages`);

  await expectNot5xx(response, "GET /api/v1/messages");

  return response.json() as Promise<{
    messages?: Array<{
      ID?: string;
      To?: Array<{ Address?: string }>;
      Subject?: string;
    }>;
  }>;
}

async function waitForMail(address: string) {
  const deadline = Date.now() + 45_000;

  while (Date.now() < deadline) {
    const data = await mailpitMessages();
    const message = data.messages?.find((item) =>
      item.To?.some((to) => to.Address?.toLowerCase() === address.toLowerCase()),
    );

    if (message) {
      return message;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Mailpit did not receive verification email for ${address}`);
}

afterEach((context) => {
  if (context.task.result?.state === "fail") {
    integrationCompose.logs([
      "app",
      "remnashop",
      "remnashop-worker",
      "remnashop-scheduler",
      "smtp",
      "telegram-oidc-mock",
      "remnawave-mock",
    ]);
  }
});

describe("real Docker integration stack", () => {
  it("serves Clean Pay health and checks real database, Redis and Remnashop readiness", async () => {
    const health = await http("/api/health");

    expect(health.status, JSON.stringify(await debugResponse(health))).toBe(200);
    await expect(health.json()).resolves.toMatchObject({
      status: "ok",
      service: "clean-pay",
    });

    const readiness = await http("/api/health/readiness");

    expect(readiness.status, JSON.stringify(await debugResponse(readiness))).toBe(200);
    await expect(readiness.json()).resolves.toMatchObject({
      status: "ok",
      checks: {
        database: expect.objectContaining({ status: "ok" }),
        redis: expect.objectContaining({ status: "ok" }),
        remnashop: expect.objectContaining({ status: "ok" }),
      },
    });
  });

  it("proxies public plans through the real Remnashop container", async () => {
    const response = await http("/api/bff/plans/public");

    await expectNot5xx(response, "GET /api/bff/plans/public");
    expect(response.status, JSON.stringify(await debugResponse(response))).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: expect.anything(),
    });
  });

  it("logs in through the local Telegram OIDC mock and creates an authenticated Clean Pay session", async () => {
    const jar = await loginWithTelegramOidc();
    const me = await http("/api/bff/auth/me", {}, jar);

    await expectNot5xx(me, "GET /api/bff/auth/me");
    expect(me.status, JSON.stringify(await debugResponse(me))).toBe(200);
    await expect(me.json()).resolves.toMatchObject({
      data: {
        user: expect.objectContaining({
          telegramId: "100000001",
        }),
      },
    });
  });

  it("requests email verification through Remnashop SMTP delivery and receives it in Mailpit", async () => {
    await clearMailpit();

    const jar = await loginWithTelegramOidc();
    const email = `clean-pay-integration-${Date.now()}@example.com`;
    const response = await http(
      "/api/bff/auth/email/request-verification",
      {
        method: "POST",
        body: JSON.stringify({ email }),
      },
      jar,
    );
    const debug = await debugResponse(response);

    expect(JSON.stringify(debug)).not.toContain("Email delivery is not configured");
    await expectNot5xx(response, "POST /api/bff/auth/email/request-verification");
    expect([200, 201, 202], JSON.stringify(debug)).toContain(response.status);

    const message = await waitForMail(email);

    expect(message.To?.some((to) => to.Address?.toLowerCase() === email.toLowerCase())).toBe(true);
  });
});

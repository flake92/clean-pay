import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { e2eCompose } from "../setup/compose";
import {
  anonymousPublicCases,
  malformedPayloadCases,
  protectedEndpoints,
  telegramBusinessCases,
  unverifiedAllowedCases,
  unverifiedBlockedCases,
} from "./endpoint-matrix";

const baseUrl = process.env.CLEAN_PAY_E2E_BASE_URL ?? "http://localhost:4000";
const mailpitBaseUrl = process.env.CLEAN_PAY_E2E_MAILPIT_URL ?? "http://localhost:8025";
const oidcBaseUrl = process.env.CLEAN_PAY_E2E_OIDC_URL ?? "http://localhost:8090";

type CookieJar = Record<string, string>;
type BffBody<T = unknown> = { data?: T; error?: { code: string; message: string; debug?: unknown } };

type SubscriptionOffers = {
  gateways?: Array<{ gateway_type: string }>;
  plans?: Array<{
    public_code: string;
    recommended_purchase_type?: string;
    durations?: Array<{
      days: number;
      prices?: Array<{ gateway_type: string; is_free?: boolean }>;
    }>;
  }>;
};

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
  const method = (init.method ?? "GET").toUpperCase();

  if (jar && Object.keys(jar).length > 0) {
    headers.set("cookie", cookieHeader(jar));
  }

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  if (
    !["GET", "HEAD", "OPTIONS"].includes(method) &&
    new URL(url).origin === new URL(baseUrl).origin &&
    !headers.has("origin")
  ) {
    headers.set("origin", new URL(baseUrl).origin);
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

async function json<T = unknown>(response: Response) {
  return response.json() as Promise<T>;
}

async function bff<T = unknown>(response: Response) {
  return json<BffBody<T>>(response);
}

function normalizeUrl(pathOrUrl: string) {
  if (!pathOrUrl.startsWith("http")) {
    return `${baseUrl}${pathOrUrl}`;
  }

  const url = new URL(pathOrUrl);

  if (url.origin === "http://localhost:4000") {
    return `${baseUrl}${url.pathname}${url.search}${url.hash}`;
  }

  if (url.origin === "http://localhost:8090") {
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
    url: response.url,
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

async function expectBffError(response: Response, status: number, code: string) {
  expect(response.status, JSON.stringify(await debugResponse(response))).toBe(status);
  await expect(bff(response)).resolves.toMatchObject({
    error: { code },
  });
}

async function expectBffData<T = unknown>(response: Response, status = 200) {
  expect(response.status, JSON.stringify(await debugResponse(response))).toBe(status);
  const payload = await bff<T>(response);

  expect(payload).toHaveProperty("data");

  return payload.data as T;
}

async function loginWithTelegramOidc() {
  const jar: CookieJar = {};
  const start = await http("/auth/telegram/start?redirect_to=/cabinet", {}, jar);

  expectRedirect(start, JSON.stringify(await debugResponse(start)));
  const oidcLocation = start.headers.get("location");

  expect(oidcLocation).toContain("http://localhost:8090/auth");

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

async function registerWithEmail() {
  const jar: CookieJar = {};
  const email = `clean-pay-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const password = `CleanPay${Date.now()}!a`;
  const response = await http(
    "/api/bff/auth/register",
    {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        name: "Clean Pay Integration",
      }),
    },
    jar,
  );

  await expectNot5xx(response, "POST /api/bff/auth/register");
  expect(response.status, JSON.stringify(await debugResponse(response))).toBe(201);

  return { jar, email, password, body: await bff(response) };
}

async function postJson(path: string, body: unknown, jar?: CookieJar) {
  return http(path, { method: "POST", body: JSON.stringify(body) }, jar);
}

function cloneJar(jar: CookieJar) {
  return { ...jar };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function requestCase(
  testCase: { method: string; path: string; body?: unknown },
  jar?: CookieJar,
) {
  const response = await http(testCase.path, {
    method: testCase.method,
    body: testCase.body === undefined ? undefined : JSON.stringify(testCase.body),
  }, jar);

  if (
    response.status >= 500
    && testCase.method === "GET"
    && testCase.path.startsWith("/auth/telegram/callback?code=bad-code")
  ) {
    await new Promise((resolve) => setTimeout(resolve, 250));

    return http(testCase.path, { method: testCase.method }, jar);
  }

  return response;
}

function findPurchasableOffer(offers: SubscriptionOffers) {
  for (const plan of offers.plans ?? []) {
    for (const duration of plan.durations ?? []) {
      const price = duration.prices?.[0];

      if (price?.gateway_type) {
        return {
          planCode: plan.public_code,
          durationDays: duration.days,
          gatewayType: price.gateway_type,
        };
      }
    }
  }

  return null;
}

function findRenewOffer(offers: SubscriptionOffers) {
  for (const plan of offers.plans ?? []) {
    if (plan.recommended_purchase_type !== "renew") {
      continue;
    }

    for (const duration of plan.durations ?? []) {
      const price = duration.prices?.[0];

      if (price?.gateway_type) {
        return {
          durationDays: duration.days,
          gatewayType: price.gateway_type,
        };
      }
    }
  }

  return null;
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

async function mailpitMessageText(id: string) {
  const response = await fetch(`${mailpitBaseUrl}/api/v1/message/${encodeURIComponent(id)}`);

  await expectNot5xx(response, "GET /api/v1/message/:id");

  const data = await response.json() as {
    Text?: string;
    HTML?: string;
    text?: string;
    html?: string;
    Body?: string;
    body?: string;
  };

  return [
    data.Text,
    data.HTML,
    data.text,
    data.html,
    data.Body,
    data.body,
  ].filter((value): value is string => typeof value === "string").join("\n");
}

async function verificationCodeFromMail(address: string) {
  const message = await waitForMail(address);
  const text = message.ID ? await mailpitMessageText(message.ID) : "";
  const code = text.match(/\b\d{4,8}\b/)?.[0] ?? null;

  if (!code) {
    throw new Error(`Verification email for ${address} did not contain a numeric code`);
  }

  return { message, code };
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
    e2eCompose.logs([
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

describe("real devcontainer full-stack e2e", () => {
  let matrixTelegramJar: CookieJar;
  let matrixUnverified: { jar: CookieJar; email: string; password: string };

  beforeAll(async () => {
    matrixTelegramJar = await loginWithTelegramOidc();
    const registered = await registerWithEmail();

    matrixUnverified = {
      jar: registered.jar,
      email: registered.email,
      password: registered.password,
    };
  }, 60_000);

  describe("100+ integration endpoint matrix", () => {
    it.each(anonymousPublicCases)(
      "anonymous/public $method $path",
      async (testCase) => {
        // Проверяем: публичный endpoint доступен без сессии и не превращается в 5xx.
        const response = await requestCase(testCase);

        await expectNot5xx(response, `${testCase.method} ${testCase.path}`);
        expect(testCase.statuses, JSON.stringify(await debugResponse(response))).toContain(response.status);
      },
    );

    it.each(protectedEndpoints)(
      "anonymous/protected $method $path",
      async (testCase) => {
        // Проверяем: защищенный endpoint без сессии отсекается middleware как UNAUTHORIZED.
        const response = await requestCase(testCase);

        await expectBffError(response, 401, "UNAUTHORIZED");
      },
    );

    it.each(unverifiedAllowedCases)(
      "unverified-email/allowed $method $path",
      async (testCase) => {
        // Проверяем: endpoint из email-verification контура доступен пользователю до подтверждения email.
        const body = isRecord(testCase.body) && "email" in testCase.body && testCase.body.email === undefined
          ? { ...testCase.body, email: matrixUnverified.email }
          : testCase.body;
        const response = await requestCase({ ...testCase, body }, cloneJar(matrixUnverified.jar));

        await expectNot5xx(response, `${testCase.method} ${testCase.path}`);
        expect(testCase.statuses, JSON.stringify(await debugResponse(response))).toContain(response.status);
      },
    );

    it.each(unverifiedBlockedCases)(
      "unverified-email/blocked $method $path",
      async (testCase) => {
        // Проверяем: бизнесовые endpoint-ы кабинета не доступны до подтверждения email.
        const response = await requestCase(testCase, cloneJar(matrixUnverified.jar));

        await expectBffError(response, 403, "EMAIL_NOT_VERIFIED");
      },
    );

    it.each(telegramBusinessCases)(
      "telegram/business $method $path",
      async (testCase) => {
        // Проверяем: Telegram-пользователь проходит реальные бизнес endpoint-ы без случайных 5xx.
        const response = await requestCase(testCase, cloneJar(matrixTelegramJar));

        await expectNot5xx(response, `${testCase.method} ${testCase.path}`);
        expect(testCase.statuses, JSON.stringify(await debugResponse(response))).toContain(response.status);
      },
    );

    it.each(malformedPayloadCases)(
      "malformed/public $method $path",
      async (testCase) => {
        // Проверяем: плохой payload/параметры возвращают контролируемые ответы, а не внутренние ошибки.
        const response = await requestCase(testCase);

        await expectNot5xx(response, `${testCase.method} ${testCase.path}`);
        expect(testCase.statuses, JSON.stringify(await debugResponse(response))).toContain(response.status);
      },
    );
  });

  it("serves Clean Pay health and checks real devcontainer dependency readiness", async () => {
    // Проверяем: публичный health показывает, что Clean Pay жив.
    const health = await http("/api/health");

    expect(health.status, JSON.stringify(await debugResponse(health))).toBe(200);
    await expect(health.json()).resolves.toMatchObject({
      status: "ok",
      service: "clean-pay",
    });

    const liveness = await http("/api/health/liveness");

    expect(liveness.status, JSON.stringify(await debugResponse(liveness))).toBe(200);
    await expect(liveness.json()).resolves.toMatchObject({
      status: "ok",
      service: "clean-pay",
    });

    // Проверяем: readiness отражает реальные зависимости стенда, а не только процесс Next.js.
    const readiness = await http("/api/health/readiness");

    expect(readiness.status, JSON.stringify(await debugResponse(readiness))).toBe(200);
    await expect(readiness.json()).resolves.toMatchObject({
      status: "ok",
      checks: {
        database: expect.objectContaining({ status: "ok" }),
        redis: expect.objectContaining({ status: "ok" }),
        remnashop: expect.objectContaining({ status: "ok" }),
        mailpit: expect.objectContaining({ status: "ok" }),
        telegramOidc: expect.objectContaining({ status: "ok" }),
        remnawave: expect.objectContaining({ status: "ok" }),
      },
    });
  });

  it("keeps public authentication entrypoints available without a session", async () => {
    // Проверяем: identify можно вызвать до логина, чтобы UI выбрал следующий шаг входа.
    const unknownEmail = `unknown-${Date.now()}@example.com`;
    const identify = await postJson("/api/bff/auth/identify", { email: unknownEmail });
    const identifyData = await expectBffData(identify);

    expect(identifyData).toMatchObject({ exists: false, hasPasskey: false });

    // Проверяем: пустой identify валидируется как доменная ошибка, а не падает 5xx.
    await expectBffError(await postJson("/api/bff/auth/identify", { email: "" }), 400, "VALIDATION_ERROR");

    // Проверяем: passkey login options публичны, потому что login еще не имеет сессии.
    const passkeyOptions = await postJson("/api/bff/auth/passkey/login/options", {});
    const passkeyData = await expectBffData<{ challenge: string }>(passkeyOptions);

    expect(passkeyData.challenge).toEqual(expect.any(String));

    // Проверяем: некорректный passkey verify не должен становиться успешным входом.
    const invalidPasskey = await postJson("/api/bff/auth/passkey/login/verify", { id: "missing", response: {} });

    expect(invalidPasskey.status, JSON.stringify(await debugResponse(invalidPasskey))).toBeGreaterThanOrEqual(400);
    expect(invalidPasskey.status, JSON.stringify(await debugResponse(invalidPasskey))).toBeLessThan(500);

    // Проверяем: logout публичен и идемпотентен, чтобы UI мог чистить локальное состояние.
    await expectBffData(await http("/api/bff/auth/logout", { method: "POST" }));
    expect((await http("/api/logout", { method: "POST" })).status).toBe(200);

    // Проверяем: неверный Telegram callback не создает сессию и уводит пользователя в controlled failure.
    const badTelegramCallback = await http("/auth/telegram/callback?code=bad-code&state=bad-state");

    expectRedirect(badTelegramCallback, JSON.stringify(await debugResponse(badTelegramCallback)));
    expect(badTelegramCallback.headers.get("location")).toContain("/login?auth=telegram_failed");
  });

  it("proxies public plans through the real Remnashop container", async () => {
    // Проверяем: витрина тарифов публична и проксируется в реальный Remnashop.
    const response = await http("/api/bff/plans/public");

    await expectNot5xx(response, "GET /api/bff/plans/public");
    expect(response.status, JSON.stringify(await debugResponse(response))).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: expect.anything(),
    });
  });

  it("blocks protected business endpoints before authentication", async () => {
    for (const endpoint of protectedEndpoints) {
      // Проверяем: защищенный endpoint без сессии закрыт middleware до бизнес-логики.
      const response = await http(endpoint.path, {
        method: endpoint.method,
        body: endpoint.body === undefined ? undefined : JSON.stringify(endpoint.body),
      });

      await expectBffError(response, 401, "UNAUTHORIZED");
    }
  });

  it("routes users between login, cabinet and verification pages by session state", async () => {
    // Проверяем: анонимный пользователь не попадает в кабинет, а отправляется на login.
    const anonymousCabinet = await http("/cabinet");

    expectRedirect(anonymousCabinet, JSON.stringify(await debugResponse(anonymousCabinet)));
    expect(anonymousCabinet.headers.get("location")).toContain("/login?redirect_to=%2Fcabinet");

    // Проверяем: authenticated пользователь не должен оставаться на login/register.
    const telegramJar = await loginWithTelegramOidc();
    const loginPage = await http("/login", {}, telegramJar);

    expectRedirect(loginPage, JSON.stringify(await debugResponse(loginPage)));
    expect(loginPage.headers.get("location")).toContain("/cabinet");

    // Проверяем: unverified email пользователь с кабинета переводится на страницу подтверждения.
    const { jar } = await registerWithEmail();
    const unverifiedCabinet = await http("/cabinet", {}, jar);

    expectRedirect(unverifiedCabinet, JSON.stringify(await debugResponse(unverifiedCabinet)));
    expect(unverifiedCabinet.headers.get("location")).toContain("/register/verify-email");
  });

  it("logs in through the local Telegram OIDC mock and creates an authenticated Clean Pay session", async () => {
    // Проверяем: Telegram OIDC mock проходит полный redirect flow и создает web session.
    const jar = await loginWithTelegramOidc();

    // Проверяем: BFF профиль после Telegram login возвращает бизнес-идентичность пользователя.
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

  it("serves authenticated account, support and passkey setup surfaces after Telegram login", async () => {
    // Проверяем: после Telegram login локальный session endpoint возвращает пользователя.
    const jar = await loginWithTelegramOidc();
    const localMe = await http("/api/me", {}, jar);

    expect(localMe.status, JSON.stringify(await debugResponse(localMe))).toBe(200);
    await expect(json(localMe)).resolves.toMatchObject({
      user: expect.objectContaining({ telegramId: "100000001" }),
    });

    // Проверяем: support endpoint доступен только внутри кабинета и возвращает контакты стенда.
    const support = await expectBffData<{
      enabled: boolean;
      email: string | null;
      telegramUsername: string | null;
      faqUrl: string | null;
    }>(await http("/api/bff/support", {}, jar));

    expect(support).toMatchObject({
      enabled: true,
      email: "support@example.com",
      telegramUsername: "cleanpay_support",
    });

    // Проверяем: пользователь может начать регистрацию passkey и видеть текущий список ключей.
    const registerOptions = await expectBffData<{ challenge: string }>(
      await postJson("/api/bff/auth/passkey/register/options", {}, jar),
    );

    expect(registerOptions.challenge).toEqual(expect.any(String));

    const credentials = await expectBffData<{ credentials: unknown[] }>(
      await http("/api/bff/auth/passkey/credentials", {}, jar),
    );

    expect(Array.isArray(credentials.credentials)).toBe(true);

    // Проверяем: нельзя удалить несуществующий passkey; это должна быть доменная 403/404, не 5xx.
    const deleteMissing = await http("/api/bff/auth/passkey/credentials/missing", { method: "DELETE" }, jar);

    expect([403, 404], JSON.stringify(await debugResponse(deleteMissing))).toContain(deleteMissing.status);

    // Проверяем: verify регистрации passkey с невалидным browser payload не должен давать внутреннюю ошибку.
    const invalidRegisterVerify = await postJson(
      "/api/bff/auth/passkey/register/verify",
      {
        id: "missing",
        rawId: "missing",
        type: "public-key",
        response: {
          clientDataJSON: Buffer.from(JSON.stringify({ challenge: registerOptions.challenge })).toString("base64url"),
          attestationObject: Buffer.from("invalid").toString("base64url"),
        },
      },
      jar,
    );

    expect(invalidRegisterVerify.status, JSON.stringify(await debugResponse(invalidRegisterVerify))).toBeGreaterThanOrEqual(400);
    expect(invalidRegisterVerify.status, JSON.stringify(await debugResponse(invalidRegisterVerify))).toBeLessThan(500);
  });

  it("requests email verification through Remnashop SMTP delivery and receives it in Mailpit", async () => {
    // Проверяем: запрос подтверждения email идет через Remnashop и реально доставляет письмо в Mailpit.
    await clearMailpit();

    const jar = await loginWithTelegramOidc();
    const email = `clean-pay-e2e-${Date.now()}@example.com`;
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

  it("registers an email user, sends verification mail and rejects an invalid verification code without 5xx", async () => {
    // Проверяем: email registration создает web session и сразу инициирует письмо подтверждения.
    await clearMailpit();
    const { jar, email, password, body: registerBody } = await registerWithEmail();

    expect(registerBody).toMatchObject({
      data: {
        user: expect.objectContaining({ email }),
        emailVerification: expect.objectContaining({ target_email: email }),
      },
    });

    const { message, code } = await verificationCodeFromMail(email);

    expect(message.Subject).toEqual(expect.any(String));

    // Проверяем: identify после регистрации видит локального пользователя.
    const identify = await postJson("/api/bff/auth/identify", { email });

    await expect(bff(identify)).resolves.toMatchObject({
      data: { exists: true },
    });

    // Проверяем: неверный код подтверждения дает управляемую клиентскую ошибку, не 500.
    const invalidConfirm = await postJson(
      "/api/bff/auth/email/confirm",
      { email, code: "000000", registrationFlow: true },
      jar,
    );

    expect(invalidConfirm.status, JSON.stringify(await debugResponse(invalidConfirm))).toBeGreaterThanOrEqual(400);
    expect(invalidConfirm.status, JSON.stringify(await debugResponse(invalidConfirm))).toBeLessThan(500);

    // Проверяем: до подтверждения email обычные кабинетные BFF endpoints закрыты бизнес-ограничением.
    await expectBffError(await http("/api/bff/subscription/offers", {}, jar), 403, "EMAIL_NOT_VERIFIED");

    // Проверяем: правильный код переводит пользователя в verified-состояние и обновляет локальный access cookie.
    const confirm = await postJson(
      "/api/bff/auth/email/confirm",
      { email, code, registrationFlow: true },
      jar,
    );
    const confirmData = await expectBffData(confirm);

    expect(confirmData).toMatchObject({ success: true, email });

    const profile = await expectBffData<{ user: { email: string; emailVerified: boolean } }>(
      await http("/api/bff/auth/me", {}, jar),
    );

    expect(profile.user).toMatchObject({ email, emailVerified: true });

    // Проверяем: login существующим email проходит через тот же Remnashop account и возвращает профиль.
    const loginJar: CookieJar = {};
    const login = await postJson("/api/bff/auth/login", { email, password }, loginJar);

    await expectNot5xx(login, "POST /api/bff/auth/login");
    expect(login.status, JSON.stringify(await debugResponse(login))).toBe(200);

    // Проверяем: неверный пароль возвращает controlled auth error, а не 500.
    const badLogin = await postJson("/api/bff/auth/login", { email, password: `${password}-wrong` });

    expect(badLogin.status, JSON.stringify(await debugResponse(badLogin))).toBeGreaterThanOrEqual(400);
    expect(badLogin.status, JSON.stringify(await debugResponse(badLogin))).toBeLessThan(500);

    // Проверяем: после verified-состояния смена пароля проходит через Remnashop и ротирует session tokens.
    const newPassword = `${password}Next!1`;
    const changePassword = await postJson(
      "/api/bff/auth/change-password",
      { current_password: password, new_password: newPassword },
      jar,
    );
    const changePasswordData = await expectBffData(changePassword);

    expect(changePasswordData).toMatchObject({ success: true });

    // Проверяем: старый пароль после смены больше не является валидным.
    const oldPasswordLogin = await postJson("/api/bff/auth/login", { email, password });

    expect(oldPasswordLogin.status, JSON.stringify(await debugResponse(oldPasswordLogin))).toBeGreaterThanOrEqual(400);
    expect(oldPasswordLogin.status, JSON.stringify(await debugResponse(oldPasswordLogin))).toBeLessThan(500);

    // Проверяем: смена email создает pending email и отправляет новое письмо подтверждения.
    const nextEmail = `changed-${email}`;
    const changeEmail = await postJson("/api/bff/auth/email/change", { email: nextEmail }, jar);

    await expectNot5xx(changeEmail, "POST /api/bff/auth/email/change");
    expect([200, 400, 409, 422], JSON.stringify(await debugResponse(changeEmail))).toContain(changeEmail.status);

    if (changeEmail.status === 200) {
      await expect(bff(changeEmail)).resolves.toMatchObject({
        data: {
          success: true,
          pending_email: nextEmail,
          emailVerification: expect.objectContaining({ target_email: nextEmail }),
        },
      });
      await verificationCodeFromMail(nextEmail);
    }
  });

  it("covers subscription, device and payment business endpoints for an authenticated Telegram user", async () => {
    const jar = await loginWithTelegramOidc();

    // Проверяем: offers показывают доступные тарифы/gateways для покупки или контролируемую доменную ошибку.
    const offersResponse = await http("/api/bff/subscription/offers", {}, jar);

    await expectNot5xx(offersResponse, "GET /api/bff/subscription/offers");
    expect([200, 400, 401, 403, 404, 409, 422], JSON.stringify(await debugResponse(offersResponse))).toContain(offersResponse.status);

    const offers = offersResponse.status === 200
      ? await bff<SubscriptionOffers>(offersResponse).then((payload) => payload.data)
      : null;

    if (offers) {
      expect(Array.isArray(offers.plans)).toBe(true);
    }

    // Проверяем: current subscription endpoint не падает, даже если подписки еще нет.
    const current = await http("/api/bff/subscription/current", {}, jar);

    await expectNot5xx(current, "GET /api/bff/subscription/current");
    expect([200, 403, 404, 409], JSON.stringify(await debugResponse(current))).toContain(current.status);

    // Проверяем: devices endpoint отражает состояние подписки или возвращает доменное ограничение без 5xx.
    const devices = await http("/api/bff/subscription/devices", {}, jar);

    await expectNot5xx(devices, "GET /api/bff/subscription/devices");
    expect([200, 400, 403, 404, 409], JSON.stringify(await debugResponse(devices))).toContain(devices.status);

    // Проверяем: удаление всех устройств безопасно обрабатывает пустую/отсутствующую подписку.
    const deleteDevices = await http("/api/bff/subscription/devices", { method: "DELETE" }, jar);

    await expectNot5xx(deleteDevices, "DELETE /api/bff/subscription/devices");
    expect([200, 400, 403, 404, 409], JSON.stringify(await debugResponse(deleteDevices))).toContain(deleteDevices.status);

    // Проверяем: удаление конкретного устройства с неизвестным hwid не должно давать внутреннюю ошибку.
    const deleteDevice = await http("/api/bff/subscription/devices/integration-missing-device", { method: "DELETE" }, jar);

    await expectNot5xx(deleteDevice, "DELETE /api/bff/subscription/devices/:hwid");
    expect([200, 400, 403, 404, 409], JSON.stringify(await debugResponse(deleteDevice))).toContain(deleteDevice.status);

    // Проверяем: неверный промокод возвращает контролируемую доменную ошибку.
    const promocode = await postJson("/api/bff/subscription/promocode", { code: "CLEAN_PAY_E2E_MISSING" }, jar);

    await expectNot5xx(promocode, "POST /api/bff/subscription/promocode");
    expect([200, 400, 403, 404, 409, 422], JSON.stringify(await debugResponse(promocode))).toContain(promocode.status);

    // Проверяем: reissue доступен только при валидном бизнес-состоянии подписки, но не падает 5xx.
    const reissue = await http("/api/bff/subscription/reissue", { method: "POST" }, jar);

    await expectNot5xx(reissue, "POST /api/bff/subscription/reissue");
    expect([200, 400, 403, 404, 409], JSON.stringify(await debugResponse(reissue))).toContain(reissue.status);

    // Проверяем: payment status/history работают даже до создания платежей.
    const initialHistory = await expectBffData<unknown[]>(await http("/api/bff/payments/history", {}, jar));

    expect(Array.isArray(initialHistory)).toBe(true);

    const initialStatus = await expectBffData<{ payment: unknown | null; source: string }>(
      await http("/api/bff/payments/status", {}, jar),
    );

    expect(initialStatus).toMatchObject({
      payment: null,
      source: "local_payment_record_and_current_subscription",
    });

    const purchasable = offers ? findPurchasableOffer(offers) : null;

    if (purchasable) {
      // Проверяем: purchase использует реальный доступный offer/gateway и создает локальную запись платежа.
      const purchase = await postJson(
        "/api/bff/subscription/purchase",
        {
          plan_code: purchasable.planCode,
          duration_days: purchasable.durationDays,
          gateway_type: purchasable.gatewayType,
        },
        jar,
      );

      await expectNot5xx(purchase, "POST /api/bff/subscription/purchase");

      if (purchase.status === 200) {
        const payment = await expectBffData<{ payment_id: string }>(purchase);
        const status = await expectBffData<{ payment: { payment_id: string } | null }>(
          await http(`/api/bff/payments/status?payment_id=${encodeURIComponent(payment.payment_id)}`, {}, jar),
        );

        expect(status.payment).toMatchObject({ payment_id: payment.payment_id });
      } else {
        expect([400, 403, 404, 409, 422], JSON.stringify(await debugResponse(purchase))).toContain(purchase.status);
      }
    }

    const renewable = offers ? findRenewOffer(offers) : null;

    if (renewable) {
      // Проверяем: extend использует renew offer, если он доступен в текущем бизнес-состоянии.
      const extend = await postJson(
        "/api/bff/subscription/extend",
        {
          duration_days: renewable.durationDays,
          gateway_type: renewable.gatewayType,
        },
        jar,
      );

      await expectNot5xx(extend, "POST /api/bff/subscription/extend");
      expect([200, 400, 403, 404, 409, 422], JSON.stringify(await debugResponse(extend))).toContain(extend.status);
    }
  });

  it("links a Telegram session to an email Remnashop account and starts verification", async () => {
    // Проверяем: Telegram-only пользователь может привязать email/Remnashop account как следующий бизнес-шаг.
    await clearMailpit();
    const jar = await loginWithTelegramOidc();
    const email = `telegram-link-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
    const password = `CleanPayLink${Date.now()}!a`;
    const link = await postJson("/api/bff/link/remnashop", { email, password }, jar);

    await expectNot5xx(link, "POST /api/bff/link/remnashop");
    expect([200, 201, 409], JSON.stringify(await debugResponse(link))).toContain(link.status);

    if (link.status === 200 || link.status === 201) {
      await expect(bff(link)).resolves.toMatchObject({
        data: {
          linked: true,
          emailVerification: expect.objectContaining({ target_email: email }),
        },
      });
      await verificationCodeFromMail(email);

      // Проверяем: после link локальный профиль отражает привязанный email.
      const me = await expectBffData<{ user: { email: string | null } }>(
        await http("/api/bff/auth/me", {}, jar),
      );

      expect(me.user.email).toBe(email);
    }
  });
});

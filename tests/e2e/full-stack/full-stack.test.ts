import { beforeEach, describe, expect, it, onTestFailed } from "vitest";

import { e2eCompose } from "../setup/compose";

const baseUrl = process.env.CLEAN_PAY_E2E_BASE_URL ?? "http://localhost:4000";

async function http(path: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    redirect: init.redirect ?? "manual",
  });
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

  it.each(["/cabinet", "/profile", "/payment", "/extend"])(
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
});

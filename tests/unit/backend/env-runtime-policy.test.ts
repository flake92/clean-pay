import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createEnvForTests,
  getEnv,
  resetEnvForTests,
} from "@/backend/config/env";

describe("runtime environment policy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvForTests();
  });

  it("creates the singleton lazily and retains one immutable snapshot", () => {
    resetEnvForTests();
    vi.stubEnv("NEXT_PUBLIC_BRAND_NAME", "First runtime snapshot");

    const first = getEnv();
    vi.stubEnv("NEXT_PUBLIC_BRAND_NAME", "Later process mutation");

    expect(getEnv()).toBe(first);
    expect(getEnv().branding.name).toBe("First runtime snapshot");

    resetEnvForTests();
    const refreshed = getEnv();
    expect(refreshed).not.toBe(first);
    expect(refreshed.branding.name).toBe("Later process mutation");
  });

  it("refreshes only the test keyring snapshot when rotation inputs change", () => {
    const firstSecret = "a".repeat(32);
    const secondSecret = "b".repeat(32);
    const previousSecret = "c".repeat(32);

    resetEnvForTests();
    vi.stubEnv("WEB_REFRESH_KEY_ID", "key-a");
    vi.stubEnv("WEB_REFRESH_SECRET", firstSecret);
    vi.stubEnv("WEB_REFRESH_PREVIOUS_KEYS", "");

    const first = getEnv();
    expect(first.webRefreshKeyring).toEqual({
      primary: { id: "key-a", secret: firstSecret },
      previous: [],
    });

    vi.stubEnv("WEB_REFRESH_KEY_ID", "key-b");
    vi.stubEnv("WEB_REFRESH_SECRET", secondSecret);
    vi.stubEnv(
      "WEB_REFRESH_PREVIOUS_KEYS",
      JSON.stringify({ "key-a": previousSecret }),
    );

    const rotated = getEnv();
    expect(rotated).not.toBe(first);
    expect(rotated.webRefreshKeyring).toEqual({
      primary: { id: "key-b", secret: secondSecret },
      previous: [{ id: "key-a", secret: previousSecret }],
    });

    vi.stubEnv("NEXT_PUBLIC_BRAND_NAME", "Ignored ordinary mutation");
    expect(getEnv()).toBe(rotated);
    expect(getEnv().branding.name).toBe(first.branding.name);
  });

  it("deep-freezes both singleton and explicit test-factory results", () => {
    const env = createEnvForTests({
      ...process.env,
      NEXT_PUBLIC_BRAND_NAME: "Factory snapshot",
    });

    for (const value of [
      env,
      env.branding,
      env.remnawave,
      env.remnawave.subscriptionOrigins,
      env.webRefreshKeyring,
      env.webRefreshKeyring.primary,
      env.webRefreshKeyring.previous,
      env.paymentRedirectOrigins,
      env.telegramOidc,
      env.turnstile,
      env.support,
      env.readiness,
    ]) {
      expect(Object.isFrozen(value)).toBe(true);
    }

    expect(() => Object.assign(env.branding, { name: "mutated" }))
      .toThrow(TypeError);
  });

  it("keeps the explicit factory isolated from the singleton cache", () => {
    resetEnvForTests();
    const singleton = getEnv();
    const fixture = createEnvForTests({
      ...process.env,
      NEXT_PUBLIC_BRAND_NAME: "Isolated fixture",
    });

    expect(fixture).not.toBe(singleton);
    expect(fixture.branding.name).toBe("Isolated fixture");
    expect(getEnv()).toBe(singleton);
    expect(getEnv().branding.name).not.toBe("Isolated fixture");
  });

  it("does not expose factory or reset hooks outside a test runtime", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const productionModule = await import("@/backend/config/env");

    expect(() => productionModule.createEnvForTests()).toThrow(
      "createEnvForTests is available only when NODE_ENV=test",
    );
    expect(() => productionModule.resetEnvForTests()).toThrow(
      "resetEnvForTests is available only when NODE_ENV=test",
    );
  });
});

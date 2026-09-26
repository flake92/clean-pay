import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { logEventBus, type LogEvent } from "@/backend/observability/logger";
import { proxy } from "@/proxy";

function signedAccessToken() {
  const payload = Buffer.from(JSON.stringify({
    sid: "session-checked-by-the-server",
    uid: "user-1",
    exp: Math.floor(Date.now() / 1_000) + 60,
    ev: true,
    al: "FULL",
  })).toString("base64url");
  const signature = createHmac("sha256", "test-secret")
    .update(payload)
    .digest("base64url");

  return `${payload}.${signature}`;
}

describe("proxy access-log privacy", () => {
  const previousSecret = process.env.WEB_JWT_SECRET;

  beforeEach(() => {
    process.env.WEB_JWT_SECRET = "test-secret";
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.WEB_JWT_SECRET;
    else process.env.WEB_JWT_SECRET = previousSecret;
    vi.restoreAllMocks();
  });

  it("templates sensitive path segments and strips redirect query data before publishing", async () => {
    const referralCode = "ReferralCodeSecret42";
    const operationId = "cm0w7x8y90000abcdefghijkl";
    const paymentId = "dd66837a-4f64-4c60-8bca-0cbf55712abc";
    const events: LogEvent[] = [];
    const unsubscribe = logEventBus.subscribe((event) => events.push(event));

    try {
      const inviteResponse = await proxy(new NextRequest(
        `https://pay.example.com/invite/${referralCode}`,
      ));
      expect(inviteResponse.status).toBe(200);
      expect(inviteResponse.headers.get("x-middleware-next")).toBe("1");

      const operationResponse = await proxy(new NextRequest(
        `https://pay.example.com/operations/${operationId}`,
      ));
      const operationLocation = new URL(operationResponse.headers.get("location")!);
      expect(operationLocation.pathname).toBe("/login");
      expect(operationLocation.searchParams.get("redirect_to")).toBe(
        `/operations/${operationId}`,
      );

      const paymentResponse = await proxy(new NextRequest(
        `https://pay.example.com/api/payments/${paymentId}`,
      ));
      expect(paymentResponse.status).toBe(401);

      const destination = `/payment/pending?operation_id=${operationId}&payment_id=${paymentId}#resume`;
      const loginResponse = await proxy(new NextRequest(
        `https://pay.example.com/login?redirect_to=${encodeURIComponent(destination)}`,
        { headers: { cookie: `clean_pay_access=${signedAccessToken()}` } },
      ));
      const loginLocation = new URL(loginResponse.headers.get("location")!);
      expect(loginLocation.pathname).toBe("/payment/pending");
      expect(loginLocation.searchParams.get("operation_id")).toBe(operationId);
      expect(loginLocation.searchParams.get("payment_id")).toBe(paymentId);
      expect(loginLocation.hash).toBe("#resume");
    } finally {
      unsubscribe();
    }

    const accessEvents = events.filter((event) => event.source === "http.access");
    const serializedEvents = JSON.stringify(accessEvents);

    expect(accessEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: "GET /invite/:code received",
        metadata: expect.objectContaining({ pathname: "/invite/:code" }),
      }),
      expect.objectContaining({
        message: "GET /operations/:id received",
        metadata: expect.objectContaining({ pathname: "/operations/:id" }),
      }),
      expect.objectContaining({
        message: "GET /api/payments/:id received",
        metadata: expect.objectContaining({ pathname: "/api/payments/:id" }),
      }),
      expect.objectContaining({
        metadata: expect.objectContaining({
          action: "redirect_authenticated_user",
          pathname: "/login",
          redirectTo: "/payment/pending",
        }),
      }),
    ]));
    expect(serializedEvents).not.toContain(referralCode);
    expect(serializedEvents).not.toContain(operationId);
    expect(serializedEvents).not.toContain(paymentId);
  });
});

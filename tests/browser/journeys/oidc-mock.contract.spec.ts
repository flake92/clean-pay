import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import path from "node:path";

import { expect, test } from "@playwright/test";

const directory = path.resolve(__dirname);
const clientId = "7654321098";
const clientSecret = digest("clean-pay-browser-journey:telegram-oidc");
const ledgerKey = digest("clean-pay-browser-journey:oidc-ledger");
const redirectUri = "https://pay.ci.clean-pay.dev/auth/telegram/callback";

test("validates OIDC PKCE, Basic auth, redirect, single use, and sanitized ledger order", async () => {
  const [oidcPort, ledgerPort] = await freePorts(2);
  const events: unknown[] = [];
  const ledger = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    expect(request.headers["x-browser-fixture-key"]).toBe(ledgerKey);
    const raw = Buffer.concat(chunks).toString("utf8");
    expect(raw).not.toContain("synthetic-browser-pkce");
    expect(raw).not.toContain(clientSecret);
    events.push(JSON.parse(raw));
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"status":"recorded"}');
  });
  ledger.listen(ledgerPort, "127.0.0.1");
  await once(ledger, "listening");
  const child = spawn(process.execPath, [path.join(directory, "oidc-mock.mjs")], {
    env: {
      ...process.env,
      PORT: String(oidcPort),
      OIDC_ISSUER: `http://127.0.0.1:${oidcPort}`,
      OIDC_PUBLIC_ISSUER: `http://127.0.0.1:${oidcPort}`,
      OIDC_LEDGER_URL: `http://127.0.0.1:${ledgerPort}/event`,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.resume();
  child.stderr?.resume();
  try {
    const origin = `http://127.0.0.1:${oidcPort}`;
    await waitForOk(`${origin}/.well-known/jwks.json`);
    events.length = 0;
    const verifier = "synthetic-browser-pkce-verifier-00000000000000000000000000000000";
    const authorization = authorizationUrl(origin, verifier);
    const authorized = await fetch(authorization, { redirect: "manual" });
    expect(authorized.status).toBe(302);
    const callback = new URL(authorized.headers.get("location") as string);
    const code = callback.searchParams.get("code") as string;
    expect(callback.origin + callback.pathname).toBe(redirectUri);
    expect(callback.searchParams.get("state")).toBe("synthetic-state");

    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    });
    const token = await fetch(`${origin}/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: tokenBody,
    });
    expect(token.status).toBe(200);
    const tokenSet = await token.json() as { id_token: string };
    const claims = JSON.parse(Buffer.from(tokenSet.id_token.split(".")[1]!, "base64url").toString("utf8"));
    expect(claims).toMatchObject({
      aud: clientId,
      nonce: "synthetic-nonce",
      preferred_username: "browser_user_900000001",
    });

    const replay = await fetch(`${origin}/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: tokenBody,
    });
    expect(replay.status).toBe(400);
    expect(events.map((event) => (event as { effect: string }).effect)).toEqual([
      "authorization_code_issued",
      "token_exchanged",
      "token_exchange_rejected",
    ]);
    expect(JSON.stringify(events)).not.toMatch(/synthetic-state|synthetic-nonce|synthetic-browser-pkce/);
  } finally {
    await stopChild(child);
    ledger.close();
    await once(ledger, "close");
  }
});

test("rejects authorize and token contract near misses", async () => {
  const oidcPort = (await freePorts(1))[0]!;
  const child = spawn(process.execPath, [path.join(directory, "oidc-mock.mjs")], {
    env: {
      ...process.env,
      PORT: String(oidcPort),
      OIDC_ISSUER: `http://127.0.0.1:${oidcPort}`,
      OIDC_PUBLIC_ISSUER: `http://127.0.0.1:${oidcPort}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.resume();
  child.stderr?.resume();
  try {
    const origin = `http://127.0.0.1:${oidcPort}`;
    await waitForOk(`${origin}/.well-known/jwks.json`);
    const wrongScope = authorizationUrl(origin, "v".repeat(64));
    wrongScope.searchParams.set("scope", "openid");
    expect((await fetch(wrongScope, { redirect: "manual" })).status).toBe(400);
    const wrongMethod = authorizationUrl(origin, "v".repeat(64));
    wrongMethod.searchParams.set("code_challenge_method", "plain");
    expect((await fetch(wrongMethod, { redirect: "manual" })).status).toBe(400);
  } finally {
    await stopChild(child);
  }
});

function authorizationUrl(origin: string, verifier: string) {
  const value = new URL("/auth", origin);
  value.searchParams.set("response_type", "code");
  value.searchParams.set("client_id", clientId);
  value.searchParams.set("redirect_uri", redirectUri);
  value.searchParams.set("scope", "openid profile");
  value.searchParams.set("state", "synthetic-state");
  value.searchParams.set("nonce", "synthetic-nonce");
  value.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
  value.searchParams.set("code_challenge_method", "S256");
  value.searchParams.set("test_user", "900000001");
  return value;
}

async function freePorts(count: number) {
  const ports: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const server = createNetServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not allocate port.");
    ports.push(address.port);
    server.close();
    await once(server, "close");
  }
  return ports;
}

async function waitForOk(url: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Child may still be binding its socket.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Fixture did not become ready: ${url}`);
}

async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 2_000))]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

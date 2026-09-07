import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as netServer } from "node:net";
import { createServer as httpServer } from "node:http";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  allocateDistinctFixturePorts as ports,
  observeFixtureChild as observe,
  waitForFixtureOk as ready,
  stopFixtureChild as stop,
} from "./fixture-process-lifecycle.mjs";

const codeChild = (code, label = "test-child") => observe(spawn(process.execPath, ["-e", code], {
  stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
}), label);
const fixture = (file, env) => observe(spawn(process.execPath, [fileURLToPath(new URL(file, import.meta.url))], {
  env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
}), file);
const origin = (port) => `http://127.0.0.1:${port}`;
const hash = (s) => createHash("sha256").update(s).digest("hex");
async function bind(server) {
  const listening = once(server, "listening"); server.listen(0, "127.0.0.1");
  await listening; return server.address().port;
}
async function close(server) {
  server.closeAllConnections?.();
  if (server.listening) await new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
}
async function expectFailure(promise, check) {
  await assert.rejects(promise, (error) => { check(error); return true; });
}

export const fixtureLifecycleCases = [
  {
    name: "fixture lifecycle keeps earlier reservations bound while selecting the next port",
    async run() {
      const opened = [];
      const chosen = await ports(4, { createServer() {
        assert.ok(opened.every((s) => s.listening), "Earlier ports must still be reserved");
        const s = netServer(); opened.push(s); return s;
      } });
      assert.equal(new Set(chosen).size, 4);
      assert.ok(opened.every((s) => !s.listening), "All reservations must be released afterwards");
    },
  },
  {
    name: "fixture lifecycle releases prior sockets when a later bind fails",
    async run() {
      const opened = [];
      await assert.rejects(ports(4, { createServer() {
        const s = netServer(); opened.push(s);
        if (opened.length === 3) s.listen = () => {
          queueMicrotask(() => s.emit("error", Object.assign(new Error("occupied"), { code: "EADDRINUSE" })));
          return s;
        };
        return s;
      } }), { code: "EADDRINUSE" });
      assert.ok(opened.every((s) => !s.listening));
    },
  },
  {
    name: "fixture lifecycle rejects invalid port counts without opening a socket",
    async run() {
      for (const n of [0, -1, 1.5, 17, NaN, Infinity, "4", null]) {
        await assert.rejects(ports(n, { createServer() { assert.fail("Must not bind"); } }));
      }
    },
  },
  {
    name: "fixture lifecycle allocates 2500 distinct four-port batches",
    async run() {
      for (let i = 0; i < 2500; i++) assert.equal(new Set(await ports(4)).size, 4);
    },
  },
  {
    name: "fixture lifecycle rejects a duplicated address returned by a broken allocator",
    async run() {
      const opened = []; let first;
      await assert.rejects(ports(2, { createServer() {
        const s = netServer(); opened.push(s); const actual = s.address.bind(s);
        s.address = () => { const value = actual(); first ??= value; return first; };
        return s;
      } }), /distinct TCP ports/);
      assert.ok(opened.every((s) => !s.listening));
    },
  },
  {
    name: "fixture lifecycle starts the actual provider and validates inbox credentials 30 times",
    async run() {
      for (let i = 0; i < 30; i++) {
        const [shop, wave, control] = await ports(3);
        const child = fixture("provider-mock.mjs", {
          REMNASHOP_PORT: String(shop), REMNAWAVE_PORT: String(wave), CONTROL_PORT: String(control),
          CLEAN_PAY_BROWSER_CHATWOOT_CONTACT_RESPONSE_DELAY_MS: "75",
          CLEAN_PAY_BROWSER_CHATWOOT_PRE_CABINET_CONTACT_RESPONSE_DELAY_MS: "75",
        });
        try {
          await ready(`${origin(control)}/__health`, { children: [child] });
          const conversation = "csyntheticbrowserjourney01";
          const token = hash("clean-pay-browser-journey:chatwoot-website");
          const before = performance.now();
          const res = await fetch(`${origin(control)}/api/v1/widget/contact?website_token=${token}`, {
            headers: { "x-auth-token": conversation }, signal: AbortSignal.timeout(3000),
          });
          assert.equal(res.status, 200);
          assert.deepEqual(await res.json(), { identifier: conversation });
          assert.ok(performance.now() - before >= 50);
          const rejected = await fetch(`${origin(control)}/api/v1/widget/contact?website_token=wrong`, {
            headers: { "x-auth-token": conversation }, signal: AbortSignal.timeout(3000),
          });
          assert.equal(rejected.status, 401); await rejected.body?.cancel();
          const ledgerResponse = await fetch(`${origin(control)}/__ledger`, { signal: AbortSignal.timeout(3000) });
          const ledger = await ledgerResponse.json();
          assert.deepEqual(ledger.entries.map((e) => e.effect), ["contact_identity_probed", "contact_identity_probe_rejected"]);
          assert.ok(!JSON.stringify(ledger).includes(conversation));
          assert.ok(!JSON.stringify(ledger).includes(token));
        } finally { await stop(child); }
      }
    },
  },
  {
    name: "fixture lifecycle starts the actual OIDC mock with bounded JWKS readiness",
    async run() {
      const [port] = await ports(1);
      const child = fixture("oidc-mock.mjs", { PORT: String(port), OIDC_ISSUER: origin(port), OIDC_PUBLIC_ISSUER: origin(port) });
      try { await ready(`${origin(port)}/.well-known/jwks.json`, { children: [child] }); }
      finally { await stop(child); }
    },
  },
  {
    name: "fixture lifecycle exposes EADDRINUSE when two provider roles use one port",
    async run() {
      const [same, wave] = await ports(2);
      const child = fixture("provider-mock.mjs", { REMNASHOP_PORT: String(same), REMNAWAVE_PORT: String(wave), CONTROL_PORT: String(same) });
      const started = performance.now();
      try {
        await expectFailure(ready(`${origin(same)}/__health`, { children: [child] }), (e) => {
          assert.equal(e.evidence.reason, "child-stopped");
          assert.ok(e.evidence.children[0].errorCodes.includes("EADDRINUSE"));
        });
        assert.ok(performance.now() - started < 4000, "Do not poll a dead process for ten seconds");
      } finally { await stop(child); }
    },
  },
  {
    name: "fixture lifecycle detects an externally occupied port without retrying the child",
    async run() {
      const blocker = netServer(); const occupied = await bind(blocker);
      const [wave, control] = await ports(2);
      const child = fixture("provider-mock.mjs", { REMNASHOP_PORT: String(occupied), REMNAWAVE_PORT: String(wave), CONTROL_PORT: String(control) });
      try {
        await once(child, "close");
        await expectFailure(ready(`${origin(control)}/__health`, { children: [child] }), (e) => {
          assert.ok(e.evidence.children[0].errorCodes.includes("EADDRINUSE"));
          assert.equal(e.evidence.attempts, 0);
        });
      } finally { await stop(child); await close(blocker); }
    },
  },
  {
    name: "fixture lifecycle preserves HTTP failure status and never calls it ready",
    async run() {
      const server = httpServer((_q, r) => { r.writeHead(503); r.end("not ready"); });
      const port = await bind(server); const child = codeChild("setInterval(() => {}, 1000)");
      try {
        await expectFailure(ready(`${origin(port)}/__health`, { children: [child], timeoutMs: 250, attemptTimeoutMs: 100 }), (e) => {
          assert.equal(e.evidence.reason, "deadline-exceeded"); assert.equal(e.evidence.lastHttpStatus, 503);
        });
      } finally { await stop(child); await close(server); }
    },
  },
  {
    name: "fixture lifecycle bounds a health connection that never sends HTTP headers",
    async run() {
      const server = httpServer(() => {}); const port = await bind(server);
      const child = codeChild("setInterval(() => {}, 1000)"); const started = performance.now();
      try {
        await expectFailure(ready(`${origin(port)}/__health`, { children: [child], timeoutMs: 250, attemptTimeoutMs: 70 }), (e) => {
          assert.equal(e.evidence.reason, "deadline-exceeded"); assert.equal(e.evidence.lastTransportCode, "ABORT_ERR");
        });
        assert.ok(performance.now() - started < 1500);
      } finally { await stop(child); await close(server); }
    },
  },
  {
    name: "fixture lifecycle does not follow a readiness redirect to another endpoint",
    async run() {
      let redirected = false;
      const server = httpServer((q, r) => {
        if (q.url === "/other") { redirected = true; r.end("ok"); }
        else { r.writeHead(302, { Location: "/other" }); r.end(); }
      });
      const port = await bind(server); const child = codeChild("setInterval(() => {}, 1000)");
      try {
        await expectFailure(ready(`${origin(port)}/__health`, { children: [child], timeoutMs: 180, attemptTimeoutMs: 100 }), (e) => assert.equal(e.evidence.lastHttpStatus, 302));
        assert.equal(redirected, false);
      } finally { await stop(child); await close(server); }
    },
  },
  {
    name: "fixture lifecycle fails on a dead owner even when a different server returns 200",
    async run() {
      let requests = 0; const server = httpServer((_q, r) => { requests++; r.end("ok"); });
      const port = await bind(server); const child = codeChild("process.exit(7)");
      try {
        await once(child, "close");
        await expectFailure(ready(`${origin(port)}/__health`, { children: [child] }), (e) => {
          assert.equal(e.evidence.children[0].exitCode, 7); assert.equal(e.evidence.attempts, 0);
        });
        assert.equal(requests, 0);
      } finally { await stop(child); await close(server); }
    },
  },
  {
    name: "fixture lifecycle reports missing executables without exposing raw error paths",
    async run() {
      const child = observe(spawn("/no-such-clean-pay-fixture/secret-executable", [], { stdio: ["ignore", "pipe", "pipe"] }), "missing-fixture");
      try {
        await new Promise((r) => child.once("close", r));
        await expectFailure(ready("http://127.0.0.1:12345/__health", { children: [child] }), (e) => {
          assert.equal(e.evidence.children[0].spawnFailed, true);
          assert.ok(e.evidence.children[0].errorCodes.includes("ENOENT"));
          assert.ok(!e.message.includes("secret-executable")); assert.equal(e.cause, undefined);
        });
      } finally { await stop(child); }
    },
  },
  {
    name: "fixture lifecycle diagnostics retain error codes but not stderr secrets",
    async run() {
      const secret = "unique-do-not-export-credential";
      const child = codeChild(`process.stderr.write('EADDRINUSE token=${secret}\\n'); process.exitCode=2;`);
      try {
        await once(child, "close");
        await expectFailure(ready("http://127.0.0.1:12345/__health", { children: [child] }), (e) => {
          assert.ok(e.evidence.children[0].errorCodes.includes("EADDRINUSE"));
          assert.ok(!JSON.stringify(e.evidence).includes(secret)); assert.ok(!e.message.includes(secret));
        });
      } finally { await stop(child); }
    },
  },
  {
    name: "fixture lifecycle rejects unsafe health targets and unbounded deadlines",
    async run() {
      const child = codeChild("setInterval(() => {}, 1000)");
      try {
        for (const url of ["https://127.0.0.1:12345/__health", "http://example.com:12345/__health", "http://secret@127.0.0.1:12345/__health", "http://127.0.0.1:12345/__health?token=secret", "http://127.0.0.1:12345/other"]) {
          await assert.rejects(ready(url, { children: [child] }), /exact loopback health endpoint/);
        }
        await assert.rejects(ready("http://127.0.0.1:12345/__health", { children: [child], timeoutMs: 10001 }), /bounded/);
        await assert.rejects(ready("http://127.0.0.1:12345/__health", { children: [] }), /owned children/);
      } finally { await stop(child); }
    },
  },
  {
    name: "fixture lifecycle accepts response headers without waiting for an infinite body",
    async run() {
      const server = httpServer((_q, r) => { r.writeHead(200); r.write("{"); });
      const port = await bind(server); const child = codeChild("setInterval(() => {}, 1000)");
      try { await ready(`${origin(port)}/__health`, { children: [child], timeoutMs: 1000, attemptTimeoutMs: 200 }); }
      finally { await stop(child); await close(server); }
    },
  },
  {
    name: "fixture lifecycle confirms child closure and permits idempotent cleanup",
    async run() {
      const child = codeChild("setInterval(() => {}, 1000)");
      await stop(child); assert.ok(child.exitCode !== null || child.signalCode !== null);
      await stop(child);
    },
  },
];

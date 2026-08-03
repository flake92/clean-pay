import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { createSession, csrfToken, readSession, verifyCsrf, verifyPassword } from "../src/auth.mjs";

function hash(password) {
  const salt = randomBytes(16);
  const value = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${value.toString("base64url")}`;
}

test("password verification accepts only the matching password", () => {
  const encoded = hash("correct horse battery staple");
  assert.equal(verifyPassword("correct horse battery staple", encoded), true);
  assert.equal(verifyPassword("incorrect", encoded), false);
  assert.equal(verifyPassword("anything", "invalid"), false);
});

test("signed sessions expire and cannot be changed", () => {
  const secret = "x".repeat(64);
  const accounts = [{ login: "lopez" }];
  const token = createSession("lopez", secret, 1_000_000);
  assert.equal(readSession(token, accounts, secret, 1_001_000)?.login, "lopez");
  assert.equal(readSession(`${token}x`, accounts, secret, 1_001_000), null);
  assert.equal(readSession(token, accounts, secret, 1_000_000 + 9 * 60 * 60_000), null);
});

test("csrf tokens are bound to a session", () => {
  const secret = "y".repeat(64);
  const token = "session-one";
  const csrf = csrfToken(token, secret);
  assert.equal(verifyCsrf(csrf, token, secret), true);
  assert.equal(verifyCsrf(csrf, "session-two", secret), false);
});

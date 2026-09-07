import assert from "node:assert/strict";

import { chromium, test } from "@playwright/test";

import type { NetworkManifestEntry } from "../network-recorder";
import { canonicalizeUrl, digestValue } from "../redaction";
import {
  assertLinkedEmailSubmissionNetwork,
  captureAfterScreenshot,
  isLinkedEmailSubmissionRequest,
} from "./browser-observation-boundaries";

const submission = {
  url: "https://pay.ci.clean-pay.dev/link-account?reason=email-required",
  email: "linked-email-existing@clean-pay.dev",
  password: "wrong-password",
};
const payload = JSON.stringify([{ email: submission.email, password: submission.password }]);
const actionId = "a".repeat(40);
const ids = Array.from({ length: 11 }, () => actionId);
const requestFixture = (overrides: Partial<Parameters<typeof isLinkedEmailSubmissionRequest>[0]> = {}) => ({
  method: () => "POST",
  url: () => submission.url,
  headers: () => ({ "next-action": actionId }),
  postData: () => payload,
  ...overrides,
});
function entry(index: number, id = actionId, body = payload): NetworkManifestEntry {
  return {
    index, method: "POST", url: canonicalizeUrl(submission.url, new URL(submission.url).origin),
    scope: "application", resourceType: "fetch", navigation: false,
    serverAction: { present: true, identifier: digestValue(id) }, requestHeaders: [],
    postData: digestValue(body), redirectedFrom: null, failure: null, externalTransport: null,
    response: { status: 200, statusText: "OK", fromServiceWorker: false, headers: [] },
  };
}
const networkFixture = () => Array.from({ length: 11 }, (_, index) => entry(index));

test("observation boundary matches only the exact linked-email form payload", () => {
  assert.equal(isLinkedEmailSubmissionRequest(requestFixture(), submission), true);
  assert.equal(isLinkedEmailSubmissionRequest(requestFixture({ postData: () => '["synthetic-user"]' }), submission), false);
});

test("observation boundary rejects other request methods, URLs and payloads", () => {
  for (const overrides of [
    { method: () => "GET" }, { url: () => "https://example.invalid/link-account" },
    { url: () => submission.url + "&extra=1" }, { headers: () => ({}) },
    { postData: () => null }, { postData: () => "[]" },
    { postData: () => JSON.stringify([{ email: submission.email, password: "changed" }]) },
    { postData: () => JSON.stringify([{ email: submission.email, password: submission.password, extra: true }]) },
  ]) assert.equal(isLinkedEmailSubmissionRequest(requestFixture(overrides), submission), false);
});

test("observation boundary preserves background actions but counts exactly eleven form submissions", () => {
  const network = networkFixture();
  network.splice(6, 0, entry(99, "b".repeat(40), '["synthetic-user"]'));
  const before = structuredClone(network);
  assert.equal(assertLinkedEmailSubmissionNetwork(network, ids, submission).length, 11);
  assert.equal(network.length, 12);
  assert.deepEqual(network, before);
});

for (const count of [10, 12]) {
  test(`observation boundary rejects ${count} form submissions`, () => {
    const network = Array.from({ length: count }, (_, index) => entry(index));
    assert.throws(() => assertLinkedEmailSubmissionNetwork(network, ids, submission));
  });
}

test("observation boundary rejects changed payloads of the same form action", () => {
  const network = networkFixture();
  network[4] = entry(4, actionId, '[{"email":"changed","password":"changed"}]');
  assert.throws(() => assertLinkedEmailSubmissionNetwork(network, ids, submission));
});

test("observation boundary rejects a second action carrying the form payload", () => {
  const network = networkFixture();
  network[4] = entry(4, "b".repeat(40));
  assert.throws(() => assertLinkedEmailSubmissionNetwork(network, ids, submission));
});

test("observation boundary rejects inconsistent or missing observed action identifiers", () => {
  for (const observed of [ids.slice(1), [...ids, actionId], [...ids.slice(1), ""], [...ids.slice(1), "other"]]) {
    assert.throws(() => assertLinkedEmailSubmissionNetwork(networkFixture(), observed, submission));
  }
});

test("observation boundary keeps exact response, endpoint and scope checks", () => {
  for (const override of [
    { method: "GET" }, { scope: "external" as const },
    { url: canonicalizeUrl("/profile", new URL(submission.url).origin) },
    { response: null }, { response: { ...entry(0).response!, status: 500 } },
  ]) {
    const network = networkFixture();
    network[0] = { ...network[0]!, ...override };
    assert.throws(() => assertLinkedEmailSubmissionNetwork(network, ids, submission));
  }
});

test("observation boundary does not start readers until screenshot cleanup resolves", async () => {
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const result = captureAfterScreenshot({ screenshot: async (options) => {
    assert.deepEqual(options, { animations: "disabled", caret: "hide", fullPage: false, type: "png" });
    order.push("screenshot-start");
    await gate;
    order.push("screenshot-cleanup");
    return Buffer.from("png");
  } }, async () => { order.push("read"); return "DOM"; });
  await Promise.resolve();
  assert.deepEqual(order, ["screenshot-start"]);
  release();
  assert.deepEqual(await result, { screenshot: Buffer.from("png"), evidence: "DOM" });
  assert.deepEqual(order, ["screenshot-start", "screenshot-cleanup", "read"]);
});

test("observation boundary propagates screenshot errors without reading", async () => {
  let read = false;
  await assert.rejects(captureAfterScreenshot({ screenshot: async () => { throw new Error("screenshot failed"); } }, async () => { read = true; }), /screenshot failed/);
  assert.equal(read, false);
});

test("observation boundary propagates evidence read failures", async () => {
  await assert.rejects(captureAfterScreenshot({ screenshot: async () => Buffer.from("png") }, async () => { throw new Error("read failed"); }), /read failed/);
});

test("observation boundary keeps DOM and styles stable after real Chromium screenshots twenty times", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<label>E-mail<input value="synthetic"></label><p>unchanged</p>');
    await page.locator("input").focus();
    const read = () => page.evaluate(() => ({ dom: document.documentElement.outerHTML, caret: getComputedStyle(document.querySelector("input")!).caretColor }));
    for (let repetition = 0; repetition < 20; repetition += 1) {
      const { screenshot, evidence } = await captureAfterScreenshot(page, read);
      assert.ok(screenshot.byteLength > 0);
      assert.deepEqual(evidence, await read());
      assert.ok(!evidence.dom.includes("caret-color: transparent"));
    }
  } finally { await browser.close(); }
});

test("observation boundary does not erase a genuine DOM change", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<input value="synthetic"><p>before</p>');
    const read = () => page.content();
    const { evidence } = await captureAfterScreenshot(page, read);
    await page.locator("p").evaluate((element) => { element.textContent = "after"; });
    assert.notEqual(evidence, await read());
  } finally { await browser.close(); }
});

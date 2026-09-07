import { isDeepStrictEqual } from "node:util";

import type { Page, Request } from "@playwright/test";

import type { NetworkManifestEntry } from "../network-recorder";
import { canonicalizeUrl, digestValue } from "../redaction";

export type LinkedEmailSubmission = Readonly<{
  url: string;
  email: string;
  password: string;
}>;

type SubmissionRequest = Pick<Request, "method" | "url" | "headers" | "postData">;

function submissionBody(expected: LinkedEmailSubmission) {
  return JSON.stringify([{ email: expected.email, password: expected.password }]);
}

// Match the form submission, not another action that happens to use the same URL.
// The opaque action identifier is observed from this build, never hard-coded.
export function isLinkedEmailSubmissionRequest(
  request: SubmissionRequest,
  expected: LinkedEmailSubmission,
) {
  const actionId = request.headers()["next-action"];
  return request.method() === "POST"
    && request.url() === expected.url
    && typeof actionId === "string"
    && actionId.length > 0
    && request.postData() === submissionBody(expected);
}

export function assertLinkedEmailSubmissionNetwork(
  network: readonly NetworkManifestEntry[],
  observedActionIds: readonly string[],
  expected: LinkedEmailSubmission,
) {
  if (observedActionIds.length !== 11
    || observedActionIds.some((id) => typeof id !== "string" || id.length === 0)
    || new Set(observedActionIds).size !== 1) {
    throw new Error("Linked e-mail submissions did not resolve to one action in eleven attempts.");
  }
  const identifier = digestValue(observedActionIds[0]!);
  const payload = digestValue(submissionBody(expected));
  const expectedUrl = canonicalizeUrl(expected.url, new URL(expected.url).origin);
  // Keep every call of the observed form action, including malformed/duplicate
  // calls, and any second action carrying the form payload. Background actions
  // stay in the unmodified full network ledger, outside this form-only proof.
  const actions = network.filter((entry) => entry.serverAction.present && (
    entry.serverAction.identifier?.sha256 === identifier.sha256
    || entry.postData?.sha256 === payload.sha256
  ));
  if (actions.length !== 11 || actions.some((entry) => (
    entry.scope !== "application"
    || entry.method !== "POST"
    || !isDeepStrictEqual(entry.url, expectedUrl)
    || !isDeepStrictEqual(entry.serverAction.identifier, identifier)
    || !isDeepStrictEqual(entry.postData, payload)
    || entry.response === null
    || entry.response.status < 200
    || entry.response.status >= 300
  ))) {
    throw new Error("Linked e-mail action network differs from its exact eleven-submission contract.");
  }
  return actions;
}

// Playwright may temporarily change caret styles/animation state for a screenshot.
// Do not start DOM, style or accessibility readers until screenshot cleanup ends.
export async function captureAfterScreenshot<T>(
  page: Pick<Page, "screenshot">,
  read: () => Promise<T>,
): Promise<{ screenshot: Buffer; evidence: T }> {
  const screenshot = await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    type: "png",
  });
  return { screenshot, evidence: await read() };
}

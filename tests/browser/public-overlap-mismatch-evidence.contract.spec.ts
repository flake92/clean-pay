import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  PUBLIC_OVERLAP_PROJECTED_MISMATCH_FILENAME,
  assertPublicOverlapProjectedMismatchEvidence,
  createPublicOverlapProjectedMismatchMarker,
  extractPublicOverlapProjectedMismatchEvidence,
} from "./public-overlap-mismatch-evidence.mjs";

const privateMarker = "person@example.invalid bearer-private-marker";

test("projects an unequal manifest pair to bounded field-only mismatch evidence", () => {
  const expected = manifestBytes({
    route: { finalStatus: 200 },
    network: { requests: [{ response: { fromServiceWorker: false } }] },
  });
  const actual = manifestBytes({
    route: { finalStatus: 200 },
    network: { requests: [{ response: { fromServiceWorker: true } }, {}] },
  });
  const marker = createPublicOverlapProjectedMismatchMarker(
    "chromium-390x844/install",
    expected,
    actual,
  );
  const stdout = Buffer.from(`${privateMarker}\nError: ${marker}\n`, "utf8");
  const evidence = extractPublicOverlapProjectedMismatchEvidence(stdout, Buffer.alloc(0));

  expect(evidence).toEqual({
    schemaVersion: 1,
    status: "public_overlap_projected_manifest_mismatch",
    case: "chromium-390x844/install",
    differingPaths: [
      "$.network.requests.length",
      "$.network.requests[0].response.fromServiceWorker",
    ],
    expectedProjectedSha256: sha256(expected),
    actualProjectedSha256: sha256(actual),
  });
  expect(JSON.stringify(evidence)).not.toContain(privateMarker);
  expect(Object.isFrozen(evidence)).toBe(true);
  expect(Object.isFrozen(evidence?.differingPaths)).toBe(true);
  expect(PUBLIC_OVERLAP_PROJECTED_MISMATCH_FILENAME)
    .toBe("public-comparison-mismatch.json");
});

test("accepts repeated reporter copies only when their exact mismatch token agrees", () => {
  const expected = manifestBytes({ dom: "baseline" });
  const actual = manifestBytes({ dom: "candidate" });
  const marker = createPublicOverlapProjectedMismatchMarker(
    "chromium-1440x900/login",
    expected,
    actual,
  );
  expect(extractPublicOverlapProjectedMismatchEvidence(
    Buffer.from(`${marker}\n${marker}\n`, "utf8"),
    Buffer.alloc(0),
  )).toMatchObject({
    case: "chromium-1440x900/login",
    differingPaths: ["$.dom"],
  });

  const other = createPublicOverlapProjectedMismatchMarker(
    "chromium-1440x900/register",
    expected,
    actual,
  );
  expect(() => extractPublicOverlapProjectedMismatchEvidence(
    Buffer.from(`${marker}\n${other}\n`, "utf8"),
    Buffer.alloc(0),
  )).toThrow("conflicting mismatch evidence");
});

test("fails closed for equal inputs, unknown cases and adversarial evidence", () => {
  const bytes = manifestBytes({ dom: "same" });
  expect(() => createPublicOverlapProjectedMismatchMarker(
    "chromium-390x844/install",
    bytes,
    bytes,
  )).toThrow("requires unequal projected manifests");
  expect(() => createPublicOverlapProjectedMismatchMarker(
    "chromium-390x844/private-route",
    manifestBytes({ dom: "a" }),
    manifestBytes({ dom: "b" }),
  )).toThrow("case is invalid");
  expect(() => extractPublicOverlapProjectedMismatchEvidence(
    Buffer.from("CLEAN_PAY_PUBLIC_OVERLAP_PROJECTED_MISMATCH:not-base64", "utf8"),
    Buffer.alloc(0),
  )).toThrow("mismatch evidence is invalid");

  expect(() => assertPublicOverlapProjectedMismatchEvidence({
    schemaVersion: 1,
    status: "public_overlap_projected_manifest_mismatch",
    case: "chromium-390x844/install",
    differingPaths: ["$.browserState.cookies.person@example.invalid"],
    expectedProjectedSha256: "a".repeat(64),
    actualProjectedSha256: "b".repeat(64),
  })).toThrow("paths are invalid");

  const forged = {
    schemaVersion: 1,
    status: "public_overlap_projected_manifest_mismatch",
    case: "chromium-390x844/install",
    differingPaths: ["$.BearerPrivateMarker"],
    expectedProjectedSha256: "a".repeat(64),
    actualProjectedSha256: "b".repeat(64),
  };
  expect(() => assertPublicOverlapProjectedMismatchEvidence(forged))
    .toThrow("paths are invalid");
  const forgedToken = Buffer.from(JSON.stringify(forged), "utf8").toString("base64url");
  expect(() => extractPublicOverlapProjectedMismatchEvidence(
    Buffer.from(`CLEAN_PAY_PUBLIC_OVERLAP_PROJECTED_MISMATCH:${forgedToken}`, "utf8"),
    Buffer.alloc(0),
  )).toThrow("paths are invalid");

  const secretKeyMarker = createPublicOverlapProjectedMismatchMarker(
    "chromium-768x1024/support",
    manifestBytes({ [privateMarker]: "before" }),
    manifestBytes({ [privateMarker]: "after" }),
  );
  expect(secretKeyMarker).not.toContain(privateMarker);
  expect(extractPublicOverlapProjectedMismatchEvidence(
    Buffer.from(secretKeyMarker, "utf8"),
    Buffer.alloc(0),
  )?.differingPaths).toEqual(["$.field"]);
});

function manifestBytes(value: unknown) {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

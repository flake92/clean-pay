import { randomBytes } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { BEHAVIORAL_BASELINE_COMMIT } from "./baseline-policy";
import {
  PUBLIC_OVERLAP_CAPTURE_POLICY,
  PUBLIC_OVERLAP_PROJECTS,
  PUBLIC_OVERLAP_ROUTES,
  type PreparedCaptureOwnership,
  cleanupPreparedCapturePair,
  createExactEphemeralCapturePolicy,
  prepareExactCapturePair,
  resolveExactCaptureRoot,
  sealExactCapture,
  sha256,
  writeImmutableCaptureArtifact,
} from "./public-overlap-evidence";
import { provePublicCharacterizationOverlap } from "./public-overlap-proof";
import { digestValue } from "./redaction";

test("defines the exact reusable 42-case/126-artifact public capture ledger", () => {
  expect(PUBLIC_OVERLAP_CAPTURE_POLICY.caseCount).toBe(42);
  expect(PUBLIC_OVERLAP_CAPTURE_POLICY.artifactPaths).toHaveLength(126);
  expect(new Set(PUBLIC_OVERLAP_CAPTURE_POLICY.artifactPaths).size).toBe(126);
  expect(() => createExactEphemeralCapturePolicy({
    artifactPaths: ["case/viewport.png", "case/viewport.png"],
    caseCount: 1,
    maximumArtifactBytes: 1024,
    suite: "journey-pair-v1",
  })).toThrow("must be unique");
  expect(createExactEphemeralCapturePolicy({
    artifactPaths: ["checkpoint-a/viewport.png", "checkpoint-b/viewport.png"],
    caseCount: 2,
    maximumArtifactBytes: 1024,
    suite: "journey-pair-v1",
  })).toEqual({
    artifactPaths: ["checkpoint-a/viewport.png", "checkpoint-b/viewport.png"],
    caseCount: 2,
    maximumArtifactBytes: 1024,
    suite: "journey-pair-v1",
  });
  expect(() => createExactEphemeralCapturePolicy({
    artifactPaths: Array.from(
      { length: 513 },
      (_, index) => `checkpoint-${index}/viewport.png`,
    ),
    caseCount: 1,
    maximumArtifactBytes: 1024,
    suite: "journey-pair-v1",
  })).toThrow("ownership artifact path ledger is invalid");
});

test("requires consecutive terminal PNG evidence in canonical and live capture", async () => {
  for (const sourcePath of [
    "tests/browser/page-characterization.ts",
    "tests/browser/public-overlap-capture.ts",
  ]) {
    const source = await readFile(sourcePath, "utf8");
    expect(source, sourcePath).toContain(
      "captureByteIdenticalTerminalScreenshot(page)",
    );
    expect(source, sourcePath).not.toContain(
      "const screenshot = await page.screenshot",
    );
  }
});

test("seals and proves exact dual-origin public evidence without baseline writes", async () => {
  const captureId = randomBytes(8).toString("hex");
  const baselineOrigin = "http://127.0.0.1:4201";
  const candidateOrigin = "http://127.0.0.1:4202";
  const baselineBinding = "1".repeat(64);
  const candidateBinding = "2".repeat(64);
  const prepared = await prepareExactCapturePair({
    baselineBindingSha256: baselineBinding,
    candidateBindingSha256: candidateBinding,
    captureId,
  });
  try {
    await populateCapture(prepared.roles.baseline, baselineOrigin);
    await populateCapture(prepared.roles.candidate, candidateOrigin);
    await sealExactCapture({
      applicationOrigin: baselineOrigin,
      bindingSha256: baselineBinding,
      captureId,
      ownershipSha256: prepared.roles.baseline.receiptSha256,
      role: "baseline",
    });
    await sealExactCapture({
      applicationOrigin: candidateOrigin,
      bindingSha256: candidateBinding,
      captureId,
      ownershipSha256: prepared.roles.candidate.receiptSha256,
      role: "candidate",
    });

    const proof = await provePublicCharacterizationOverlap({
      CLEAN_PAY_PUBLIC_OVERLAP_CAPTURE_ID: captureId,
      CLEAN_PAY_PUBLIC_OVERLAP_BASELINE_ORIGIN: baselineOrigin,
      CLEAN_PAY_PUBLIC_OVERLAP_CANDIDATE_ORIGIN: candidateOrigin,
      CLEAN_PAY_PUBLIC_OVERLAP_BASELINE_BINDING_SHA256: baselineBinding,
      CLEAN_PAY_PUBLIC_OVERLAP_CANDIDATE_BINDING_SHA256: candidateBinding,
      CLEAN_PAY_PUBLIC_OVERLAP_BASELINE_OWNERSHIP_SHA256:
        prepared.roles.baseline.receiptSha256,
      CLEAN_PAY_PUBLIC_OVERLAP_CANDIDATE_OWNERSHIP_SHA256:
        prepared.roles.candidate.receiptSha256,
    });

    expect(proof.receipt.caseCount).toBe(42);
    expect(proof.receipt.artifactCountPerSide).toBe(126);
    expect(Object.keys(proof.receipt).sort()).toEqual([
      "artifactCountPerSide",
      "baseline",
      "candidate",
      "captureId",
      "caseCount",
      "comparisonSha256",
      "kind",
      "schemaVersion",
      "status",
      "suite",
    ]);
    expect(proof.receiptBytes.toString("utf8")).not.toContain("<html");
    expect(proof.receiptBytes.toString("utf8")).not.toContain("requestHeaders");
  } finally {
    await cleanupPreparedCapturePair({
      captureId,
      pairReceiptSha256: prepared.pairReceiptSha256,
    });
  }
});

test("rejects an incomplete or extra generic capture inventory before a receipt exists", async () => {
  const captureId = randomBytes(8).toString("hex");
  const root = resolveExactCaptureRoot(captureId, "baseline");
  const extra = path.join(root, "artifacts", "case-a", "extra.png");
  const policy = createExactEphemeralCapturePolicy({
    artifactPaths: ["case-a/viewport.png"],
    caseCount: 1,
    maximumArtifactBytes: 1024,
    suite: "journey-pair-v1",
  });
  const prepared = await prepareExactCapturePair({
    baselineBindingSha256: "1".repeat(64),
    candidateBindingSha256: "2".repeat(64),
    captureId,
    policy,
  });
  try {
    await writeImmutableCaptureArtifact({
      bytes: Buffer.from("expected"),
      ownership: prepared.roles.baseline,
      policy,
      relativePath: "case-a/viewport.png",
      root,
    });
    await writeFile(extra, "unexpected");

    await expect(sealExactCapture({
      applicationOrigin: "http://127.0.0.1:4201",
      bindingSha256: "1".repeat(64),
      captureId,
      ownershipSha256: prepared.roles.baseline.receiptSha256,
      policy,
      role: "baseline",
    })).rejects.toThrow("contains too many artifacts");
  } finally {
    await unlink(extra).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    await cleanupPreparedCapturePair({
      captureId,
      pairReceiptSha256: prepared.pairReceiptSha256,
      policy,
    });
  }
});

async function populateCapture(
  ownership: PreparedCaptureOwnership,
  applicationOrigin: string,
) {
  const root = ownership.root;
  for (const project of PUBLIC_OVERLAP_PROJECTS) {
    const [width, height] = project === "chromium-390x844"
      ? [390, 844]
      : project === "chromium-768x1024" ? [768, 1024] : [1440, 900];
    const png = syntheticPng(width, height);
    for (const route of PUBLIC_OVERLAP_ROUTES) {
      const directory = `${project}/${route.id}`;
      const manifest = Buffer.from(`${JSON.stringify(
        characterizationManifest(project, route, applicationOrigin, png),
        null,
        2,
      )}\n`, "utf8");
      const consoleSidecar = Buffer.from(`${JSON.stringify({
        schemaVersion: 1,
        baselineCommit: BEHAVIORAL_BASELINE_COMMIT,
        project,
        route: { id: route.id, kind: route.kind },
        normalizedStaticCspViolations: [],
      }, null, 2)}\n`, "utf8");
      await writeImmutableCaptureArtifact({
        bytes: manifest,
        ownership,
        relativePath: `${directory}/characterization.json`,
        root,
      });
      await writeImmutableCaptureArtifact({
        bytes: consoleSidecar,
        ownership,
        relativePath: `${directory}/console.json`,
        root,
      });
      await writeImmutableCaptureArtifact({
        bytes: png,
        ownership,
        relativePath: `${directory}/viewport.png`,
        root,
      });
    }
  }
}

function characterizationManifest(
  project: string,
  route: (typeof PUBLIC_OVERLAP_ROUTES)[number],
  applicationOrigin: string,
  png: Uint8Array,
) {
  const routeUrl = new URL(route.requestPath, applicationOrigin);
  const finalPath = route.kind === "public" ? routeUrl.pathname : "/login";
  return {
    schemaVersion: 1,
    baselineCommit: BEHAVIORAL_BASELINE_COMMIT,
    project,
    route: {
      id: route.id,
      kind: route.kind,
      requested: applicationUrl(routeUrl.pathname),
      final: applicationUrl(finalPath),
      redirects: [],
      finalStatus: 200,
    },
    viewport: null,
    screenshot: {
      width: Buffer.from(png).readUInt32BE(16),
      height: Buffer.from(png).readUInt32BE(20),
      sha256: sha256(png),
    },
    dom: null,
    computedStyles: [],
    ariaSnapshot: "",
    interactiveElements: [],
    consolePolicy: {},
    browserState: { cookies: [], storage: { local: [], session: [], cacheNames: [], serviceWorkerScopes: [] } },
    network: {
      requests: [{
        index: 0,
        method: "GET",
        url: applicationUrl(finalPath),
        scope: "application",
        resourceType: "document",
        navigation: true,
        serverAction: { present: false, identifier: null },
        requestHeaders: [
          { name: "accept", value: digestValue("text/html") },
          { name: "host", value: digestValue(new URL(applicationOrigin).host) },
        ],
        postData: null,
        redirectedFrom: null,
        response: {
          status: 200,
          statusText: "OK",
          fromServiceWorker: false,
          headers: [{ name: "content-type", value: "text/html; charset=utf-8" }],
        },
        failure: null,
        externalTransport: null,
      }],
      serverActionCount: 0,
      serverActions: [],
    },
  };
}

function applicationUrl(pathname: string) {
  return { origin: "<app-origin>", pathname, query: [], fragment: null };
}

function syntheticPng(width: number, height: number) {
  const value = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(value, 0);
  value.writeUInt32BE(width, 16);
  value.writeUInt32BE(height, 20);
  return value;
}

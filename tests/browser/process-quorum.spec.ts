import { createHash } from "node:crypto";

import { expect, test } from "./fixtures";
import { permitsCharacterizationReplayRequest } from "./characterization-replay-policy";
import {
  requireExactProcessBytesAgreement,
  selectIndependentProcessCharacterizationQuorum,
} from "./process-quorum";

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function sample(screenshot: Uint8Array, route = "/login") {
  return {
    screenshot,
    manifest: Buffer.from(`${JSON.stringify({
      route: { final: route },
      screenshot: {
        width: 1,
        height: 1,
        sha256: sha256(screenshot),
      },
    }, null, 2)}\n`),
  };
}

function identity(value: Uint8Array) {
  return Buffer.from(value);
}

test.describe("independent Chromium process quorum", () => {
  test("replays only local GETs and the exact credential-free Turnstile stub", () => {
    const applicationOrigin = "http://127.0.0.1:4000";
    const local = {
      applicationOrigin,
      headers: {},
      method: "GET",
      resourceType: "document",
      url: `${applicationOrigin}/login`,
    };
    const turnstile = {
      applicationOrigin,
      headers: {},
      method: "GET",
      resourceType: "script",
      url: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
    };
    expect(permitsCharacterizationReplayRequest(local)).toBe(true);
    expect(permitsCharacterizationReplayRequest(turnstile)).toBe(true);
    for (const nearMiss of [
      { ...local, method: "POST" },
      { ...local, headers: { "next-action": "opaque" } },
      { ...turnstile, resourceType: "fetch" },
      { ...turnstile, headers: { authorization: "credential" } },
      { ...turnstile, url: `${turnstile.url}&near_miss=1` },
      { ...turnstile, url: "https://provider.invalid/resource.js" },
      { ...turnstile, url: "not a url" },
    ]) {
      expect(permitsCharacterizationReplayRequest(nearMiss)).toBe(false);
    }
  });

  test("selects only an exact full-PNG majority", () => {
    const stable = Buffer.from([137, 80, 78, 71, 1]);
    const cornerRasterVariant = Buffer.from([137, 80, 78, 71, 2]);
    const result = selectIndependentProcessCharacterizationQuorum([
      sample(stable),
      sample(cornerRasterVariant),
      sample(stable),
    ], identity);

    expect(result.selectedScreenshot).toEqual(stable);
    expect(result.selectedProcessIndex).toBe(0);
    expect(result.selectedProcessIndexes).toEqual([0, 2]);
    expect(result.processes.map((entry) => entry.rawPngSha256)).toEqual([
      sha256(stable),
      sha256(cornerRasterVariant),
      sha256(stable),
    ]);
  });

  test("fails when projected non-PNG evidence disagrees", () => {
    const stable = Buffer.from([137, 80, 78, 71]);
    expect(() => selectIndependentProcessCharacterizationQuorum([
      sample(stable),
      sample(stable, "/register"),
      sample(stable),
    ], identity)).toThrow(/non-PNG characterization manifests disagree/);
  });

  test("fails when raw manifest PNG attestation or process count is invalid", () => {
    const stable = Buffer.from([137, 80, 78, 71]);
    const invalid = sample(stable);
    invalid.manifest = sample(Buffer.from([1, 2, 3])).manifest;
    expect(() => selectIndependentProcessCharacterizationQuorum([
      invalid,
      sample(stable),
      sample(stable),
    ], identity)).toThrow(/does not self-attest/);
    expect(() => requireExactProcessBytesAgreement(
      [Buffer.from("same"), Buffer.from("same")],
      "console sidecars",
    )).toThrow(/exactly 3 independent process values/);
  });
});

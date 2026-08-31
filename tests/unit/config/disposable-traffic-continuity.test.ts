import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  assertCheckpointProgress,
  decodeLivenessBody,
  validateContinuityResult,
} from "../../../scripts/security/disposable-traffic-continuity.mjs";

type Route = "primary" | "canary";

type Checkpoint = {
  route: Route;
  totalSuccesses: number;
  primarySuccesses: number;
  canarySuccesses: number;
  failureCount: number;
};

function checkpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    route: "primary",
    totalSuccesses: 10,
    primarySuccesses: 6,
    canarySuccesses: 4,
    failureCount: 0,
    ...overrides,
  };
}

describe("disposable traffic liveness decoder", () => {
  it("accepts the exact liveness object and returns an immutable projection", () => {
    const decoded = decodeLivenessBody(Buffer.from(JSON.stringify({
      version: "rollback-rehearsal-previous",
      status: "ok",
      service: "clean-pay",
    })));

    expect(decoded).toEqual({ status: "ok", service: "clean-pay" });
    expect(Object.keys(decoded)).toEqual(["status", "service"]);
    expect(Object.isFrozen(decoded)).toBe(true);
  });

  it.each([
    ["a non-byte input", "{}", "disposable traffic liveness body is invalid"],
    ["an empty body", new Uint8Array(), "disposable traffic liveness body is invalid"],
    ["invalid JSON", Buffer.from("{"), "disposable traffic liveness JSON is invalid"],
    ["a null payload", Buffer.from("null"), "disposable traffic liveness payload is invalid"],
    ["an array payload", Buffer.from("[]"), "disposable traffic liveness payload is invalid"],
    [
      "a missing field",
      Buffer.from('{"service":"clean-pay","status":"ok"}'),
      "disposable traffic liveness payload is invalid",
    ],
    [
      "an invalid service",
      Buffer.from('{"service":"other","status":"ok","version":"1"}'),
      "disposable traffic liveness payload is invalid",
    ],
    [
      "an invalid status",
      Buffer.from('{"service":"clean-pay","status":"degraded","version":"1"}'),
      "disposable traffic liveness payload is invalid",
    ],
    [
      "an empty version",
      Buffer.from('{"service":"clean-pay","status":"ok","version":""}'),
      "disposable traffic liveness payload is invalid",
    ],
    [
      "an overlong version",
      Buffer.from(JSON.stringify({ service: "clean-pay", status: "ok", version: "v".repeat(81) })),
      "disposable traffic liveness payload is invalid",
    ],
  ])("rejects %s", (_label, input, message) => {
    expect(() => decodeLivenessBody(input)).toThrow(message);
  });

  it("rejects unreviewed extra fields", () => {
    const input = Buffer.from(JSON.stringify({
      service: "clean-pay",
      status: "ok",
      version: "1",
      deployment: "candidate",
    }));

    expect(() => decodeLivenessBody(input))
      .toThrow("disposable traffic liveness payload is invalid");
  });

  it("rejects a body above the bounded response contract", () => {
    expect(() => decodeLivenessBody(Buffer.alloc((64 * 1024) + 1, 0x20)))
      .toThrow("disposable traffic liveness body is invalid");
  });
});

describe("disposable traffic checkpoint progress", () => {
  it.each([
    {
      route: "primary" as const,
      before: checkpoint(),
      after: checkpoint({ totalSuccesses: 13, primarySuccesses: 9 }),
    },
    {
      route: "canary" as const,
      before: checkpoint({ route: "canary" }),
      after: checkpoint({ route: "canary", totalSuccesses: 12, canarySuccesses: 6 }),
    },
  ])("accepts exclusive $route progress", ({ before, after, route }) => {
    expect(() => assertCheckpointProgress(before, after, route)).not.toThrow();
  });

  it.each([
    ["the before checkpoint belongs to another route", checkpoint({ route: "canary" }), checkpoint({ totalSuccesses: 11, primarySuccesses: 7 })],
    ["the after checkpoint belongs to another route", checkpoint(), checkpoint({ route: "canary", totalSuccesses: 11, primarySuccesses: 7 })],
    ["the before checkpoint already contains a failure", checkpoint({ failureCount: 1 }), checkpoint({ totalSuccesses: 11, primarySuccesses: 7 })],
    ["the after checkpoint contains a failure", checkpoint(), checkpoint({ totalSuccesses: 11, primarySuccesses: 7, failureCount: 1 })],
    ["the selected route makes no progress", checkpoint(), checkpoint()],
    ["the other route changes", checkpoint(), checkpoint({ totalSuccesses: 12, primarySuccesses: 7, canarySuccesses: 5 })],
    ["the total does not increase", checkpoint(), checkpoint({ primarySuccesses: 7 })],
    ["the total delta differs from the selected route delta", checkpoint(), checkpoint({ totalSuccesses: 12, primarySuccesses: 7 })],
  ])("rejects evidence when %s", (_label, before, after) => {
    expect(() => assertCheckpointProgress(before, after, "primary"))
      .toThrow("disposable traffic phase made no exclusive route progress");
  });

  it("rejects an unknown route before evaluating evidence", () => {
    expect(() => assertCheckpointProgress(
      checkpoint(),
      checkpoint({ totalSuccesses: 11, primarySuccesses: 7 }),
      "shadow",
    )).toThrow("disposable traffic route is invalid");
  });
});

describe("disposable traffic final continuity result", () => {
  const validResult = () => ({
    schemaVersion: 1,
    status: "passed",
    totalSuccesses: 25,
    primarySuccesses: 15,
    canarySuccesses: 10,
    failureCount: 0,
    observedRouteSequence: ["primary", "canary", "primary", "canary", "primary"],
  });

  it("accepts only the complete route sequence and returns immutable evidence", () => {
    const result = validateContinuityResult(JSON.stringify(validResult()));

    expect(result).toEqual(validResult());
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.observedRouteSequence)).toBe(true);
  });

  it("accepts the minimum success counts implied by the complete route sequence", () => {
    expect(validateContinuityResult(JSON.stringify({
      ...validResult(),
      totalSuccesses: 5,
      primarySuccesses: 3,
      canarySuccesses: 2,
    }))).toEqual({
      ...validResult(),
      totalSuccesses: 5,
      primarySuccesses: 3,
      canarySuccesses: 2,
    });
  });

  it.each([
    ["a failed status", { status: "failed" }],
    ["one recorded failure", { failureCount: 1 }],
    ["an inconsistent total", { totalSuccesses: 24 }],
    ["no primary successes", { totalSuccesses: 10, primarySuccesses: 0 }],
    ["no canary successes", { totalSuccesses: 15, canarySuccesses: 0 }],
    ["only one success for each route", {
      totalSuccesses: 2,
      primarySuccesses: 1,
      canarySuccesses: 1,
    }],
    ["too few primary successes for the recorded sequence", {
      totalSuccesses: 5,
      primarySuccesses: 2,
      canarySuccesses: 3,
    }],
    ["too few canary successes for the recorded sequence", {
      totalSuccesses: 5,
      primarySuccesses: 4,
      canarySuccesses: 1,
    }],
    ["a missing route switch", {
      observedRouteSequence: ["primary", "canary", "primary"],
    }],
    ["a reordered route switch", {
      observedRouteSequence: ["primary", "canary", "primary", "primary", "canary"],
    }],
  ])("rejects %s", (_label, override) => {
    expect(() => validateContinuityResult(JSON.stringify({
      ...validResult(),
      ...override,
    }))).toThrow("disposable traffic continuity result did not prove the rollout");
  });

  it("rejects malformed, extra-field, and oversized evidence", () => {
    expect(() => validateContinuityResult("{")).toThrow("disposable traffic JSON is invalid");
    expect(() => validateContinuityResult(JSON.stringify({
      ...validResult(),
      rawUrl: "unreviewed",
    }))).toThrow("disposable traffic JSON fields are invalid");
    expect(() => validateContinuityResult(" ".repeat((16 * 1024) + 1)))
      .toThrow("disposable traffic continuity result did not prove the rollout");
  });
});

describe("disposable traffic module loading", () => {
  it("publishes create-only evidence only after the private staging file is complete", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "scripts/security/disposable-traffic-continuity.mjs"),
      "utf8",
    );

    expect(source).toContain('const temporary = `${target}.create-${process.pid}`;');
    expect(source).toContain("identity = await writePrivateCreateTarget(temporary, value);");
    expect(source).toContain("await handle.sync();");
    expect(source).toContain("await link(temporary, target);");
    expect(source).toContain("await removeOwnedFile(temporary, identity);");
    const publication = source.slice(
      source.indexOf("async function writeCreateOnly(target, value)"),
      source.indexOf("async function writeReplace(target, value"),
    );
    expect(publication).not.toContain('open(target, "wx"');
  });

  it("is import-safe and does not install process lifecycle handlers", () => {
    const moduleUrl = pathToFileURL(path.resolve(
      process.cwd(),
      "scripts/security/disposable-traffic-continuity.mjs",
    )).href;
    const program = `
      const before = {
        sigint: process.listenerCount("SIGINT"),
        sigterm: process.listenerCount("SIGTERM"),
        exitCode: process.exitCode ?? null,
      };
      const imported = await import(${JSON.stringify(moduleUrl)});
      const after = {
        sigint: process.listenerCount("SIGINT"),
        sigterm: process.listenerCount("SIGTERM"),
        exitCode: process.exitCode ?? null,
      };
      process.stdout.write(JSON.stringify({
        before,
        after,
        hasDecoder: typeof imported.decodeLivenessBody === "function",
        hasCheckpointGate: typeof imported.assertCheckpointProgress === "function",
        hasResultGate: typeof imported.validateContinuityResult === "function",
      }));
    `;

    const output = execFileSync(process.execPath, ["--input-type=module", "--eval", program], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    });

    expect(JSON.parse(output)).toEqual({
      before: { sigint: 0, sigterm: 0, exitCode: null },
      after: { sigint: 0, sigterm: 0, exitCode: null },
      hasDecoder: true,
      hasCheckpointGate: true,
      hasResultGate: true,
    });
  });
});

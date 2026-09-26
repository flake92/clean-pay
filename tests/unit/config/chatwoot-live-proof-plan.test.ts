import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertChatwootLiveProofPlan,
  createChatwootLiveProofCliPlanAfterPreparation,
  createChatwootLiveProofPlan,
} from "../../../tests/browser/journeys/chatwoot-live-proof-plan.mjs";
import { assertChatwootPhaseInput } from "../../../tests/browser/journeys/chatwoot-phase-proof-contract.mjs";

const captureId = "0123456789abcdef";
const baselineRevision = "1".repeat(40);
const candidateRevision = "2".repeat(40);

type ImageBinding = {
  digest: string;
  tag: string;
};

type LiveStack = {
  appPort: string;
  assetAttestationPath: string;
  connectProxyPort: string;
  contractPath: string;
  generatedEnvironmentPath: string;
  images: {
    application: ImageBinding;
    migration: ImageBinding;
  };
  project: string;
  providerPort: string;
  resolverIp: string;
  revision: string;
};

type LivePair = {
  pairIndex: number;
  baseline: LiveStack;
  candidate: LiveStack;
};

type LivePlan = {
  schemaVersion: number;
  kind: string;
  captureId: string;
  ownedRoot: string;
  pairs: LivePair[];
};

type CliStack = {
  assetAttestationPath: string;
  contractPath: string;
  controlUrl: string;
  generatedEnvironmentPath: string;
  imageDigest: string;
  migrationImageDigest: string;
  resolverIp: string;
};

type CliPlan = {
  schemaVersion: number;
  kind: string;
  pairs: Array<{
    pairIndex: number;
    baseline: CliStack;
    candidate: CliStack;
  }>;
};

function externalOwnedRoot() {
  return path.join(
    path.parse(process.cwd()).root,
    "external-clean-pay-chatwoot-live-proof",
    captureId,
  );
}

function sourceInput() {
  return {
    captureId,
    ownedRoot: externalOwnedRoot(),
    baseline: {
      images: {
        application: {
          tag: `clean-pay:chatwoot-baseline-${captureId}`,
          digest: `sha256:${"1".repeat(64)}`,
        },
        migration: {
          tag: `clean-pay-migration:chatwoot-baseline-${captureId}`,
          digest: `sha256:${"2".repeat(64)}`,
        },
      },
      revision: baselineRevision,
    },
    candidate: {
      images: {
        application: {
          tag: `clean-pay:chatwoot-candidate-${captureId}`,
          digest: `sha256:${"3".repeat(64)}`,
        },
        migration: {
          tag: `clean-pay-migration:chatwoot-candidate-${captureId}`,
          digest: `sha256:${"4".repeat(64)}`,
        },
      },
      revision: candidateRevision,
    },
  };
}

function livePlan() {
  return createChatwootLiveProofPlan(sourceInput()) as LivePlan;
}

function stackEntries(plan: LivePlan) {
  return plan.pairs.flatMap((pair) => [
    { pairIndex: pair.pairIndex, role: "baseline", stack: pair.baseline },
    { pairIndex: pair.pairIndex, role: "candidate", stack: pair.candidate },
  ]);
}

describe("Chatwoot live proof plan", () => {
  it("builds the exact three-pair six-role isolated plan", () => {
    const plan = livePlan();
    const stacks = stackEntries(plan);

    expect(assertChatwootLiveProofPlan(plan)).toBe(plan);
    expect(plan).toMatchObject({
      schemaVersion: 1,
      kind: "clean-pay-chatwoot-live-proof-plan",
      captureId,
      ownedRoot: externalOwnedRoot(),
    });
    expect(plan.pairs.map((pair) => pair.pairIndex)).toEqual([1, 2, 3]);
    expect(stacks).toHaveLength(6);
    expect(stacks.map(({ stack }) => stack.appPort))
      .toEqual(["42300", "42301", "42302", "42303", "42304", "42305"]);
    expect(stacks.map(({ stack }) => stack.providerPort))
      .toEqual(["43300", "43301", "43302", "43303", "43304", "43305"]);
    expect(stacks.map(({ stack }) => stack.connectProxyPort))
      .toEqual(["44300", "44301", "44302", "44303", "44304", "44305"]);
    expect(stacks.map(({ stack }) => stack.resolverIp)).toEqual([
      "127.0.0.31",
      "127.0.0.32",
      "127.0.0.33",
      "127.0.0.34",
      "127.0.0.35",
      "127.0.0.36",
    ]);
    expect(stacks.map(({ stack }) => stack.project)).toEqual([
      "clean-pay-browser-journey-chatwoot-baseline-p1-0123456789ab",
      "clean-pay-browser-journey-chatwoot-candidate-p1-0123456789ab",
      "clean-pay-browser-journey-chatwoot-baseline-p2-0123456789ab",
      "clean-pay-browser-journey-chatwoot-candidate-p2-0123456789ab",
      "clean-pay-browser-journey-chatwoot-baseline-p3-0123456789ab",
      "clean-pay-browser-journey-chatwoot-candidate-p3-0123456789ab",
    ]);
    for (const { pairIndex, role, stack } of stacks) {
      expect(stack.project).toMatch(
        new RegExp(`^clean-pay-browser-journey-chatwoot-${role}-p${pairIndex}-[a-f0-9]{12}$`),
      );
      expect(path.isAbsolute(stack.generatedEnvironmentPath)).toBe(true);
      expect(path.dirname(stack.contractPath)).toBe(stack.generatedEnvironmentPath);
      expect(stack.assetAttestationPath.startsWith(externalOwnedRoot())).toBe(true);
    }
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.pairs)).toBe(true);
    expect(Object.isFrozen(plan.pairs[0]?.baseline.images.application)).toBe(true);
  });

  it("keeps every runtime and external-input identity globally distinct", () => {
    const stacks = stackEntries(livePlan())
      .map(({ stack }) => stack);
    const globallyUnique = (values: string[]) =>
      expect(new Set(values.map((value) => value.toLowerCase())).size)
        .toBe(values.length);

    globallyUnique(stacks.map((stack) => stack.project));
    globallyUnique(stacks.flatMap((stack) => [
      stack.appPort,
      stack.providerPort,
      stack.connectProxyPort,
    ]));
    globallyUnique(stacks.map((stack) => stack.resolverIp));
    globallyUnique(stacks.map((stack) => stack.generatedEnvironmentPath));
    globallyUnique(stacks.map((stack) => stack.contractPath));
    globallyUnique(stacks.map((stack) => stack.assetAttestationPath));
    globallyUnique(stacks.flatMap((stack) => [
      stack.generatedEnvironmentPath,
      stack.contractPath,
      stack.assetAttestationPath,
    ]));
  });

  it.each([
    ["extra root input", (value: ReturnType<typeof sourceInput>) => {
      Object.assign(value, { token: "forbidden" });
    }],
    ["capture id width", (value: ReturnType<typeof sourceInput>) => {
      value.captureId = "a".repeat(15);
    }],
    ["relative owned root", (value: ReturnType<typeof sourceInput>) => {
      value.ownedRoot = "external/chatwoot";
    }],
    ["non-normal owned root", (value: ReturnType<typeof sourceInput>) => {
      value.ownedRoot = `${externalOwnedRoot()}${path.sep}..${path.sep}alias`;
    }],
    ["role object alias", (value: ReturnType<typeof sourceInput>) => {
      value.candidate = value.baseline;
    }],
    ["role revision alias", (value: ReturnType<typeof sourceInput>) => {
      value.candidate.revision = value.baseline.revision;
    }],
    ["application tag alias", (value: ReturnType<typeof sourceInput>) => {
      value.candidate.images.application.tag = value.baseline.images.application.tag;
    }],
    ["migration digest alias", (value: ReturnType<typeof sourceInput>) => {
      value.candidate.images.migration.digest = value.baseline.images.migration.digest;
    }],
    ["same-role image alias", (value: ReturnType<typeof sourceInput>) => {
      value.baseline.images.migration = value.baseline.images.application;
    }],
    ["digest width", (value: ReturnType<typeof sourceInput>) => {
      value.baseline.images.application.digest = `sha256:${"1".repeat(63)}`;
    }],
    ["image reference userinfo", (value: ReturnType<typeof sourceInput>) => {
      value.baseline.images.application.tag = "user:password@registry/clean-pay:latest";
    }],
    ["credential-shaped role input", (value: ReturnType<typeof sourceInput>) => {
      Object.assign(value.baseline, { apiKey: "forbidden" });
    }],
  ])("rejects the %s near-miss before planning", (_label, mutate) => {
    const input = sourceInput();
    mutate(input);
    expect(() => createChatwootLiveProofPlan(input)).toThrow();
  });

  it.each([
    ["pair count", (value: LivePlan) => {
      value.pairs.pop();
    }],
    ["pair order", (value: LivePlan) => {
      value.pairs[0]!.pairIndex = 2;
    }],
    ["stack object alias", (value: LivePlan) => {
      value.pairs[0]!.candidate = value.pairs[0]!.baseline;
    }],
    ["app port drift", (value: LivePlan) => {
      value.pairs[1]!.baseline.appPort = "42303";
    }],
    ["provider port drift", (value: LivePlan) => {
      value.pairs[1]!.candidate.providerPort = "43302";
    }],
    ["CONNECT port drift", (value: LivePlan) => {
      value.pairs[2]!.baseline.connectProxyPort = "44305";
    }],
    ["resolver alias", (value: LivePlan) => {
      value.pairs[2]!.candidate.resolverIp = "127.0.0.35";
    }],
    ["project near-miss", (value: LivePlan) => {
      value.pairs[0]!.baseline.project =
        "clean-pay-browser-journey-chatwoot-baseline-p01-0123456789ab";
    }],
    ["project capture drift", (value: LivePlan) => {
      value.pairs[0]!.candidate.project =
        "clean-pay-browser-journey-chatwoot-candidate-p1-1123456789ab";
    }],
    ["environment path alias", (value: LivePlan) => {
      value.pairs[2]!.candidate.generatedEnvironmentPath =
        value.pairs[2]!.baseline.generatedEnvironmentPath;
    }],
    ["contract containment drift", (value: LivePlan) => {
      value.pairs[1]!.baseline.contractPath = path.join(
        externalOwnedRoot(),
        "escaped-contract.json",
      );
    }],
    ["attestation alias", (value: LivePlan) => {
      value.pairs[0]!.candidate.assetAttestationPath =
        value.pairs[0]!.baseline.assetAttestationPath;
    }],
    ["image digest drift", (value: LivePlan) => {
      value.pairs[2]!.baseline.images.application.digest = `sha256:${"5".repeat(64)}`;
    }],
    ["extra stack field", (value: LivePlan) => {
      Object.assign(value.pairs[0]!.baseline, { password: "forbidden" });
    }],
  ])("rejects post-plan %s", (_label, mutate) => {
    const plan = structuredClone(livePlan());
    mutate(plan);
    expect(() => assertChatwootLiveProofPlan(plan)).toThrow();
    expect(() => createChatwootLiveProofCliPlanAfterPreparation(plan)).toThrow();
  });

  it("projects only the exact proof CLI input after preparation", () => {
    const plan = livePlan();
    const cliPlan = createChatwootLiveProofCliPlanAfterPreparation(plan) as CliPlan;
    const stacks = cliPlan.pairs.flatMap((pair) => [pair.baseline, pair.candidate]);

    expect(assertChatwootPhaseInput(cliPlan)).toMatchObject({
      schemaVersion: 1,
      kind: "clean-pay-chatwoot-phase-proof-input",
    });
    expect(Object.keys(cliPlan).sort()).toEqual(["kind", "pairs", "schemaVersion"]);
    expect(stacks.map((stack) => stack.controlUrl)).toEqual([
      "http://127.0.0.1:43300/",
      "http://127.0.0.1:43301/",
      "http://127.0.0.1:43302/",
      "http://127.0.0.1:43303/",
      "http://127.0.0.1:43304/",
      "http://127.0.0.1:43305/",
    ]);
    expect(stacks.map((stack) => stack.resolverIp)).toEqual([
      "127.0.0.31",
      "127.0.0.32",
      "127.0.0.33",
      "127.0.0.34",
      "127.0.0.35",
      "127.0.0.36",
    ]);
    expect(cliPlan.pairs.map((pair) => pair.baseline.imageDigest))
      .toEqual(Array(3).fill(`sha256:${"1".repeat(64)}`));
    expect(cliPlan.pairs.map((pair) => pair.candidate.imageDigest))
      .toEqual(Array(3).fill(`sha256:${"3".repeat(64)}`));
    expect(JSON.stringify(cliPlan)).not.toMatch(
      /applicationImage|appPort|connectProxyPort|password|project|revision|secret|tag|token/i,
    );
    expect(Object.isFrozen(cliPlan)).toBe(true);
    expect(Object.isFrozen(cliPlan.pairs[0]?.baseline)).toBe(true);
  });
});

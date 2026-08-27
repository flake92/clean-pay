import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  assertJourneyProjectAbsent,
  attestJourneyOwnedStack,
  cleanupJourneyOwnedStack,
  prepareJourneyOwnedStack,
  startJourneyOwnedStack,
  withJourneyOwnedStackPair,
} from "./journey-owned-stack-orchestrator.mjs";

test("is import-safe and refuses a non-isolated pair before its first Docker query", async () => {
  expect(typeof withJourneyOwnedStackPair).toBe("function");
  expect(typeof prepareJourneyOwnedStack).toBe("function");
  expect(typeof startJourneyOwnedStack).toBe("function");
  expect(typeof attestJourneyOwnedStack).toBe("function");
  expect(typeof cleanupJourneyOwnedStack).toBe("function");
  expect(typeof assertJourneyProjectAbsent).toBe("function");

  let dockerCalls = 0;
  const aliased = {
    contract: {
      project: "clean-pay-browser-journey-provider-proof-baseline-aaaaaaaaaaaa",
      publications: {
        app: "127.0.0.1:4100",
        browserTls: "127.0.0.2:443",
        connectProxy: "127.0.0.1:14444",
        providerControl: "127.0.0.1:13100",
      },
    },
    contractPath: "C:/synthetic/contract.json",
    expectedApplicationImageDigest: `sha256:${"1".repeat(64)}`,
    expectedMigrationImageDigest: `sha256:${"2".repeat(64)}`,
    repositoryRoot: path.resolve(__dirname, "../../.."),
    runDocker: async () => {
      dockerCalls += 1;
      return "";
    },
  };
  await expect(withJourneyOwnedStackPair(
    { baseline: aliased, candidate: { ...aliased } },
    async () => undefined,
  )).rejects.toThrow(/not isolated/);
  expect(dockerCalls).toBe(0);
});

test("contains no top-level runner or broad cleanup primitive", async () => {
  const source = await readFile(path.resolve(
    __dirname,
    "journey-owned-stack-orchestrator.mjs",
  ), "utf8");
  expect(source).not.toMatch(/process\.(?:argv|exit|exitCode)/);
  expect(source).not.toMatch(/\brm\s*\(|recursive\s*:\s*true|\*\//);
  expect(source).toContain("Promise.allSettled(handles.map((handle) => startJourneyOwnedStack(handle)))");
  expect(source).toContain("await assertJourneyProjectAbsent");
});

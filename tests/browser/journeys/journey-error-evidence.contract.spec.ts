import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

import { createJourneySanitizedErrorEvidence } from "./journey-error-evidence.mjs";

const execFileAsync = promisify(execFile);

test("projects nested failures into bounded digest-only evidence", () => {
  const leaf = new Error("synthetic credential-shaped value must stay private");
  const cleanup = new Error("C:\\synthetic\\private\\snapshot");
  const primary = new AggregateError([leaf], "synthetic launch stage");
  const evidence = createJourneySanitizedErrorEvidence(
    new AggregateError([primary, cleanup], "synthetic operation and cleanup stage"),
  );

  expect(evidence).toEqual({
    causeEvidence: [
      {
        depth: 1,
        errorClass: "AggregateError",
        messageSha256: sha256("synthetic launch stage"),
        ordinal: 1,
        parentOrdinal: 0,
      },
      {
        depth: 2,
        errorClass: "Error",
        messageSha256: sha256("synthetic credential-shaped value must stay private"),
        ordinal: 2,
        parentOrdinal: 1,
      },
      {
        depth: 1,
        errorClass: "Error",
        messageSha256: sha256("C:\\synthetic\\private\\snapshot"),
        ordinal: 3,
        parentOrdinal: 0,
      },
    ],
    causeEvidenceTruncated: false,
    errorClass: "AggregateError",
    messageSha256: sha256("synthetic operation and cleanup stage"),
  });
  const serialized = JSON.stringify(evidence);
  expect(serialized).not.toContain("credential-shaped");
  expect(serialized).not.toContain("synthetic\\\\private");
});

test("bounds cycles, aggregate fan-out, and non-Error rejection values", () => {
  const cyclic = new Error("synthetic cycle");
  Object.defineProperty(cyclic, "cause", { value: cyclic });
  const children = Array.from({ length: 12 }, (_, index) => (
    index === 0 ? cyclic : `synthetic rejection ${index}`
  ));
  const evidence = createJourneySanitizedErrorEvidence(
    new AggregateError(children, "synthetic bounded aggregate"),
  );

  expect(evidence.errorClass).toBe("AggregateError");
  expect(evidence.causeEvidenceTruncated).toBe(true);
  expect(evidence.causeEvidence).toHaveLength(8);
  expect(evidence.causeEvidence.map(({
    errorClass,
  }: { errorClass: string }) => errorClass)).toEqual([
    "Error",
    "NonError",
    "NonError",
    "NonError",
    "NonError",
    "NonError",
    "NonError",
    "NonError",
  ]);
  expect(JSON.stringify(evidence)).not.toContain("synthetic rejection");
});

test("stays digest-only for revoked proxies and poisoned Error properties", () => {
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const revokedEvidence = createJourneySanitizedErrorEvidence(revoked.proxy);
  expect(revokedEvidence).toEqual({
    causeEvidence: [],
    causeEvidenceTruncated: true,
    errorClass: "NonError",
    messageSha256: sha256("proxy-rejection"),
  });

  const poisoned = new Error("synthetic replaced message");
  Object.defineProperties(poisoned, {
    cause: { get: () => { throw new Error("synthetic secret cause"); } },
    message: {
      configurable: true,
      get: () => { throw new Error("synthetic secret message"); },
    },
  });
  const poisonedEvidence = createJourneySanitizedErrorEvidence(poisoned);
  expect(poisonedEvidence).toEqual({
    causeEvidence: [],
    causeEvidenceTruncated: true,
    errorClass: "Error",
    messageSha256: sha256("unreadable-error-message"),
  });

  const aggregate = new AggregateError([], "synthetic safe root");
  Object.defineProperty(aggregate, "errors", {
    get: () => { throw new Error("synthetic secret aggregate"); },
  });
  const aggregateEvidence = createJourneySanitizedErrorEvidence(aggregate);
  expect(aggregateEvidence).toEqual({
    causeEvidence: [],
    causeEvidenceTruncated: true,
    errorClass: "AggregateError",
    messageSha256: sha256("synthetic safe root"),
  });
  const serialized = JSON.stringify({ aggregateEvidence, poisonedEvidence, revokedEvidence });
  expect(serialized).not.toContain("synthetic secret");
});

test("does not invoke traps on rejected proxies or proxied AggregateError children", () => {
  let trapCalls = 0;
  const traps: ProxyHandler<object> = {
    get: () => { trapCalls += 1; return undefined; },
    getOwnPropertyDescriptor: () => { trapCalls += 1; return undefined; },
    getPrototypeOf: () => { trapCalls += 1; return null; },
    has: () => { trapCalls += 1; return false; },
  };
  const rejectedProxy = new Proxy({}, traps);
  const proxiedChildren = new Proxy([], traps);
  const aggregate = new AggregateError([], "synthetic aggregate with proxied children");
  Object.defineProperty(aggregate, "errors", { value: proxiedChildren });

  const proxyEvidence = createJourneySanitizedErrorEvidence(rejectedProxy);
  const aggregateEvidence = createJourneySanitizedErrorEvidence(aggregate);

  expect(trapCalls).toBe(0);
  expect(proxyEvidence).toMatchObject({
    causeEvidenceTruncated: true,
    errorClass: "NonError",
    messageSha256: sha256("proxy-rejection"),
  });
  expect(aggregateEvidence).toEqual({
    causeEvidence: [],
    causeEvidenceTruncated: true,
    errorClass: "AggregateError",
    messageSha256: sha256("synthetic aggregate with proxied children"),
  });
});

test("bounds oversized messages without hashing their bytes", () => {
  const first = createJourneySanitizedErrorEvidence(new Error("a".repeat(1_000_000)));
  const second = createJourneySanitizedErrorEvidence(new Error("b".repeat(1_000_000)));
  expect(first).toEqual({
    causeEvidence: [],
    causeEvidenceTruncated: true,
    errorClass: "Error",
    messageSha256: sha256("oversized-error-message"),
  });
  expect(second).toEqual(first);
});

test("enforces the exact depth and total-node evidence ceilings", () => {
  let deep: Error = new Error("synthetic depth leaf");
  for (let depth = 0; depth < 10; depth += 1) {
    deep = new Error(`synthetic depth ${depth}`, { cause: deep });
  }
  const deepEvidence = createJourneySanitizedErrorEvidence(deep);
  expect(deepEvidence.causeEvidenceTruncated).toBe(true);
  expect(Math.max(...deepEvidence.causeEvidence.map((node: { depth: number }) => node.depth)))
    .toBe(4);
  expect(deepEvidence.causeEvidence.length + 1).toBe(5);

  const branches = Array.from({ length: 8 }, (_, branch) => new AggregateError(
    Array.from({ length: 8 }, (_, leaf) => new Error(`branch ${branch} leaf ${leaf}`)),
    `branch ${branch}`,
  ));
  const broadEvidence = createJourneySanitizedErrorEvidence(
    new AggregateError(branches, "synthetic broad root"),
  );
  expect(broadEvidence.causeEvidenceTruncated).toBe(true);
  expect(broadEvidence.causeEvidence).toHaveLength(15);
  expect(Math.max(...broadEvidence.causeEvidence.map((node: { ordinal: number }) => node.ordinal)))
    .toBe(15);
  expect(Math.max(...broadEvidence.causeEvidence.map((node: { depth: number }) => node.depth)))
    .toBeLessThanOrEqual(4);
});

test("emits one exact digest-only CLI failure record without starting Docker", async () => {
  const repositoryRoot = path.resolve(__dirname, "../../..");
  const privateMarker = "synthetic-raw-argument-must-not-escape";
  let failure: (Error & {
    code?: number | string;
    stderr?: string;
    stdout?: string;
  }) | undefined;
  try {
    await execFileAsync(process.execPath, [
      path.resolve(__dirname, "prove-provider-overlap.mjs"),
      "--synthetic-private-argument",
      privateMarker,
    ], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: childProcessEnvironment(),
      maxBuffer: 64 * 1024,
      timeout: 10_000,
      windowsHide: true,
    });
  } catch (error) {
    failure = error as typeof failure;
  }

  expect(failure?.code).toBe(1);
  expect(failure?.stdout).toBe("");
  expect(failure?.stderr?.endsWith("\n")).toBe(true);
  expect(failure?.stderr?.match(/\n/g)).toHaveLength(1);
  const record = JSON.parse(failure?.stderr ?? "null");
  expect(Object.keys(record).sort()).toEqual([
    "causeEvidence",
    "causeEvidenceTruncated",
    "errorClass",
    "messageSha256",
    "status",
  ]);
  expect(record).toEqual({
    causeEvidence: [],
    causeEvidenceTruncated: false,
    errorClass: "Error",
    messageSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    status: "dual_image_provider_overlap_failed",
  });
  expect(failure?.stderr).not.toContain(privateMarker);
  expect(failure?.stderr?.toLowerCase()).not.toContain(repositoryRoot.toLowerCase());
});

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function childProcessEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const name of [
    "PATH", "Path", "PATHEXT", "SYSTEMROOT", "SystemRoot", "WINDIR",
  ]) {
    if (typeof process.env[name] === "string") environment[name] = process.env[name];
  }
  return environment;
}

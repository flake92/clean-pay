import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  proveServedCabinetAssets,
  validateProductionImageAssetAttestation,
  validateServedCabinetAssetProof,
} from "../../../scripts/security/prove-served-cabinet-assets.mjs";

const route = "/cabinet/page";
const publicBuildContract = { version: "1", sha256: "9".repeat(64) };
const platform = { os: "linux", architecture: "amd64" };
const servers: Server[] = [];
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("served cabinet production-image asset proof", () => {
  it("binds both exact images and fixtures to matching same-origin body observations", async () => {
    const fixture = await createLiveFixture();
    const proof = await proveFixture(fixture);

    expect(proof).toMatchObject({
      kind: "clean-pay-served-cabinet-route-asset-proof",
      schemaVersion: 1,
      route,
      assertions: {
        allDeclaredChunksObservedAndImageMatched: true,
        clientModuleCount: 16,
        declaredChunkPartitionsDiffer: true,
        moduleChunkAssignmentsDiffer: true,
        publicBuildContractIdentical: true,
      },
    });
    expect(proof.sides.baseline.observations).toHaveLength(3);
    expect(proof.sides.candidate.observations).toHaveLength(2);
    expect(proof.sides.baseline.observations).toEqual(
      fixture.baseline.side.attestation.inventory.clientReferences[0].declaredStaticChunks
        .map((servedPath) => {
          const body = fixture.baseline.side.bodies.get(servedPath);
          if (!body) throw new Error("Synthetic baseline body is missing.");
          return {
            servedPath,
            status: 200,
            contentType: servedPath.endsWith(".css")
              ? "text/css; charset=utf-8"
              : "application/javascript; charset=utf-8",
            size: body.length,
            sha256: sha256(body),
          };
        }),
    );
    expect(proof.proofSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(validateServedCabinetAssetProof(proof, fixture.expected)).toBe(proof);
    for (const request of [...fixture.baseline.requests, ...fixture.candidate.requests]) {
      expect(request.authorization).toBeUndefined();
      expect(request.cookie).toBeUndefined();
      expect(request.acceptEncoding).toBe("identity");
    }
  });

  it("runs as a bounded CLI and writes only a new sanitized proof sidecar", async () => {
    const fixture = await createLiveFixture();
    const root = await mkdtemp(path.join(tmpdir(), "clean-pay-served-cabinet-cli-test-"));
    temporaryRoots.push(root);
    const baselineAttestation = path.join(root, "baseline-attestation.json");
    const candidateAttestation = path.join(root, "candidate-attestation.json");
    const output = path.join(root, "proof.json");
    await Promise.all([
      writeFile(baselineAttestation, JSON.stringify(fixture.baseline.side.attestation), { flag: "wx" }),
      writeFile(candidateAttestation, JSON.stringify(fixture.candidate.side.attestation), { flag: "wx" }),
    ]);

    const result = await runCli([
      "--baseline-attestation", baselineAttestation,
      "--baseline-base-url", fixture.baseline.baseUrl,
      "--baseline-image-digest", fixture.expected.baseline.imageDigest,
      "--baseline-revision", fixture.expected.baseline.revision,
      "--baseline-fixture-sha256", fixture.expected.baseline.fixtureContract.sha256,
      "--candidate-attestation", candidateAttestation,
      "--candidate-base-url", fixture.candidate.baseUrl,
      "--candidate-image-digest", fixture.expected.candidate.imageDigest,
      "--candidate-revision", fixture.expected.candidate.revision,
      "--candidate-fixture-sha256", fixture.expected.candidate.fixtureContract.sha256,
      "--fixture-version", "journey-v5",
      "--public-build-contract-version", publicBuildContract.version,
      "--public-build-contract-sha256", publicBuildContract.sha256,
      "--platform", "linux/amd64",
      "--output", output,
    ]);

    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      baselineChunkCount: 3,
      candidateChunkCount: 2,
      clientModuleCount: 16,
      status: "served_cabinet_assets_proved",
    });
    const proof = JSON.parse(await readFile(output, "utf8"));
    expect(validateServedCabinetAssetProof(proof, fixture.expected)).toBe(proof);
    expect(JSON.stringify(proof)).not.toContain("self.__chunkBody");
  });

  it("rejects a tampered or schema-expanded image attestation", async () => {
    const side = createSide("baseline");
    const tampered = structuredClone(side.attestation);
    tampered.inventory.staticChunks[0].size += 1;
    expect(() => validateProductionImageAssetAttestation(
      tampered,
      side.expected,
      "baseline",
    )).toThrow("canonical SHA-256");

    const expanded = structuredClone(side.attestation);
    Object.assign(expanded.source, { untrusted: "field" });
    resign(expanded);
    expect(() => validateProductionImageAssetAttestation(
      expanded,
      side.expected,
      "baseline",
    )).toThrow("exact expected fields");
  });

  it("accepts only bounded canonical static media in the OCI byte inventory", () => {
    const side = createSide("baseline");
    const withFont = structuredClone(side.attestation);
    for (const [index, extension] of [
      "eot", "ico", "png", "svg", "ttf", "woff", "woff2",
    ].entries()) {
      withFont.inventory.staticChunks.push({
        imagePath: `/app/.next/static/media/asset-${index}.${extension}`,
        servedPath: `/_next/static/media/asset-${index}.${extension}`,
        sha256: index.toString(16).repeat(64),
        size: 128 + index,
      });
    }
    resignInventory(withFont);
    expect(validateProductionImageAssetAttestation(
      withFont,
      side.expected,
      "baseline",
    )).toBe(withFont);

    for (const [servedPath, size] of [
      ["/_next/static/chunks/cabinet.map", 128],
      ["/_next/static/media/inter.txt", 128],
      ["/_next/static/media/nested/inter.woff2", 128],
      ["/_next/static/media/inter.woff2", 128 * 1024 * 1024 + 1],
    ] as const) {
      const invalid = structuredClone(side.attestation);
      invalid.inventory.staticChunks.push({
        imagePath: `/app/.next${servedPath.slice("/_next".length)}`,
        servedPath,
        sha256: "f".repeat(64),
        size,
      });
      resignInventory(invalid);
      expect(() => validateProductionImageAssetAttestation(
        invalid,
        side.expected,
        "baseline",
      ), servedPath).toThrow(/static chunk inventory/);
    }
  });

  it("rejects a served body that differs from the attested image bytes", async () => {
    const fixture = await createLiveFixture({ baseline: { wrongBody: "/_next/static/chunks/base-a.js" } });
    await expect(proveFixture(fixture)).rejects.toThrow(
      "baseline cabinet chunk body does not match its image inventory",
    );
  });

  it("rejects redirects before a second chunk request can be followed", async () => {
    const fixture = await createLiveFixture({ baseline: { redirect: "/_next/static/chunks/base-a.js" } });
    await expect(proveFixture(fixture)).rejects.toThrow(
      "baseline cabinet chunk request failed",
    );
    expect(fixture.baseline.requests.filter(
      (request) => request.path === "/_next/static/chunks/base-a.js",
    )).toHaveLength(1);
  });

  it.each([
    ["content type", { wrongContentType: "/_next/static/chunks/base-a.js" }, /content type is invalid/],
    ["content length", { oversizedLength: "/_next/static/chunks/base-a.js" }, /content length does not match/],
  ])("rejects a non-matching bounded %s observation", async (_name, baseline, message) => {
    const fixture = await createLiveFixture({ baseline });
    await expect(proveFixture(fixture)).rejects.toThrow(message);
  });

  it("rejects a near-miss module closure before making HTTP requests", async () => {
    const baseline = createSide("baseline");
    const candidate = createSide("candidate", { moduleCount: 15 });
    const live = await startSides(baseline, candidate);
    await expect(proveFixture(live)).rejects.toThrow("does not contain exactly 16 client modules");
    expect(live.baseline.requests).toEqual([]);
    expect(live.candidate.requests).toEqual([]);
  });

  it("rejects identical module-to-chunk partitioning before making HTTP requests", async () => {
    const baseline = createSide("baseline");
    const candidate = createSide("candidate", { partition: "baseline" });
    const live = await startSides(baseline, candidate);
    await expect(proveFixture(live)).rejects.toThrow("module-to-chunk assignments do not differ");
    expect(live.baseline.requests).toEqual([]);
    expect(live.candidate.requests).toEqual([]);
  });

  it("rejects non-loopback and shared origins", async () => {
    const baseline = createSide("baseline");
    const candidate = createSide("candidate");
    await expect(proveServedCabinetAssets({
      baseline: {
        attestation: baseline.attestation,
        baseUrl: "http://example.test:4100/",
        expected: baseline.expected,
      },
      candidate: {
        attestation: candidate.attestation,
        baseUrl: "http://127.0.0.1:4101/",
        expected: candidate.expected,
      },
    })).rejects.toThrow("exact loopback origin");
    await expect(proveServedCabinetAssets({
      baseline: {
        attestation: baseline.attestation,
        baseUrl: "http://127.0.0.1:4100/",
        expected: baseline.expected,
      },
      candidate: {
        attestation: candidate.attestation,
        baseUrl: "http://127.0.0.1:4100/",
        expected: candidate.expected,
      },
    })).rejects.toThrow("distinct loopback origins");
  });

  it("detects any post-generation proof mutation", async () => {
    const fixture = await createLiveFixture();
    const proof = await proveFixture(fixture);
    const mutated = structuredClone(proof);
    mutated.sides.candidate.observations[0].status = 204;
    expect(() => validateServedCabinetAssetProof(mutated, fixture.expected))
      .toThrow("canonical SHA-256");
  });
});

async function createLiveFixture(options: {
  baseline?: ResponseOverride;
  candidate?: ResponseOverride;
} = {}) {
  return startSides(
    createSide("baseline"),
    createSide("candidate"),
    options,
  );
}

async function startSides(
  baseline: SyntheticSide,
  candidate: SyntheticSide,
  options: { baseline?: ResponseOverride; candidate?: ResponseOverride } = {},
) {
  const baselineServer = await startServer(baseline, options.baseline);
  const candidateServer = await startServer(candidate, options.candidate);
  return {
    baseline: { ...baselineServer, side: baseline },
    candidate: { ...candidateServer, side: candidate },
    expected: { baseline: baseline.expected, candidate: candidate.expected },
  };
}

function proveFixture(fixture: Awaited<ReturnType<typeof createLiveFixture>>) {
  return proveServedCabinetAssets({
    baseline: {
      attestation: fixture.baseline.side.attestation,
      baseUrl: fixture.baseline.baseUrl,
      expected: fixture.expected.baseline,
    },
    candidate: {
      attestation: fixture.candidate.side.attestation,
      baseUrl: fixture.candidate.baseUrl,
      expected: fixture.expected.candidate,
    },
  });
}

function createSide(
  side: "baseline" | "candidate",
  options: { moduleCount?: number; partition?: "baseline" | "candidate" } = {},
) {
  const partition = options.partition ?? side;
  const moduleCount = options.moduleCount ?? 16;
  const javascriptPaths = partition === "baseline"
    ? ["/_next/static/chunks/base-a.js", "/_next/static/chunks/base-b.js"]
    : ["/_next/static/chunks/candidate.js"];
  const cssPath = partition === "baseline"
    ? "/_next/static/chunks/base.css"
    : "/_next/static/chunks/candidate.css";
  const bodies = new Map<string, Buffer>([
    ...javascriptPaths.map((servedPath, index) => [
      servedPath,
      Buffer.from(`self.__chunkBody = ${JSON.stringify(`${partition}-${index}`)};\n`, "utf8"),
    ] as const),
    [cssPath, Buffer.from(`.${partition}{display:block}\n`, "utf8")],
  ]);
  const bindings = Array.from({ length: moduleCount }, (_, index) => ({
    chunks: [javascriptPaths[index % javascriptPaths.length]],
    moduleIdentitySha256: sha256(`cabinet-client-module-${index}`),
  })).sort((left, right) => left.moduleIdentitySha256.localeCompare(right.moduleIdentitySha256));
  const declaredStaticChunks = [...bodies.keys()].sort();
  const manifestPath = "/app/.next/server/app/cabinet/page_client-reference-manifest.js";
  const manifestSha256 = sha256(`client-reference-manifest-${side}-${partition}-${moduleCount}`);
  const clientReference = {
    clientModuleChunkBindings: bindings,
    clientModuleCount: bindings.length,
    clientModuleSetSha256: digestCanonical(bindings.map(({ moduleIdentitySha256 }) => moduleIdentitySha256)),
    declaredStaticChunkSetSha256: digestCanonical(declaredStaticChunks),
    declaredStaticChunks,
    entrypointStaticChunks: [cssPath],
    manifestPath,
    manifestSha256,
    moduleChunkAssignmentSha256: digestCanonical(bindings),
    route,
  };
  const manifests = [{
    imagePath: manifestPath,
    kind: "client-reference",
    sha256: manifestSha256,
    size: 512,
  }];
  const staticChunks = [...bodies.entries()].map(([servedPath, body]) => ({
    imagePath: `/app/.next${servedPath.slice("/_next".length)}`,
    servedPath,
    sha256: sha256(body),
    size: body.length,
  })).sort((left, right) => left.servedPath.localeCompare(right.servedPath));
  const inventoryCore = { clientReferences: [clientReference], manifests, staticChunks };
  const inventory = {
    ...inventoryCore,
    clientReferenceCount: 1,
    inventorySha256: digestCanonical(inventoryCore),
    manifestCount: manifests.length,
    staticChunkCount: staticChunks.length,
    staticChunkSetSha256: digestCanonical(staticChunks.map(({ servedPath, sha256: digest, size }) => ({
      servedPath,
      sha256: digest,
      size,
    }))),
  };
  const expected = {
    fixtureContract: {
      version: "journey-v5",
      sha256: (side === "baseline" ? "a" : "b").repeat(64),
    },
    imageDigest: `sha256:${(side === "baseline" ? "1" : "2").repeat(64)}`,
    platform,
    publicBuildContract,
    revision: (side === "baseline" ? "3" : "4").repeat(40),
  };
  const unsigned = {
    kind: "clean-pay-production-image-static-asset-attestation",
    schemaVersion: 1,
    source: {
      configDigest: `sha256:${(side === "baseline" ? "5" : "6").repeat(64)}`,
      imageDigest: expected.imageDigest,
      manifestDigest: `sha256:${(side === "baseline" ? "7" : "8").repeat(64)}`,
      platform,
      publicBuildContract,
      revision: expected.revision,
      role: "app",
    },
    inventory,
    correlation: {
      bodyDigestAlgorithm: "sha256",
      bodyDigestInput: "decoded response body bytes",
      key: "servedPath",
      staticChunkCount: staticChunks.length,
    },
  };
  return {
    attestation: { ...unsigned, attestationSha256: digestCanonical(unsigned) },
    bodies,
    expected,
  };
}

type SyntheticSide = ReturnType<typeof createSide>;

type ResponseOverride = {
  oversizedLength?: string;
  redirect?: string;
  wrongBody?: string;
  wrongContentType?: string;
};

async function startServer(side: SyntheticSide, override: ResponseOverride = {}) {
  const requests: Array<{
    acceptEncoding?: string;
    authorization?: string;
    cookie?: string;
    path: string;
  }> = [];
  const server = createServer((request, response) => {
    const requestPath = request.url ?? "";
    requests.push({
      acceptEncoding: header(request.headers["accept-encoding"]),
      authorization: header(request.headers.authorization),
      cookie: header(request.headers.cookie),
      path: requestPath,
    });
    const body = side.bodies.get(requestPath);
    if (!body) {
      response.statusCode = 404;
      response.end();
      return;
    }
    if (override.redirect === requestPath) {
      response.statusCode = 302;
      response.setHeader("location", requestPath);
      response.end();
      return;
    }
    const servedBody = Buffer.from(body);
    if (override.wrongBody === requestPath) servedBody[0] ^= 0xff;
    response.statusCode = 200;
    response.setHeader(
      "content-type",
      override.wrongContentType === requestPath
        ? "text/plain; charset=utf-8"
        : requestPath.endsWith(".css")
          ? "text/css; charset=UTF-8"
          : "application/javascript; charset=UTF-8",
    );
    response.setHeader(
      "content-length",
      override.oversizedLength === requestPath
        ? String(33 * 1024 * 1024)
        : String(servedBody.length),
    );
    response.end(servedBody);
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}/`, requests };
}

function resign(attestation: SyntheticSide["attestation"]) {
  const unsigned = { ...attestation };
  Reflect.deleteProperty(unsigned, "attestationSha256");
  attestation.attestationSha256 = digestCanonical(unsigned);
}

function resignInventory(attestation: SyntheticSide["attestation"]) {
  attestation.inventory.staticChunks.sort((left, right) => (
    left.servedPath.localeCompare(right.servedPath)
  ));
  attestation.inventory.staticChunkCount = attestation.inventory.staticChunks.length;
  attestation.inventory.staticChunkSetSha256 = digestCanonical(
    attestation.inventory.staticChunks.map(({ servedPath, sha256: digest, size }) => ({
      servedPath,
      sha256: digest,
      size,
    })),
  );
  attestation.inventory.inventorySha256 = digestCanonical({
    clientReferences: attestation.inventory.clientReferences,
    manifests: attestation.inventory.manifests,
    staticChunks: attestation.inventory.staticChunks,
  });
  attestation.correlation.staticChunkCount = attestation.inventory.staticChunks.length;
  resign(attestation);
}

function runCli(args: string[]) {
  return new Promise<{ stderr: string; stdout: string }>((resolve, reject) => {
    const child = import("node:child_process").then(({ spawn }) => spawn(process.execPath, [
      path.join(process.cwd(), "scripts/security/prove-served-cabinet-assets.mjs"),
      ...args,
    ], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }));
    void child.then((processHandle) => {
      let stdout = "";
      let stderr = "";
      processHandle.stdout.setEncoding("utf8");
      processHandle.stderr.setEncoding("utf8");
      processHandle.stdout.on("data", (chunk) => { stdout += chunk; });
      processHandle.stderr.on("data", (chunk) => { stderr += chunk; });
      processHandle.once("error", reject);
      processHandle.once("exit", (code, signal) => {
        if (code === 0) resolve({ stderr, stdout });
        else reject(new Error(`Proof CLI failed (${code ?? signal ?? "unknown"}): ${stderr}`));
      });
    }, reject);
  });
}

function header(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join(", ") : value;
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function digestCanonical(value: unknown) {
  return sha256(JSON.stringify(sortRecursively(value)));
}

function sortRecursively(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortRecursively);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortRecursively(record[key])]));
}

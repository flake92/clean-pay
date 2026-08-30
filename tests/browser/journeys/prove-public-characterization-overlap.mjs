import { spawn } from "node:child_process";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { validateProductionImageAssetAttestation } from "../../../scripts/security/prove-served-cabinet-assets.mjs";

import {
  journeyDockerCliEnvironment,
  runJourneyDockerCommand,
  withJourneyOwnedStackPair,
  writeJourneySanitizedOutput,
} from "./journey-owned-stack-orchestrator.mjs";
import { createJourneySanitizedErrorEvidence } from "./journey-error-evidence.mjs";
import {
  assertJourneyStackContract,
  assertProviderOverlapImagePlatformParity,
} from "./provider-overlap-proof-contract.mjs";
import {
  createPublicOverlapProof,
  createPublicOverlapStackBinding,
  readPublicOverlapOwnership,
  readPublicOverlapPairReceipt,
  resolvePublicOverlapProofPath,
  sha256,
} from "./public-overlap-proof-contract.mjs";
import { createPublicOverlapProcessFailureEvidence } from "./public-overlap-process-evidence.mjs";

const repositoryRoot = path.resolve(process.cwd());
const localPlaywrightCli = path.join(repositoryRoot, "node_modules", "playwright", "cli.js");
const publicOverlapConfig = path.join(
  repositoryRoot,
  "tests",
  "browser",
  "public-overlap.playwright.config.ts",
);
let preparedOwnership;
let argumentsByName;
let captureId;
let completed = false;

try {
  argumentsByName = parseArguments(process.argv.slice(2));
  captureId = requiredArgument(argumentsByName, "--capture-id", /^[a-f0-9]{16}$/);
  await assertRepositoryRoot();
  const baselineInput = await readStackInput("baseline");
  const candidateInput = await readStackInput("candidate");
  assertDistinctStackInputs(baselineInput, candidateInput);

  let bindingLedger;
  const session = await withJourneyOwnedStackPair({
    baseline: ownedStackInput(baselineInput),
    candidate: ownedStackInput(candidateInput),
  }, async (owned) => {
    const baselineBindingSha256 = createPublicOverlapStackBinding({
      role: "baseline",
      inputReceipt: owned.baseline.inputReceipt,
      runtime: owned.baseline.runtime,
      launch: owned.launch,
    });
    const candidateBindingSha256 = createPublicOverlapStackBinding({
      role: "candidate",
      inputReceipt: owned.candidate.inputReceipt,
      runtime: owned.candidate.runtime,
      launch: owned.launch,
    });
    bindingLedger = Object.freeze({ baselineBindingSha256, candidateBindingSha256 });

    await runPublicOverlapPlaywright("prepare", {
      CLEAN_PAY_PUBLIC_OVERLAP_CAPTURE_ID: captureId,
      CLEAN_PAY_PUBLIC_OVERLAP_BASELINE_BINDING_SHA256: baselineBindingSha256,
      CLEAN_PAY_PUBLIC_OVERLAP_CANDIDATE_BINDING_SHA256: candidateBindingSha256,
    }, 120_000);
    preparedOwnership = await readPublicOverlapOwnership({
      baselineBindingSha256,
      candidateBindingSha256,
      captureId,
      repositoryRoot,
    });

    const baselineOrigin = exactAppOrigin(baselineInput.contract.publications.app, "baseline");
    const candidateOrigin = exactAppOrigin(candidateInput.contract.publications.app, "candidate");
    if (baselineOrigin === candidateOrigin) {
      throw new Error("Public overlap owned stack origins must be distinct.");
    }
    const captureSettlements = await Promise.allSettled([
      runCapture("baseline", baselineOrigin, baselineBindingSha256),
      runCapture("candidate", candidateOrigin, candidateBindingSha256),
    ]);
    const captureErrors = rejectionReasons(captureSettlements);
    if (captureErrors.length > 0) {
      throw new AggregateError(
        captureErrors,
        "Both public characterization captures must settle before exact cleanup.",
      );
    }

    const comparisonEnvironment = {
      CLEAN_PAY_PUBLIC_OVERLAP_CAPTURE_ID: captureId,
      CLEAN_PAY_PUBLIC_OVERLAP_BASELINE_ORIGIN: baselineOrigin,
      CLEAN_PAY_PUBLIC_OVERLAP_CANDIDATE_ORIGIN: candidateOrigin,
      CLEAN_PAY_PUBLIC_OVERLAP_BASELINE_BINDING_SHA256: baselineBindingSha256,
      CLEAN_PAY_PUBLIC_OVERLAP_CANDIDATE_BINDING_SHA256: candidateBindingSha256,
      CLEAN_PAY_PUBLIC_OVERLAP_BASELINE_OWNERSHIP_SHA256:
        preparedOwnership.roles.baseline.ownershipSha256,
      CLEAN_PAY_PUBLIC_OVERLAP_CANDIDATE_OWNERSHIP_SHA256:
        preparedOwnership.roles.candidate.ownershipSha256,
    };
    await runPublicOverlapPlaywright("compare", comparisonEnvironment, 180_000);
    const expected = {
      baselineBindingSha256,
      baselineOrigin,
      baselineOwnershipSha256: preparedOwnership.roles.baseline.ownershipSha256,
      candidateBindingSha256,
      candidateOrigin,
      candidateOwnershipSha256: preparedOwnership.roles.candidate.ownershipSha256,
      captureId,
    };
    const pair = await readPublicOverlapPairReceipt({ expected, repositoryRoot });
    return Object.freeze({ comparisonEnvironment, expected, pair });
  });

  if (!bindingLedger || !preparedOwnership) {
    throw new Error("Public overlap owned-stack binding ledger is incomplete.");
  }
  await runPublicOverlapPlaywright("verify", session.value.comparisonEnvironment, 180_000);
  const pairAfterCleanup = await readPublicOverlapPairReceipt({
    expected: session.value.expected,
    repositoryRoot,
  });
  if (pairAfterCleanup.sha256 !== session.value.pair.sha256) {
    throw new Error("Public overlap pair receipt changed across exact stack cleanup.");
  }
  const proof = createPublicOverlapProof({
    baselineBindingSha256: bindingLedger.baselineBindingSha256,
    candidateBindingSha256: bindingLedger.candidateBindingSha256,
    captureId,
    cleanup: session.cleanup,
    launch: session.launch,
    pairReceiptSha256: pairAfterCleanup.sha256,
  });
  const proofBytes = Buffer.from(`${JSON.stringify(proof, null, 2)}\n`, "utf8");
  const proofPath = resolvePublicOverlapProofPath(repositoryRoot, captureId);
  await writeJourneySanitizedOutput(proofPath, proofBytes);
  completed = true;
  process.stdout.write(`${JSON.stringify({
    status: "live_public_characterization_overlap_proven",
    schemaVersion: proof.schemaVersion,
    captureId,
    caseCount: proof.caseCount,
    artifactCountPerSide: proof.artifactCountPerSide,
    proofSha256: sha256(proofBytes),
  })}\n`);
} catch (primaryError) {
  let failure = primaryError;
  if (!completed && preparedOwnership && captureId) {
    try {
      await runPublicOverlapPlaywright("cleanup", {
        CLEAN_PAY_PUBLIC_OVERLAP_CAPTURE_ID: captureId,
        CLEAN_PAY_PUBLIC_OVERLAP_PAIR_OWNERSHIP_SHA256:
          preparedOwnership.pairOwnershipSha256,
      }, 120_000);
    } catch (cleanupError) {
      failure = new AggregateError(
        [primaryError, cleanupError],
        "Public overlap proof failed and exact evidence cleanup was not proven.",
      );
    }
  }
  process.stderr.write(`${JSON.stringify({
    status: "live_public_characterization_overlap_failed",
    ...createJourneySanitizedErrorEvidence(failure),
  })}\n`);
  process.exitCode = 1;
}

async function runCapture(role, origin, bindingSha256) {
  return runPublicOverlapPlaywright("capture", {
    CLEAN_PAY_PUBLIC_OVERLAP_CAPTURE_ID: captureId,
    CLEAN_PAY_PUBLIC_OVERLAP_ROLE: role,
    CLEAN_PAY_PUBLIC_OVERLAP_BINDING_SHA256: bindingSha256,
    CLEAN_PAY_PUBLIC_OVERLAP_OWNERSHIP_SHA256:
      preparedOwnership.roles[role].ownershipSha256,
    CLEAN_PAY_BROWSER_BASE_URL: origin,
  }, 1_200_000);
}

async function runPublicOverlapPlaywright(mode, additions, timeoutMs) {
  if (!new Set(["capture", "cleanup", "compare", "prepare", "verify"]).has(mode)
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1_200_000
    || !additions || typeof additions !== "object" || Array.isArray(additions)) {
    throw new Error("Public overlap Playwright invocation is invalid.");
  }
  const environment = journeyDockerCliEnvironment();
  Object.assign(environment, additions, {
    CLEAN_PAY_PUBLIC_OVERLAP_MODE: mode,
    CLEAN_PAY_BROWSER_PLAYWRIGHT_OUTPUT_SCOPE: captureId,
    CI: "1",
    NODE_ENV: "test",
  });
  return boundedProcess(process.execPath, [
    localPlaywrightCli,
    "test",
    "--config",
    publicOverlapConfig,
  ], environment, timeoutMs, {
    mode,
    role: additions.CLEAN_PAY_PUBLIC_OVERLAP_ROLE ?? null,
  });
}

function boundedProcess(command, args, environment, timeoutMs, scope) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdoutBytes = 0;
    let stdout = Buffer.alloc(0);
    let stderrBytes = 0;
    let stderr = Buffer.alloc(0);
    let terminationReason = null;
    let settled = false;
    const timer = setTimeout(() => terminate("timeout"), timeoutMs);
    const forceTimer = { value: undefined };
    const terminate = (reason) => {
      if (terminationReason !== null) return;
      terminationReason = reason;
      child.kill("SIGTERM");
      forceTimer.value = setTimeout(() => child.kill("SIGKILL"), 2_000);
    };
    child.stdout.on("data", (chunk) => {
      const bytes = Buffer.from(chunk);
      stdoutBytes += bytes.byteLength;
      if (stdout.byteLength < 2 * 1024 * 1024) {
        stdout = Buffer.concat([stdout, bytes]).subarray(0, 2 * 1024 * 1024);
      }
      if (stdoutBytes > 2 * 1024 * 1024) terminate("stdout-overflow");
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.byteLength;
      if (stderr.byteLength >= 64 * 1024) return;
      stderr = Buffer.concat([stderr, Buffer.from(chunk)]).subarray(0, 64 * 1024);
    });
    child.once("error", () => terminate("spawn-error"));
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceTimer.value);
      if (code === 0 && signal === null && terminationReason === null) {
        resolve();
        return;
      }
      process.stderr.write(`${JSON.stringify(createPublicOverlapProcessFailureEvidence({
        code,
        mode: scope.mode,
        role: scope.role,
        signal,
        stderr,
        stderrBytes,
        stdout,
        stdoutBytes,
        terminationReason,
      }))}\n`);
      reject(new Error(
        `Bounded public overlap Playwright operation failed (`
        + `${terminationReason ?? "exit"}:${code ?? signal ?? "unknown"}:${sha256(stderr)}).`,
      ));
    });
  });
}

async function readStackInput(role) {
  const contractPath = await exactExternalFile(
    requiredArgument(argumentsByName, `--${role}-contract`, /.+/),
    `${role} contract`,
  );
  const contractBytes = await readBoundedBytes(contractPath, 64 * 1024, `${role} contract`);
  const contract = assertJourneyStackContract(parseJson(contractBytes, `${role} contract`), role);
  const expectedAssetImageDigest = requiredArgument(
    argumentsByName,
    `--${role}-asset-image-digest`,
    /^sha256:[a-f0-9]{64}$/,
  );
  const expectedMigrationAssetImageDigest = requiredArgument(
    argumentsByName,
    `--${role}-migration-asset-image-digest`,
    /^sha256:[a-f0-9]{64}$/,
  );
  const assetAttestationPath = await exactExternalFile(
    requiredArgument(argumentsByName, `--${role}-asset-attestation`, /.+/),
    `${role} asset attestation`,
  );
  const assetDocument = await readBoundedJson(
    assetAttestationPath,
    32 * 1024 * 1024,
    `${role} asset attestation`,
  );
  const expectedPlatform = Object.freeze(parseAssetPlatform(assetDocument));
  const assetAttestation = validateProductionImageAssetAttestation(assetDocument, {
    fixtureContract: { version: "journey-v5", sha256: contract.fixtureContract.sha256 },
    imageDigest: expectedAssetImageDigest,
    platform: expectedPlatform,
    publicBuildContract: contract.publicBuildContract,
    revision: contract.revision,
  }, role);
  return Object.freeze({
    role,
    contract,
    contractPath,
    assetAttestationPath,
    expectedAssetImageDigest,
    expectedApplicationImageConfigDigest: assetAttestation.source.configDigest,
    expectedApplicationManifestDigest: assetAttestation.source.manifestDigest,
    expectedApplicationRepoDigests: Object.freeze([...new Set([
      assetAttestation.source.imageDigest,
      assetAttestation.source.manifestDigest,
    ])].sort()),
    expectedPlatform,
    expectedMigrationAssetImageDigest,
  });
}

function ownedStackInput(input) {
  return {
    repositoryRoot,
    contractPath: input.contractPath,
    contract: input.contract,
    expectedApplicationAssetImageDigest: input.expectedAssetImageDigest,
    expectedApplicationImageConfigDigest: input.expectedApplicationImageConfigDigest,
    expectedApplicationManifestDigest: input.expectedApplicationManifestDigest,
    expectedApplicationRepoDigests: input.expectedApplicationRepoDigests,
    expectedImagePlatform: input.expectedPlatform,
    expectedMigrationAssetImageDigest: input.expectedMigrationAssetImageDigest,
    runDocker: docker,
  };
}

function docker(args, maximumBytes = 64 * 1024, environment = journeyDockerCliEnvironment(), options = {}) {
  return runJourneyDockerCommand(args, maximumBytes, environment, {
    repositoryRoot,
    ...options,
  });
}

function assertDistinctStackInputs(baseline, candidate) {
  assertProviderOverlapImagePlatformParity(baseline.expectedPlatform, candidate.expectedPlatform);
  const baselinePublications = Object.values(baseline.contract.publications);
  const candidatePublications = Object.values(candidate.contract.publications);
  if (
    baseline.contract.project === candidate.contract.project
    || baseline.contract.revision === candidate.contract.revision
    || baseline.contractPath === candidate.contractPath
    || baseline.assetAttestationPath === candidate.assetAttestationPath
    || baseline.expectedAssetImageDigest === candidate.expectedAssetImageDigest
    || baseline.expectedApplicationImageConfigDigest
      === candidate.expectedApplicationImageConfigDigest
    || baseline.expectedMigrationAssetImageDigest === candidate.expectedMigrationAssetImageDigest
    || baselinePublications.some((publication) => candidatePublications.includes(publication))
  ) {
    throw new Error("Public overlap inputs must identify two distinct isolated image stacks.");
  }
  if (JSON.stringify(baseline.contract.fixtureContract)
      !== JSON.stringify(candidate.contract.fixtureContract)
    || JSON.stringify(baseline.contract.publicBuildContract)
      !== JSON.stringify(candidate.contract.publicBuildContract)) {
    throw new Error("Public overlap stack contracts do not share exact public fixtures/build inputs.");
  }
}

function exactAppOrigin(publication, role) {
  if (!/^127\.0\.0\.1:[1-9]\d{3,4}$/.test(publication)) {
    throw new Error(`${role} public application publication is invalid.`);
  }
  const origin = `http://${publication}`;
  const parsed = new URL(origin);
  if (parsed.origin !== origin || Number(parsed.port) > 65_535) {
    throw new Error(`${role} public application origin is invalid.`);
  }
  return origin;
}

function parseArguments(values) {
  if (values.length % 2 !== 0) {
    throw new Error("Public overlap proof requires exact flag/value pairs.");
  }
  const allowed = new Set([
    "--baseline-contract",
    "--baseline-asset-attestation",
    "--baseline-asset-image-digest",
    "--baseline-migration-asset-image-digest",
    "--candidate-contract",
    "--candidate-asset-attestation",
    "--candidate-asset-image-digest",
    "--candidate-migration-asset-image-digest",
    "--capture-id",
  ]);
  const result = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!allowed.has(name) || result.has(name) || !value || value.startsWith("--")) {
      throw new Error("Public overlap proof arguments do not match the exact contract.");
    }
    result.set(name, value);
  }
  if (result.size !== allowed.size) {
    throw new Error("Public overlap proof requires every exact input flag once.");
  }
  return result;
}

function requiredArgument(values, name, pattern) {
  const value = values.get(name);
  if (typeof value !== "string" || value !== value.trim() || !pattern.test(value)) {
    throw new Error(`${name} is invalid.`);
  }
  return value;
}

async function assertRepositoryRoot() {
  const packageValue = await readBoundedJson(
    path.join(repositoryRoot, "package.json"),
    64 * 1024,
    "repository package",
  );
  const cli = await lstat(localPlaywrightCli);
  if (packageValue?.name !== "clean-pay" || packageValue?.private !== true
    || !cli.isFile() || cli.isSymbolicLink()) {
    throw new Error("Public overlap proof must use the exact local Clean Pay toolchain.");
  }
}

async function exactExternalFile(rawPath, label) {
  if (!path.isAbsolute(rawPath)) throw new Error(`${label} path must be absolute.`);
  const requested = await lstat(rawPath);
  const resolved = await realpath(rawPath);
  if (isWithin(repositoryRoot, resolved)) {
    throw new Error(`${label} must stay outside the repository.`);
  }
  const details = await lstat(resolved);
  if (!details.isFile() || requested.isSymbolicLink()) {
    throw new Error(`${label} must be a regular external file.`);
  }
  return resolved;
}

async function readBoundedJson(target, maximumBytes, label) {
  return parseJson(await readBoundedBytes(target, maximumBytes, label), label);
}

async function readBoundedBytes(target, maximumBytes, label) {
  const before = await stat(target);
  if (!before.isFile() || before.size < 1 || before.size > maximumBytes) {
    throw new Error(`${label} exceeds its bounded file contract.`);
  }
  const bytes = await readFile(target);
  const after = await stat(target);
  if (bytes.byteLength !== before.size || after.size !== before.size
    || after.mtimeMs !== before.mtimeMs) {
    throw new Error(`${label} changed while it was read.`);
  }
  return bytes;
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function parseAssetPlatform(document) {
  const platform = document?.source?.platform;
  if (!platform || Object.keys(platform).sort().join(",") !== "architecture,os"
    || platform.os !== "linux" || !new Set(["amd64", "arm64"]).has(platform.architecture)) {
    throw new Error("Public overlap asset attestation platform is invalid.");
  }
  return { architecture: platform.architecture, os: platform.os };
}

function rejectionReasons(settlements) {
  return settlements
    .filter(({ status }) => status === "rejected")
    .map(({ reason }) => reason);
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

import { spawn } from "node:child_process";
import { writeSync } from "node:fs";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { validateProductionImageAssetAttestation } from "../../../scripts/security/prove-served-cabinet-assets.mjs";

import {
  collectJourneyOneShotLifecycleFailureEvidence,
} from "./journey-compose-runtime-attestation.mjs";
import {
  collectJourneyDockerFailureEvidence,
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
  readPublicOverlapPairOwnership,
  readPublicOverlapPairReceipt,
  resolvePublicOverlapProofPath,
  sha256,
} from "./public-overlap-proof-contract.mjs";
import {
  createPublicOverlapInvocationFailureEvidence,
  createPublicOverlapProcessFailureEvidence,
  createPublicOverlapProcessFailureBundle,
  publicOverlapProcessFailureFilename,
} from "./public-overlap-process-evidence.mjs";
import {
  extractPublicOverlapProjectedMismatchEvidence,
} from "../public-overlap-mismatch-evidence.mjs";
import { publishPublicOverlapFailureOutputs } from "./public-overlap-failure-publication.mjs";

const repositoryRoot = path.resolve(process.cwd());
const localPlaywrightCli = path.join(repositoryRoot, "node_modules", "playwright", "cli.js");
const publicOverlapConfig = path.join(
  repositoryRoot,
  "tests",
  "browser",
  "public-overlap.playwright.config.ts",
);
let preparedOwnership;
let preparedPairOwnership;
let argumentsByName;
let captureId;
let completed = false;
let failureOutputRoot;
const processFailureEvidence = [];
const invocationFailureEvidence = [];

try {
  argumentsByName = parseArguments(process.argv.slice(2));
  captureId = requiredArgument(argumentsByName, "--capture-id", /^[a-f0-9]{16}$/);
  failureOutputRoot = await exactFailureOutputRoot(
    process.env.CLEAN_PAY_PUBLIC_OVERLAP_FAILURE_OUTPUT_ROOT,
    captureId,
  );
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
    preparedPairOwnership = await readPublicOverlapPairOwnership({
      captureId,
      repositoryRoot,
    });
    const ownership = await readPublicOverlapOwnership({
      baselineBindingSha256,
      candidateBindingSha256,
      captureId,
      expectedPairOwnershipSha256: preparedPairOwnership.pairOwnershipSha256,
      repositoryRoot,
    });
    preparedOwnership = ownership;

    const baselineOrigin = exactAppOrigin(baselineInput.contract.publications.app, "baseline");
    const candidateOrigin = exactAppOrigin(candidateInput.contract.publications.app, "candidate");
    if (baselineOrigin === candidateOrigin) {
      throw new Error("Public overlap owned stack origins must be distinct.");
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
    const captureSettlements = await Promise.allSettled([
      runCapturePair(comparisonEnvironment),
    ]);
    const captureErrors = captureSettlements.flatMap((result) => (
      result.status === "rejected" ? [result.reason] : []
    ));
    if (captureErrors.length > 0) {
      throw new AggregateError(
        captureErrors,
        "Paired public characterization capture must settle before exact cleanup.",
      );
    }
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
  const cleanupPairOwnershipSha256 = preparedPairOwnership?.pairOwnershipSha256;
  if (!completed && cleanupPairOwnershipSha256 && captureId) {
    try {
      await runPublicOverlapPlaywright("cleanup", {
        CLEAN_PAY_PUBLIC_OVERLAP_CAPTURE_ID: captureId,
        CLEAN_PAY_PUBLIC_OVERLAP_PAIR_OWNERSHIP_SHA256:
          cleanupPairOwnershipSha256,
      }, 120_000);
    } catch (cleanupError) {
      failure = new AggregateError(
        [primaryError, cleanupError],
        "Public overlap proof failed and exact evidence cleanup was not proven.",
      );
    }
  }
  let failureBundle;
  if (processFailureEvidence.length > 0 && captureId && failureOutputRoot) {
    try {
      failureBundle = createPublicOverlapProcessFailureBundle(
        captureId,
        processFailureEvidence,
      );
      const failureBundleBytes = Buffer.from(
        `${JSON.stringify(failureBundle, null, 2)}\n`,
        "utf8",
      );
      const receipt = await writeJourneySanitizedOutput(
        path.join(failureOutputRoot, "public-process-failures.json"),
        failureBundleBytes,
      );
      if (receipt.bytes !== failureBundleBytes.byteLength
        || receipt.sha256 !== sha256(failureBundleBytes)
        || receipt.status !== "sanitized-create-only-output-written") {
        throw new Error("Public overlap process failure bundle receipt is invalid.");
      }
    } catch (bundleError) {
      failure = new AggregateError(
        [failure, bundleError],
        "Public overlap proof failed and its sanitized process bundle was not sealed.",
      );
    }
  }
  process.stderr.write(`${JSON.stringify({
    status: "live_public_characterization_overlap_failed",
    dockerFailures: collectJourneyDockerFailureEvidence(failure),
    invocationFailures: invocationFailureEvidence,
    processFailures: failureBundle?.failures ?? [],
    runtimeFailures: collectJourneyOneShotLifecycleFailureEvidence(failure),
    ...createJourneySanitizedErrorEvidence(failure),
  })}\n`);
  process.exitCode = 1;
}

async function runCapturePair(comparisonEnvironment) {
  const observedFailures = totalObservedFailures();
  try {
    return await runPublicOverlapPlaywright("capture", {
      ...comparisonEnvironment,
      CLEAN_PAY_PUBLIC_OVERLAP_ROLE: "pair",
    }, 1_200_000);
  } catch (error) {
    if (totalObservedFailures() === observedFailures) {
      recordInvocationFailure("capture-input", "capture", "pair", error);
    }
    throw error;
  }
}

async function runPublicOverlapPlaywright(mode, additions, timeoutMs) {
  const role = additions?.CLEAN_PAY_PUBLIC_OVERLAP_ROLE ?? null;
  try {
    if (!new Set(["capture", "cleanup", "compare", "prepare", "verify"]).has(mode)
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1_200_000
      || !additions || typeof additions !== "object" || Array.isArray(additions)) {
      throw new Error("Public overlap Playwright invocation is invalid.");
    }
  } catch (error) {
    recordInvocationFailure("invocation-policy", mode, role, error);
    throw error;
  }
  let environment;
  try {
    environment = journeyDockerCliEnvironment();
    Object.assign(environment, additions, {
      CLEAN_PAY_PUBLIC_OVERLAP_MODE: mode,
      CLEAN_PAY_BROWSER_PLAYWRIGHT_OUTPUT_SCOPE: captureId,
      CI: "1",
      NODE_ENV: "test",
    });
  } catch (error) {
    recordInvocationFailure("environment-policy", mode, role, error);
    throw error;
  }
  const observedFailures = totalObservedFailures();
  try {
    return await boundedProcess(process.execPath, [
      localPlaywrightCli,
      "test",
      "--config",
      publicOverlapConfig,
    ], environment, timeoutMs, { mode, role });
  } catch (error) {
    if (totalObservedFailures() === observedFailures) {
      recordInvocationFailure("process-construction", mode, role, error);
    }
    throw error;
  }
}

function recordInvocationFailure(stage, mode, role, error) {
  invocationFailureEvidence.push(createPublicOverlapInvocationFailureEvidence({
    error,
    mode,
    role,
    stage,
  }));
}

function totalObservedFailures() {
  return processFailureEvidence.length + invocationFailureEvidence.length;
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
      const operationError = new Error(
        `Bounded public overlap Playwright operation failed (`
        + `${terminationReason ?? "exit"}:${code ?? signal ?? "unknown"}:${sha256(stderr)}).`,
      );
      let evidence;
      let evidenceBytes;
      let mismatchEvidenceBytes;
      try {
        evidence = createPublicOverlapProcessFailureEvidence({
          code,
          mode: scope.mode,
          role: scope.role,
          signal,
          stderr,
          stderrBytes,
          stdout,
          stdoutBytes,
          terminationReason,
        });
        processFailureEvidence.push(evidence);
        evidenceBytes = Buffer.from(`${JSON.stringify(evidence)}\n`, "utf8");
      } catch (evidenceError) {
        reject(new AggregateError(
          [operationError, evidenceError],
          "Public overlap process failed before sanitized evidence could be projected.",
        ));
        return;
      }
      let mismatchEvidenceError;
      try {
        const mismatchEvidence = extractPublicOverlapProjectedMismatchEvidence(stdout, stderr);
        if (mismatchEvidence !== null) {
          if (scope.mode !== "compare" || scope.role !== null) {
            throw new Error("Public overlap projected mismatch escaped compare scope.");
          }
          mismatchEvidenceBytes = Buffer.from(
            `${JSON.stringify(mismatchEvidence, null, 2)}\n`,
            "utf8",
          );
        }
      } catch (error) {
        mismatchEvidenceError = error;
      }
      void publishPublicOverlapFailureOutputs({
        baseBytes: evidenceBytes,
        baseFilename: publicOverlapProcessFailureFilename(scope.mode, scope.role),
        failureOutputRoot,
        mismatchBytes: mismatchEvidenceBytes ?? null,
        writeOutput: writeJourneySanitizedOutput,
      }).then(() => {
        try {
          writeSync(process.stderr.fd, evidenceBytes);
        } catch {
          // The sealed create-only artifact remains authoritative when the log pipe is unavailable.
        }
        if (mismatchEvidenceError !== undefined) {
          reject(new AggregateError(
            [operationError, mismatchEvidenceError],
            "Public overlap process failed with invalid projected mismatch evidence.",
          ));
        } else {
          reject(operationError);
        }
      }).catch((publicationError) => {
        const failures = [operationError];
        if (mismatchEvidenceError !== undefined) failures.push(mismatchEvidenceError);
        failures.push(publicationError);
        reject(new AggregateError(
          failures,
          "Public overlap process failed and sanitized evidence was not sealed.",
        ));
      });
    });
  });
}

async function exactFailureOutputRoot(rawPath, expectedCaptureId) {
  const expectedParent = path.join(
    repositoryRoot,
    "test-results",
    "browser-live-pair-ci",
  );
  const expected = path.join(expectedParent, expectedCaptureId);
  if (typeof rawPath !== "string" || !path.isAbsolute(rawPath)
    || path.resolve(rawPath) !== expected) {
    throw new Error("Public overlap sanitized failure output root is invalid.");
  }
  const [details, resolved, parentResolved] = await Promise.all([
    lstat(rawPath),
    realpath(rawPath),
    realpath(expectedParent),
  ]);
  if (!details.isDirectory() || details.isSymbolicLink()
    || path.resolve(resolved) !== expected
    || path.dirname(path.resolve(resolved)) !== path.resolve(parentResolved)) {
    throw new Error("Public overlap sanitized failure output root is not exact.");
  }
  return resolved;
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

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

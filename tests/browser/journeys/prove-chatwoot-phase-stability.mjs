import { realpath } from "node:fs/promises";
import path from "node:path";

import { orchestrateChatwootPhaseProof } from "./chatwoot-phase-proof-orchestrator.mjs";
import {
  readExactChatwootExternalPlan,
  sha256,
} from "./chatwoot-phase-proof-contract.mjs";

const MAXIMUM_PLAN_BYTES = 256 * 1024;

try {
  const repositoryRoot = await realpath(process.cwd());
  const argumentsByName = parseArguments(process.argv.slice(2));
  const planPath = exactAbsolutePath(
    requiredArgument(argumentsByName, "--plan"),
    "Chatwoot launch plan",
  );
  const outputDirectory = exactAbsolutePath(
    requiredArgument(argumentsByName, "--output"),
    "Chatwoot evidence output",
  );
  const plan = parseJson(
    await readExactChatwootExternalPlan(planPath, repositoryRoot, MAXIMUM_PLAN_BYTES),
  );
  const result = await orchestrateChatwootPhaseProof({
    input: plan,
    outputDirectory,
    repositoryRoot,
  });
  process.stdout.write(`${JSON.stringify({
    status: "dual_image_chatwoot_phase_stability_proven",
    schemaVersion: result.proof.schemaVersion,
    kind: result.proof.kind,
    baselineImageDigest: result.proof.comparison.baselineImageDigest,
    candidateImageDigest: result.proof.comparison.candidateImageDigest,
    proofSha256: result.evidence.proofSha256,
    manifestSha256: result.evidence.manifestSha256,
    aggregateSha256: result.evidence.aggregateSha256,
    artifactCount: result.evidence.artifactCount,
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "dual_image_chatwoot_phase_stability_failed",
    errorClass: error?.constructor?.name ?? "Error",
    messageSha256: sha256(String(error?.message ?? "unknown")),
  })}\n`);
  process.exitCode = 1;
}

function parseArguments(values) {
  if (!Array.isArray(values) || values.length !== 4) {
    throw new Error("Chatwoot proof requires exact --plan and --output flag/value pairs.");
  }
  const allowed = new Set(["--output", "--plan"]);
  const result = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!allowed.has(name) || result.has(name) || !value || value.startsWith("--")) {
      throw new Error("Chatwoot proof arguments do not match the exact contract.");
    }
    result.set(name, value);
  }
  if (result.size !== allowed.size) {
    throw new Error("Chatwoot proof requires every exact input flag once.");
  }
  return result;
}

function requiredArgument(values, name) {
  const value = values.get(name);
  if (typeof value !== "string" || value !== value.trim() || value.length === 0) {
    throw new Error(`${name} is invalid.`);
  }
  return value;
}

function exactAbsolutePath(value, label) {
  if (
    !path.isAbsolute(value)
    || normalizePath(path.normalize(value)) !== normalizePath(value)
  ) {
    throw new Error(`${label} must be an exact absolute path.`);
  }
  return value;
}

function parseJson(bytes) {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new Error("Chatwoot launch plan is not valid JSON.");
  }
}

function normalizePath(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

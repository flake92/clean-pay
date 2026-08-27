#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
} from "node:fs";
import {
  mkdtemp,
  open,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { finished } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";

const ATTESTATION_KIND = "clean-pay-production-image-static-asset-attestation";
const ATTESTATION_SCHEMA_VERSION = 1;
const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const MAX_STATIC_ASSET_BYTES = 128 * 1024 * 1024;
const MAX_STATIC_ASSET_COUNT = 4_096;
const MAX_STATIC_ASSET_TOTAL_BYTES = 1024 * 1024 * 1024;
const MAX_TAR_ENTRIES = 250_000;
const MAX_TAR_TRAILER_BYTES = 1024 * 1024;
const TAR_BLOCK_BYTES = 512;
const SHA256 = /^[a-f0-9]{64}$/;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40}$/;
const PLATFORM = /^(?<os>linux)\/(?<architecture>amd64|arm64)$/;
const STATIC_CHUNK_PREFIX = "app/.next/static/chunks/";
const STATIC_MEDIA_PREFIX = "app/.next/static/media/";
const NEXT_PREFIX = "app/.next/";
const CLIENT_REFERENCE_SUFFIX = "_client-reference-manifest.js";
const CLIENT_REFERENCE_KEYS = [
  "clientModules",
  "edgeRscModuleMapping",
  "edgeSSRModuleMapping",
  "entryCSSFiles",
  "entryJSFiles",
  "moduleLoading",
  "rscModuleMapping",
  "ssrModuleMapping",
];

export async function attestProductionImageArchive({
  archivePath,
  expectedImageDigest,
  expectedRevision,
  expectedPublicBuildContractVersion,
  expectedPublicBuildContractSha256,
  platform,
}) {
  validateExpectedInputs({
    archivePath,
    expectedImageDigest,
    expectedRevision,
    expectedPublicBuildContractVersion,
    expectedPublicBuildContractSha256,
    platform,
  });

  const archive = await scanTarFile(archivePath);
  const ociLayout = await readJsonEntry(archive, "oci-layout", MAX_JSON_BYTES);
  assertExactKeys(ociLayout, ["imageLayoutVersion"], "OCI layout");
  if (ociLayout.imageLayoutVersion !== "1.0.0") {
    throw new Error("Production image archive uses an unsupported OCI layout version.");
  }

  const rootIndex = await readJsonEntry(archive, "index.json", MAX_JSON_BYTES);
  assertOciIndex(rootIndex, "OCI archive index");
  const sourceDescriptor = exactlyOne(
    rootIndex.manifests.filter((descriptor) => descriptor?.digest === expectedImageDigest),
    "exact expected image digest in OCI archive index",
  );
  const sourceDocument = await readVerifiedJsonBlob(archive, sourceDescriptor, "source image descriptor");
  const selectedPlatform = parsePlatform(platform);
  const selected = sourceDocument.mediaType === "application/vnd.oci.image.index.v1+json"
    ? await selectPlatformManifest(archive, sourceDocument, selectedPlatform)
    : { descriptor: sourceDescriptor, document: sourceDocument };
  const platformManifest = selected.document;
  assertOciManifest(platformManifest, "platform image manifest");

  const config = await readVerifiedJsonBlob(
    archive,
    platformManifest.config,
    "platform image config",
  );
  validateImageConfig(config, {
    expectedRevision,
    expectedPublicBuildContractVersion,
    expectedPublicBuildContractSha256,
    platform: selectedPlatform,
    layerCount: platformManifest.layers.length,
  });

  const trackedFiles = new Map();
  for (let index = 0; index < platformManifest.layers.length; index += 1) {
    const descriptor = platformManifest.layers[index];
    const operations = await readVerifiedLayer(
      archive,
      descriptor,
      config.rootfs.diff_ids[index],
      `platform layer ${index + 1}`,
    );
    applyLayerOperations(trackedFiles, operations);
  }

  const inventory = buildNextInventory(trackedFiles);
  const source = {
    configDigest: platformManifest.config.digest,
    imageDigest: expectedImageDigest,
    manifestDigest: selected.descriptor.digest,
    platform: selectedPlatform,
    publicBuildContract: {
      sha256: expectedPublicBuildContractSha256,
      version: expectedPublicBuildContractVersion,
    },
    revision: expectedRevision,
    role: "app",
  };
  const attested = {
    kind: ATTESTATION_KIND,
    schemaVersion: ATTESTATION_SCHEMA_VERSION,
    source,
    inventory,
    correlation: {
      bodyDigestAlgorithm: "sha256",
      bodyDigestInput: "decoded response body bytes",
      key: "servedPath",
      staticChunkCount: inventory.staticChunks.length,
    },
  };
  return {
    ...attested,
    attestationSha256: sha256Bytes(Buffer.from(canonicalJson(attested), "utf8")),
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  let temporaryRoot;
  let archivePath = options.archive;
  try {
    if (options.image) {
      temporaryRoot = await mkdtemp(path.join(tmpdir(), "clean-pay-image-assets-"));
      archivePath = path.join(temporaryRoot, "image.oci.tar");
      await saveImageReadOnly(options.image, archivePath);
    }
    const result = await attestProductionImageArchive({
      archivePath,
      expectedImageDigest: options.expectedImageDigest,
      expectedRevision: options.expectedRevision,
      expectedPublicBuildContractVersion: options.expectedPublicBuildContractVersion,
      expectedPublicBuildContractSha256: options.expectedPublicBuildContractSha256,
      platform: options.platform,
    });
    const rendered = `${JSON.stringify(result, null, 2)}\n`;
    if (options.output) {
      await writeFile(path.resolve(options.output), rendered, { encoding: "utf8", flag: "wx", mode: 0o600 });
      process.stdout.write(`${JSON.stringify({
        attestationSha256: result.attestationSha256,
        imageDigest: result.source.imageDigest,
        manifestCount: result.inventory.manifests.length,
        staticChunkCount: result.inventory.staticChunks.length,
        status: "production_image_assets_attested",
      })}\n`);
    } else {
      process.stdout.write(rendered);
    }
  } finally {
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function parseArguments(args) {
  const allowed = new Set([
    "--archive",
    "--expected-image-digest",
    "--expected-public-build-contract-sha256",
    "--expected-public-build-contract-version",
    "--expected-revision",
    "--image",
    "--output",
    "--platform",
  ]);
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name) || typeof value !== "string" || value.length === 0 || values.has(name)) {
      throw new Error(usage());
    }
    values.set(name, value);
  }
  if ((values.has("--image") ? 1 : 0) + (values.has("--archive") ? 1 : 0) !== 1) {
    throw new Error(usage());
  }
  const required = [
    "--expected-image-digest",
    "--expected-public-build-contract-sha256",
    "--expected-public-build-contract-version",
    "--expected-revision",
    "--platform",
  ];
  if (required.some((name) => !values.has(name))) throw new Error(usage());
  const image = values.get("--image");
  if (image && !/^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,299}$/.test(image)) {
    throw new Error("Production image reference is invalid.");
  }
  return {
    archive: values.get("--archive"),
    expectedImageDigest: values.get("--expected-image-digest"),
    expectedPublicBuildContractSha256: values.get("--expected-public-build-contract-sha256"),
    expectedPublicBuildContractVersion: values.get("--expected-public-build-contract-version"),
    expectedRevision: values.get("--expected-revision"),
    image,
    output: values.get("--output"),
    platform: values.get("--platform"),
  };
}

function usage() {
  return "usage: attest-production-image-assets.mjs (--image <reference> | --archive <oci.tar>) "
    + "--expected-image-digest <sha256:...> --expected-revision <40-hex> "
    + "--expected-public-build-contract-version <version> "
    + "--expected-public-build-contract-sha256 <64-hex> --platform <linux/amd64|linux/arm64> "
    + "[--output <new-file>]";
}

async function saveImageReadOnly(image, archivePath) {
  const child = spawn("docker", ["image", "save", "--output", archivePath, image], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    if (stderr.length < 4_096) stderr += chunk.slice(0, 4_096 - stderr.length);
  });
  const outcome = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  if (outcome.code !== 0) {
    throw new Error(`docker image save failed (${outcome.code ?? outcome.signal ?? "unknown"}): ${sanitize(stderr)}`);
  }
  const details = await stat(archivePath);
  if (!details.isFile() || details.size <= 0 || details.size > MAX_ARCHIVE_BYTES) {
    throw new Error("Saved production image archive violates its bounded size contract.");
  }
}

function validateExpectedInputs(values) {
  if (typeof values.archivePath !== "string" || values.archivePath.length === 0) {
    throw new Error("Production image OCI archive path is required.");
  }
  if (!SHA256_DIGEST.test(values.expectedImageDigest ?? "")) {
    throw new Error("Expected production image digest is invalid.");
  }
  if (!REVISION.test(values.expectedRevision ?? "")) {
    throw new Error("Expected production image revision is invalid.");
  }
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(values.expectedPublicBuildContractVersion ?? "")) {
    throw new Error("Expected public build contract version is invalid.");
  }
  if (!SHA256.test(values.expectedPublicBuildContractSha256 ?? "")) {
    throw new Error("Expected public build contract SHA-256 is invalid.");
  }
  parsePlatform(values.platform);
}

function parsePlatform(value) {
  const match = PLATFORM.exec(value ?? "");
  if (!match?.groups) throw new Error("Expected production image platform is invalid.");
  return { architecture: match.groups.architecture, os: match.groups.os };
}

async function selectPlatformManifest(archive, imageIndex, platform) {
  assertOciIndex(imageIndex, "source image index");
  const descriptor = exactlyOne(imageIndex.manifests.filter((entry) => (
    entry?.mediaType === "application/vnd.oci.image.manifest.v1+json"
      && entry?.platform?.os === platform.os
      && entry?.platform?.architecture === platform.architecture
      && entry?.annotations?.["vnd.docker.reference.type"] !== "attestation-manifest"
  )), `platform manifest for ${platform.os}/${platform.architecture}`);
  return {
    descriptor,
    document: await readVerifiedJsonBlob(archive, descriptor, "platform image manifest"),
  };
}

function validateImageConfig(config, expected) {
  if (!isRecord(config) || !isRecord(config.config) || !isRecord(config.config.Labels)) {
    throw new Error("Platform image config is malformed.");
  }
  if (config.os !== expected.platform.os || config.architecture !== expected.platform.architecture) {
    throw new Error("Platform image config does not match the expected platform.");
  }
  const labels = config.config.Labels;
  const exactLabels = {
    "io.clean-pay.public-build-contract-sha256": expected.expectedPublicBuildContractSha256,
    "io.clean-pay.public-build-contract-version": expected.expectedPublicBuildContractVersion,
    "io.clean-pay.role": "app",
    "org.opencontainers.image.revision": expected.expectedRevision,
  };
  for (const [name, value] of Object.entries(exactLabels)) {
    if (labels[name] !== value) {
      throw new Error(`Platform image label ${name} does not match the exact expected value.`);
    }
  }
  if (
    !isRecord(config.rootfs)
    || config.rootfs.type !== "layers"
    || !Array.isArray(config.rootfs.diff_ids)
    || config.rootfs.diff_ids.length !== expected.layerCount
    || !config.rootfs.diff_ids.every((digest) => SHA256_DIGEST.test(digest))
  ) {
    throw new Error("Platform image root filesystem contract is malformed.");
  }
}

function assertOciIndex(value, label) {
  if (
    !isRecord(value)
    || value.schemaVersion !== 2
    || value.mediaType !== "application/vnd.oci.image.index.v1+json"
    || !Array.isArray(value.manifests)
    || value.manifests.length === 0
  ) {
    throw new Error(`${label} is malformed.`);
  }
  value.manifests.forEach((descriptor, index) => assertDescriptor(descriptor, `${label} descriptor ${index + 1}`));
}

function assertOciManifest(value, label) {
  if (
    !isRecord(value)
    || value.schemaVersion !== 2
    || value.mediaType !== "application/vnd.oci.image.manifest.v1+json"
    || !isRecord(value.config)
    || !Array.isArray(value.layers)
    || value.layers.length === 0
  ) {
    throw new Error(`${label} is malformed.`);
  }
  assertDescriptor(value.config, `${label} config`);
  value.layers.forEach((descriptor, index) => assertDescriptor(descriptor, `${label} layer ${index + 1}`));
}

function assertDescriptor(value, label) {
  if (
    !isRecord(value)
    || typeof value.mediaType !== "string"
    || !SHA256_DIGEST.test(value.digest ?? "")
    || !Number.isSafeInteger(value.size)
    || value.size <= 0
    || value.size > MAX_ARCHIVE_BYTES
  ) {
    throw new Error(`${label} is malformed.`);
  }
}

async function readVerifiedJsonBlob(archive, descriptor, label) {
  assertDescriptor(descriptor, label);
  if (descriptor.size > MAX_JSON_BYTES) throw new Error(`${label} exceeds its bounded JSON contract.`);
  const entry = blobEntry(archive, descriptor.digest, label);
  if (entry.size !== descriptor.size) throw new Error(`${label} size does not match its descriptor.`);
  const bytes = await readEntryBytes(archive, entry, MAX_JSON_BYTES);
  if (`sha256:${sha256Bytes(bytes)}` !== descriptor.digest) {
    throw new Error(`${label} SHA-256 does not match its descriptor.`);
  }
  return parseJson(bytes, label);
}

function blobEntry(archive, digest, label) {
  const [algorithm, value] = digest.split(":");
  if (algorithm !== "sha256" || !SHA256.test(value ?? "")) throw new Error(`${label} digest is invalid.`);
  const entry = archive.entries.get(`blobs/sha256/${value}`);
  if (!entry || entry.type !== "file") throw new Error(`${label} blob is missing from the OCI archive.`);
  return entry;
}

async function readVerifiedLayer(archive, descriptor, expectedDiffId, label) {
  assertDescriptor(descriptor, label);
  const entry = blobEntry(archive, descriptor.digest, label);
  if (entry.size !== descriptor.size) throw new Error(`${label} size does not match its descriptor.`);
  const raw = createReadStream(archive.file, {
    start: entry.dataOffset,
    end: entry.dataOffset + entry.size - 1,
  });
  const compressed = new HashingTransform();
  const uncompressed = new HashingTransform();
  let decoded;
  if (descriptor.mediaType === "application/vnd.oci.image.layer.v1.tar+gzip") {
    decoded = raw.pipe(compressed).pipe(createGunzip()).pipe(uncompressed);
  } else if (descriptor.mediaType === "application/vnd.oci.image.layer.v1.tar") {
    decoded = raw.pipe(compressed).pipe(uncompressed);
  } else {
    throw new Error(`${label} uses unsupported media type ${JSON.stringify(descriptor.mediaType)}.`);
  }
  let operations;
  try {
    operations = await collectLayerOperations(decoded, label);
    await Promise.all([finished(raw), finished(compressed), finished(uncompressed)]);
  } catch (error) {
    raw.destroy();
    compressed.destroy();
    uncompressed.destroy();
    await Promise.allSettled([finished(raw), finished(compressed), finished(uncompressed)]);
    throw error;
  }
  if (compressed.bytes !== descriptor.size || `sha256:${compressed.digest()}` !== descriptor.digest) {
    throw new Error(`${label} compressed bytes do not match their descriptor.`);
  }
  if (`sha256:${uncompressed.digest()}` !== expectedDiffId) {
    throw new Error(`${label} uncompressed diff-id does not match the image config.`);
  }
  return operations;
}

class HashingTransform extends Transform {
  #hash = createHash("sha256");
  #digested = false;
  bytes = 0;

  _transform(chunk, _encoding, callback) {
    this.bytes += chunk.length;
    this.#hash.update(chunk);
    callback(null, chunk);
  }

  digest() {
    if (this.#digested) throw new Error("Hashing transform digest was requested twice.");
    this.#digested = true;
    return this.#hash.digest("hex");
  }
}

async function collectLayerOperations(stream, label) {
  const reader = new StreamReader(stream);
  const additions = new Map();
  const whiteouts = [];
  let pendingPath;
  let localPax;
  let globalPax = {};
  let entryCount = 0;
  let zeroBlocks = 0;

  while (true) {
    const header = await reader.read(TAR_BLOCK_BYTES, true);
    if (header === null) break;
    if (isZeroBlock(header)) {
      zeroBlocks += 1;
      if (zeroBlocks >= 2) {
        await reader.assertRemainingZeroes();
        break;
      }
      continue;
    }
    if (zeroBlocks !== 0) throw new Error(`${label} TAR has data after an incomplete end marker.`);
    entryCount += 1;
    if (entryCount > MAX_TAR_ENTRIES) throw new Error(`${label} TAR exceeds its entry count limit.`);
    const parsed = parseTarHeader(header, label);
    const type = parsed.type;
    if (["pax", "global-pax", "gnu-long-name"].includes(type)) {
      const bytes = await reader.read(parsed.size);
      await reader.skip(tarPadding(parsed.size));
      if (type === "gnu-long-name") pendingPath = decodeTarText(bytes, `${label} GNU long path`).replace(/\0+$/, "");
      else if (type === "pax") localPax = parsePax(bytes, label);
      else globalPax = { ...globalPax, ...parsePax(bytes, label) };
      continue;
    }
    const attributes = { ...globalPax, ...localPax };
    localPax = undefined;
    const entryPath = normalizeTarPath(attributes.path ?? pendingPath ?? parsed.path, label);
    pendingPath = undefined;
    const contentSize = attributes.size === undefined ? parsed.size : parsePaxSize(attributes.size, label);
    if (contentSize !== parsed.size) {
      throw new Error(`${label} TAR PAX size does not match its physical entry size.`);
    }
    const whiteout = whiteoutOperation(entryPath);
    const relevant = relevantFileKind(entryPath);
    if (whiteout) {
      whiteouts.push(whiteout);
      await reader.skip(contentSize);
    } else if (relevant && type !== "file") {
      throw new Error(`${label} represents relevant Next.js path ${entryPath} as a non-file.`);
    } else if (relevant) {
      if (additions.has(entryPath)) throw new Error(`${label} repeats relevant Next.js path ${entryPath}.`);
      if (relevant === "manifest" && contentSize > MAX_MANIFEST_BYTES) {
        throw new Error(`${label} Next.js manifest exceeds its bounded size contract.`);
      }
      if (relevant !== "manifest" && contentSize > MAX_STATIC_ASSET_BYTES) {
        throw new Error(`${label} Next.js static asset exceeds its bounded size contract.`);
      }
      const hash = createHash("sha256");
      const buffers = relevant === "manifest" ? [] : undefined;
      await reader.consume(contentSize, (chunk) => {
        hash.update(chunk);
        buffers?.push(Buffer.from(chunk));
      });
      additions.set(entryPath, {
        bytes: buffers ? Buffer.concat(buffers) : undefined,
        kind: relevant,
        sha256: hash.digest("hex"),
        size: contentSize,
      });
    } else {
      await reader.skip(contentSize);
    }
    await reader.skip(tarPadding(contentSize));
  }
  if (zeroBlocks < 2) throw new Error(`${label} TAR is missing its complete end marker.`);
  return { additions, whiteouts };
}

class StreamReader {
  #iterator;
  #buffer = Buffer.alloc(0);
  #ended = false;

  constructor(stream) {
    this.#iterator = stream[Symbol.asyncIterator]();
  }

  async read(length, allowEof = false) {
    if (!Number.isSafeInteger(length) || length < 0) throw new Error("Invalid stream read length.");
    if (length === 0) return Buffer.alloc(0);
    const chunks = [];
    let remaining = length;
    await this.consume(remaining, (chunk) => {
      chunks.push(Buffer.from(chunk));
      remaining -= chunk.length;
    }, allowEof);
    if (remaining === length && allowEof) return null;
    if (remaining !== 0) throw new Error("Unexpected end of TAR stream.");
    return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, length);
  }

  async skip(length) {
    await this.consume(length, () => undefined);
  }

  async consume(length, visitor, allowEof = false) {
    let remaining = length;
    while (remaining > 0) {
      if (this.#buffer.length === 0) {
        if (this.#ended) {
          if (allowEof && remaining === length) return;
          throw new Error("Unexpected end of TAR stream.");
        }
        const next = await this.#iterator.next();
        if (next.done) {
          this.#ended = true;
          continue;
        }
        this.#buffer = Buffer.from(next.value);
        if (this.#buffer.length === 0) continue;
      }
      const size = Math.min(remaining, this.#buffer.length);
      const chunk = this.#buffer.subarray(0, size);
      visitor(chunk);
      this.#buffer = this.#buffer.subarray(size);
      remaining -= size;
    }
  }

  async assertRemainingZeroes() {
    if (this.#buffer.some((value) => value !== 0)) throw new Error("TAR contains non-zero trailing bytes.");
    this.#buffer = Buffer.alloc(0);
    while (!this.#ended) {
      const next = await this.#iterator.next();
      if (next.done) {
        this.#ended = true;
        break;
      }
      if (Buffer.from(next.value).some((value) => value !== 0)) {
        throw new Error("TAR contains non-zero trailing bytes.");
      }
    }
  }
}

function applyLayerOperations(files, operations) {
  for (const whiteout of operations.whiteouts) {
    for (const file of [...files.keys()]) {
      const deletesFile = whiteout.opaque
        ? whiteout.path === "" || file.startsWith(`${whiteout.path}/`)
        : file === whiteout.path || file.startsWith(`${whiteout.path}/`);
      if (deletesFile) files.delete(file);
    }
  }
  for (const [file, details] of operations.additions) files.set(file, details);
}

function buildNextInventory(files) {
  const staticChunks = [...files.entries()]
    .filter(([, details]) => ["static-chunk", "static-media"].includes(details.kind))
    .map(([file, details]) => ({
      imagePath: `/${file}`,
      servedPath: details.kind === "static-chunk"
        ? `/_next/static/chunks/${file.slice(STATIC_CHUNK_PREFIX.length)}`
        : `/_next/static/media/${file.slice(STATIC_MEDIA_PREFIX.length)}`,
      sha256: details.sha256,
      size: details.size,
    }))
    .sort(comparePath("servedPath"));
  const staticAssetBytes = staticChunks.reduce((total, entry) => total + entry.size, 0);
  if (staticChunks.length > MAX_STATIC_ASSET_COUNT
    || !Number.isSafeInteger(staticAssetBytes)
    || staticAssetBytes > MAX_STATIC_ASSET_TOTAL_BYTES) {
    throw new Error("Production image static asset inventory exceeds its bounded contract.");
  }
  const manifests = [...files.entries()]
    .filter(([, details]) => details.kind === "manifest")
    .map(([file, details]) => ({
      imagePath: `/${file}`,
      kind: file.endsWith(CLIENT_REFERENCE_SUFFIX) ? "client-reference" : "next-json",
      sha256: details.sha256,
      size: details.size,
    }))
    .sort(comparePath("imagePath"));
  if (staticChunks.length === 0 || manifests.length === 0) {
    throw new Error("Production image contains no complete Next.js static chunk/manifest inventory.");
  }
  const staticByServedPath = new Map(staticChunks.map((entry) => [entry.servedPath, entry]));
  const clientReferences = [...files.entries()]
    .filter(([file]) => file.endsWith(CLIENT_REFERENCE_SUFFIX))
    .map(([file, details]) => parseClientReferenceManifest(file, details, staticByServedPath))
    .sort(comparePath("route"));
  if (clientReferences.length === 0) {
    throw new Error("Production image contains no Next.js client-reference manifests.");
  }
  const routes = new Set();
  for (const entry of clientReferences) {
    if (routes.has(entry.route)) throw new Error(`Production image repeats client-reference route ${entry.route}.`);
    routes.add(entry.route);
  }
  const inventory = {
    clientReferences,
    manifests,
    staticChunks,
  };
  return {
    ...inventory,
    clientReferenceCount: clientReferences.length,
    inventorySha256: sha256Bytes(Buffer.from(canonicalJson(inventory), "utf8")),
    manifestCount: manifests.length,
    staticChunkCount: staticChunks.length,
    staticChunkSetSha256: digestCanonical(staticChunks.map(({ servedPath, sha256, size }) => ({
      servedPath,
      sha256,
      size,
    }))),
  };
}

function parseClientReferenceManifest(file, details, staticByServedPath) {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(details.bytes);
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  while (lines.at(-1) === "") lines.pop();
  if (
    lines.length !== 2
    || lines[0] !== "globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};"
  ) {
    throw new Error(`Client-reference manifest /${file} has an unsupported executable wrapper.`);
  }
  const prefix = "globalThis.__RSC_MANIFEST[";
  const separator = "] = ";
  const line = lines[1];
  const separatorIndex = line.indexOf(separator, prefix.length);
  if (!line.startsWith(prefix) || separatorIndex < 0 || !line.endsWith(";")) {
    throw new Error(`Client-reference manifest /${file} has an unsupported assignment wrapper.`);
  }
  const route = parseJson(Buffer.from(line.slice(prefix.length, separatorIndex)), "client-reference route");
  if (typeof route !== "string" || !/^\/[\x20-\x7e]{0,511}$/.test(route)) {
    throw new Error(`Client-reference manifest /${file} contains an invalid route.`);
  }
  const value = parseJson(
    Buffer.from(line.slice(separatorIndex + separator.length, -1)),
    `client-reference manifest ${route}`,
  );
  assertExactKeys(value, CLIENT_REFERENCE_KEYS, `client-reference manifest ${route}`);
  if (
    !isRecord(value.clientModules)
    || !isRecord(value.entryJSFiles)
    || !isRecord(value.entryCSSFiles)
    || !isRecord(value.ssrModuleMapping)
    || !isRecord(value.edgeSSRModuleMapping)
    || !isRecord(value.rscModuleMapping)
    || !isRecord(value.edgeRscModuleMapping)
  ) {
    throw new Error(`Client-reference manifest ${route} has malformed mapping fields.`);
  }
  const moduleBindings = Object.entries(value.clientModules).map(([moduleKey, module]) => {
    if (
      moduleKey.length === 0
      || moduleKey.length > 4_096
      || /[\u0000-\u001f\u007f]/.test(moduleKey)
      || !isRecord(module)
    ) throw new Error(`Client-reference manifest ${route} has a malformed client module.`);
    assertExactKeys(module, ["async", "chunks", "id", "name"], `client module in ${route}`);
    if (
      !Array.isArray(module.chunks)
      || typeof module.async !== "boolean"
      || !(typeof module.id === "string" || Number.isSafeInteger(module.id))
      || typeof module.name !== "string"
    ) throw new Error(`Client-reference manifest ${route} has a malformed client module value.`);
    const chunks = normalizeDeclaredChunks(module.chunks, route);
    return {
      chunks,
      moduleIdentitySha256: sha256Bytes(Buffer.from(moduleKey, "utf8")),
    };
  }).sort(compareTextField("moduleIdentitySha256"));
  const entrypointChunks = [
    ...entryJsChunks(value.entryJSFiles, route),
    ...entryCssChunks(value.entryCSSFiles, route),
  ].sort();
  const declaredStaticChunks = [...new Set([
    ...moduleBindings.flatMap(({ chunks }) => chunks),
    ...entrypointChunks,
  ])].sort();
  for (const servedPath of declaredStaticChunks) {
    if (!staticByServedPath.has(servedPath)) {
      throw new Error(`Client-reference manifest ${route} declares missing static chunk ${servedPath}.`);
    }
  }
  return {
    clientModuleChunkBindings: moduleBindings,
    clientModuleCount: moduleBindings.length,
    clientModuleSetSha256: digestCanonical(moduleBindings.map(({ moduleIdentitySha256 }) => moduleIdentitySha256)),
    declaredStaticChunkSetSha256: digestCanonical(declaredStaticChunks),
    declaredStaticChunks,
    entrypointStaticChunks: [...new Set(entrypointChunks)],
    manifestPath: `/${file}`,
    manifestSha256: details.sha256,
    moduleChunkAssignmentSha256: digestCanonical(moduleBindings),
    route,
  };
}

function entryJsChunks(entries, route) {
  const chunks = [];
  for (const [entry, value] of Object.entries(entries)) {
    if (!safeManifestKey(entry) || !Array.isArray(value)) {
      throw new Error(`Client-reference manifest ${route} has malformed entryJSFiles.`);
    }
    chunks.push(...normalizeDeclaredChunks(value, route));
  }
  return chunks;
}

function entryCssChunks(entries, route) {
  const chunks = [];
  for (const [entry, value] of Object.entries(entries)) {
    if (!safeManifestKey(entry) || !Array.isArray(value)) {
      throw new Error(`Client-reference manifest ${route} has malformed entryCSSFiles.`);
    }
    for (const css of value) {
      if (!isRecord(css)) throw new Error(`Client-reference manifest ${route} has malformed CSS entry.`);
      assertExactKeys(css, ["inlined", "path"], `client-reference CSS entry in ${route}`);
      if (typeof css.inlined !== "boolean" || typeof css.path !== "string") {
        throw new Error(`Client-reference manifest ${route} has malformed CSS entry value.`);
      }
      if (!css.inlined) chunks.push(...normalizeDeclaredChunks([css.path], route));
    }
  }
  return chunks;
}

function normalizeDeclaredChunks(values, route) {
  return values.map((value) => {
    if (typeof value !== "string") throw new Error(`Client-reference manifest ${route} has a non-string chunk.`);
    const servedPath = value.startsWith("/_next/") ? value : `/_next/${value}`;
    if (!/^\/_next\/static\/chunks\/[A-Za-z0-9._/-]+$/.test(servedPath) || servedPath.includes("..")) {
      throw new Error(`Client-reference manifest ${route} has an unsafe static chunk path.`);
    }
    return servedPath;
  });
}

function safeManifestKey(value) {
  return value.length > 0 && value.length <= 4_096 && !/[\u0000-\u001f\u007f]/.test(value);
}

function relevantFileKind(file) {
  if (file.startsWith(STATIC_CHUNK_PREFIX) && file.length > STATIC_CHUNK_PREFIX.length) {
    if (!/^app\/\.next\/static\/chunks\/[A-Za-z0-9._/-]+\.(?:css|js)$/.test(file)
      || file.includes("..")) {
      throw new Error("Production image contains an unsafe or unsupported Next.js static chunk path.");
    }
    return "static-chunk";
  }
  if (file.startsWith(STATIC_MEDIA_PREFIX) && file.length > STATIC_MEDIA_PREFIX.length) {
    if (!/^app\/\.next\/static\/media\/[A-Za-z0-9._-]{1,200}\.(?:eot|ico|png|svg|ttf|woff|woff2)$/.test(file)
      || file.includes("..")) {
      throw new Error("Production image contains an unsupported Next.js static media path.");
    }
    return "static-media";
  }
  if (
    file.startsWith(NEXT_PREFIX)
    && (path.posix.basename(file).endsWith("manifest.json") || file.endsWith(CLIENT_REFERENCE_SUFFIX))
  ) return "manifest";
  return undefined;
}

function whiteoutOperation(file) {
  const basename = path.posix.basename(file);
  if (!basename.startsWith(".wh.")) return undefined;
  const directory = path.posix.dirname(file);
  if (basename === ".wh..wh..opq") return { opaque: true, path: directory === "." ? "" : directory };
  const targetName = basename.slice(4);
  if (!targetName) throw new Error("OCI layer contains an invalid whiteout.");
  return { opaque: false, path: directory === "." ? targetName : `${directory}/${targetName}` };
}

async function scanTarFile(file) {
  const details = await stat(file);
  if (!details.isFile() || details.size <= 0 || details.size > MAX_ARCHIVE_BYTES) {
    throw new Error("Production image OCI archive violates its bounded size contract.");
  }
  const handle = await open(file, "r");
  const entries = new Map();
  let offset = 0;
  let entryCount = 0;
  let pendingPath;
  let localPax;
  let globalPax = {};
  let zeroBlocks = 0;
  try {
    while (offset + TAR_BLOCK_BYTES <= details.size) {
      const header = Buffer.alloc(TAR_BLOCK_BYTES);
      await readExactly(handle, header, offset);
      offset += TAR_BLOCK_BYTES;
      if (isZeroBlock(header)) {
        zeroBlocks += 1;
        if (zeroBlocks >= 2) break;
        continue;
      }
      if (zeroBlocks !== 0) throw new Error("OCI archive TAR has an incomplete end marker.");
      entryCount += 1;
      if (entryCount > MAX_TAR_ENTRIES) throw new Error("OCI archive TAR exceeds its entry count limit.");
      const parsed = parseTarHeader(header, "OCI archive");
      if (["pax", "global-pax", "gnu-long-name"].includes(parsed.type)) {
        if (parsed.size > MAX_JSON_BYTES) throw new Error("OCI archive TAR extension exceeds its size limit.");
        const bytes = Buffer.alloc(parsed.size);
        await readExactly(handle, bytes, offset);
        if (parsed.type === "gnu-long-name") pendingPath = decodeTarText(bytes, "OCI archive GNU long path").replace(/\0+$/, "");
        else if (parsed.type === "pax") localPax = parsePax(bytes, "OCI archive");
        else globalPax = { ...globalPax, ...parsePax(bytes, "OCI archive") };
      } else {
        const attributes = { ...globalPax, ...localPax };
        localPax = undefined;
        const entryPath = normalizeTarPath(attributes.path ?? pendingPath ?? parsed.path, "OCI archive");
        pendingPath = undefined;
        const size = attributes.size === undefined ? parsed.size : parsePaxSize(attributes.size, "OCI archive");
        if (size !== parsed.size) throw new Error("OCI archive PAX size does not match its physical entry size.");
        const type = parsed.type === "directory" ? "directory" : parsed.type === "file" ? "file" : "other";
        if (entries.has(entryPath)) throw new Error(`OCI archive repeats TAR path ${entryPath}.`);
        entries.set(entryPath, { dataOffset: offset, size, type });
      }
      offset += parsed.size + tarPadding(parsed.size);
      if (offset > details.size) throw new Error("OCI archive TAR entry exceeds the archive boundary.");
    }
    if (zeroBlocks < 2) throw new Error("OCI archive TAR is missing its complete end marker.");
    const trailerBytes = details.size - offset;
    if (trailerBytes > MAX_TAR_TRAILER_BYTES) {
      throw new Error("OCI archive TAR has an oversized trailing region.");
    }
    const trailer = Buffer.alloc(trailerBytes);
    if (trailer.length > 0) {
      await readExactly(handle, trailer, offset);
      if (trailer.some((value) => value !== 0)) throw new Error("OCI archive TAR has non-zero trailing bytes.");
    }
  } finally {
    await handle.close();
  }
  return { entries, file };
}

function parseTarHeader(header, label) {
  const storedChecksum = parseTarNumber(header.subarray(148, 156), `${label} TAR checksum`);
  const checksumBytes = Buffer.from(header);
  checksumBytes.fill(0x20, 148, 156);
  const actualChecksum = checksumBytes.reduce((total, value) => total + value, 0);
  if (storedChecksum !== actualChecksum) throw new Error(`${label} TAR header checksum is invalid.`);
  const name = tarString(header.subarray(0, 100));
  const prefix = tarString(header.subarray(345, 500));
  const typeFlag = header[156];
  const types = {
    0: "file",
    48: "file",
    49: "hard-link",
    50: "symbolic-link",
    53: "directory",
    76: "gnu-long-name",
    103: "global-pax",
    120: "pax",
  };
  return {
    path: prefix ? `${prefix}/${name}` : name,
    size: parseTarNumber(header.subarray(124, 136), `${label} TAR entry size`),
    type: types[typeFlag] ?? "other",
  };
}

function parseTarNumber(bytes, label) {
  if ((bytes[0] & 0x80) !== 0) throw new Error(`${label} uses an unsupported base-256 integer.`);
  const value = tarString(bytes).trim();
  if (!/^[0-7]+$/.test(value)) throw new Error(`${label} is not a canonical octal integer.`);
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label} exceeds the safe integer range.`);
  return parsed;
}

/** @returns {{path?: string, size?: string}} */
function parsePax(bytes, label) {
  /** @type {{path?: string, size?: string}} */
  const fields = {};
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(0x20, offset);
    if (space < 0) throw new Error(`${label} has a malformed PAX length.`);
    const lengthText = bytes.subarray(offset, space).toString("ascii");
    if (!/^[1-9]\d{0,8}$/.test(lengthText)) throw new Error(`${label} has a malformed PAX length.`);
    const length = Number(lengthText);
    if (offset + length > bytes.length) throw new Error(`${label} has a truncated PAX record.`);
    const recordBytes = bytes.subarray(offset, offset + length);
    const record = decodeTarText(recordBytes, `${label} PAX record`);
    if (recordBytes.length !== length || !record.endsWith("\n")) {
      throw new Error(`${label} has a malformed PAX record.`);
    }
    const relativeSpace = space - offset;
    const equals = record.indexOf("=", relativeSpace + 1);
    if (equals < 0) throw new Error(`${label} has a malformed PAX field.`);
    const key = record.slice(relativeSpace + 1, equals);
    const value = record.slice(equals + 1, -1);
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(key)) throw new Error(`${label} has an invalid PAX field name.`);
    if (["path", "size"].includes(key)) {
      if (Object.hasOwn(fields, key)) throw new Error(`${label} repeats a path-affecting PAX field.`);
      fields[key] = value;
    }
    offset += length;
  }
  return fields;
}

function parsePaxSize(value, label) {
  if (!/^(?:0|[1-9]\d{0,15})$/.test(value)) throw new Error(`${label} has an invalid PAX size.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} PAX size exceeds the safe integer range.`);
  return parsed;
}

function normalizeTarPath(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096 || value.includes("\\")) {
    throw new Error(`${label} TAR path is invalid.`);
  }
  if (value === "." || value === "./") return ".";
  const normalized = value.replace(/^\.\//, "").replace(/\/$/, "");
  if (
    normalized.length === 0
    || normalized.startsWith("/")
    || normalized.split("/").some((part) => part === "" || part === "." || part === "..")
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) throw new Error(`${label} TAR path is unsafe.`);
  return normalized;
}

function parseJson(bytes, label) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid UTF-8 JSON.`);
  }
}

async function readJsonEntry(archive, name, maximum) {
  const entry = archive.entries.get(name);
  if (!entry || entry.type !== "file") throw new Error(`OCI archive is missing ${name}.`);
  return parseJson(await readEntryBytes(archive, entry, maximum), `OCI archive ${name}`);
}

async function readEntryBytes(archive, entry, maximum) {
  if (entry.size > maximum) throw new Error("OCI archive entry exceeds its bounded read contract.");
  const bytes = Buffer.alloc(entry.size);
  const handle = await open(archive.file, "r");
  try {
    await readExactly(handle, bytes, entry.dataOffset);
  } finally {
    await handle.close();
  }
  return bytes;
}

async function readExactly(handle, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, position + offset);
    if (bytesRead === 0) throw new Error("Unexpected end of production image archive.");
    offset += bytesRead;
  }
}

function digestCanonical(value) {
  return sha256Bytes(Buffer.from(canonicalJson(value), "utf8"));
}

function canonicalJson(value) {
  return JSON.stringify(sortRecursively(value));
}

function sortRecursively(value) {
  if (Array.isArray(value)) return value.map(sortRecursively);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortRecursively(value[key])]));
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function comparePath(field) {
  return compareTextField(field);
}

function compareTextField(field) {
  return (left, right) => left[field] < right[field] ? -1 : left[field] > right[field] ? 1 : 0;
}

function exactlyOne(values, label) {
  if (values.length !== 1) throw new Error(`Expected exactly one ${label}; found ${values.length}.`);
  return values[0];
}

function assertExactKeys(value, keys, label) {
  if (!isRecord(value)) throw new Error(`${label} is not an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} does not have its exact expected fields.`);
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tarString(bytes) {
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end < 0 ? bytes.length : end).toString("utf8");
}

function decodeTarText(bytes, label) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8.`);
  }
}

function isZeroBlock(buffer) {
  return buffer.every((value) => value === 0);
}

function tarPadding(size) {
  return (TAR_BLOCK_BYTES - (size % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES;
}

function sanitize(value) {
  return value.replace(/(password|secret|token|authorization)=[^\s]+/gi, "$1=<redacted>")
    .replace(/\s+/g, " ").trim().slice(0, 2_000);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Cannot attest production image assets: ${sanitize(message)}\n`);
    process.exitCode = 1;
  }
}

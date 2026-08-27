import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { attestProductionImageArchive } from "../../../scripts/security/attest-production-image-assets.mjs";

const revision = "1".repeat(40);
const publicBuildContractSha256 = "2".repeat(64);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("production image static asset attestation", () => {
  it("binds the OCI image, labels, module closure, and served chunk body digests", async () => {
    const fixture = await createOciFixture();
    const result = await attestProductionImageArchive(fixture.expected);

    expect(result.source).toMatchObject({
      imageDigest: fixture.expected.expectedImageDigest,
      revision,
      role: "app",
      platform: { architecture: "amd64", os: "linux" },
      publicBuildContract: { sha256: publicBuildContractSha256, version: "1" },
    });
    expect(result.inventory.staticChunks).toEqual([
      {
        imagePath: "/app/.next/static/chunks/cabinet.css",
        servedPath: "/_next/static/chunks/cabinet.css",
        sha256: sha256(fixture.cssBytes),
        size: fixture.cssBytes.length,
      },
      {
        imagePath: "/app/.next/static/chunks/cabinet.js",
        servedPath: "/_next/static/chunks/cabinet.js",
        sha256: sha256(fixture.javascriptBytes),
        size: fixture.javascriptBytes.length,
      },
      {
        imagePath: "/app/.next/static/media/brand.png",
        servedPath: "/_next/static/media/brand.png",
        sha256: sha256(fixture.pngBytes),
        size: fixture.pngBytes.length,
      },
      {
        imagePath: "/app/.next/static/media/favicon.ico",
        servedPath: "/_next/static/media/favicon.ico",
        sha256: sha256(fixture.icoBytes),
        size: fixture.icoBytes.length,
      },
      {
        imagePath: "/app/.next/static/media/inter.woff2",
        servedPath: "/_next/static/media/inter.woff2",
        sha256: sha256(fixture.fontBytes),
        size: fixture.fontBytes.length,
      },
      {
        imagePath: "/app/.next/static/media/mark.svg",
        servedPath: "/_next/static/media/mark.svg",
        sha256: sha256(fixture.svgBytes),
        size: fixture.svgBytes.length,
      },
      {
        imagePath: "/app/.next/static/media/primeicons.eot",
        servedPath: "/_next/static/media/primeicons.eot",
        sha256: sha256(fixture.eotBytes),
        size: fixture.eotBytes.length,
      },
      {
        imagePath: "/app/.next/static/media/primeicons.ttf",
        servedPath: "/_next/static/media/primeicons.ttf",
        sha256: sha256(fixture.ttfBytes),
        size: fixture.ttfBytes.length,
      },
      {
        imagePath: "/app/.next/static/media/primeicons.woff",
        servedPath: "/_next/static/media/primeicons.woff",
        sha256: sha256(fixture.woffBytes),
        size: fixture.woffBytes.length,
      },
    ]);
    const clientReference = result.inventory.clientReferences.find(
      (entry: { route: string }) => entry.route === "/cabinet/page",
    );
    if (!clientReference) throw new Error("Synthetic cabinet client-reference inventory is missing.");
    expect(clientReference).toMatchObject({
      clientModuleCount: 2,
      declaredStaticChunks: [
        "/_next/static/chunks/cabinet.css",
        "/_next/static/chunks/cabinet.js",
      ],
      entrypointStaticChunks: [
        "/_next/static/chunks/cabinet.css",
        "/_next/static/chunks/cabinet.js",
      ],
      manifestPath: "/app/.next/server/app/cabinet/page_client-reference-manifest.js",
      route: "/cabinet/page",
    });
    expect(clientReference.clientModuleSetSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(clientReference.moduleChunkAssignmentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.correlation).toEqual({
      bodyDigestAlgorithm: "sha256",
      bodyDigestInput: "decoded response body bytes",
      key: "servedPath",
      staticChunkCount: 9,
    });
    expect(result.attestationSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    ["image digest", { expectedImageDigest: `sha256:${"f".repeat(64)}` }, /exact expected image digest/],
    ["revision", { expectedRevision: "f".repeat(40) }, /org\.opencontainers\.image\.revision/],
    [
      "build contract version",
      { expectedPublicBuildContractVersion: "2" },
      /public-build-contract-version/,
    ],
    [
      "build contract digest",
      { expectedPublicBuildContractSha256: "f".repeat(64) },
      /public-build-contract-sha256/,
    ],
  ])("rejects a mismatched exact %s", async (_label, override, message) => {
    const fixture = await createOciFixture();
    await expect(attestProductionImageArchive({ ...fixture.expected, ...override }))
      .rejects.toThrow(message);
  });

  it("separates a stable client-module closure from changed chunk partitioning", async () => {
    const first = await createOciFixture({ javascriptFilename: "first.js" });
    const second = await createOciFixture({ javascriptFilename: "second.js" });
    const firstResult = await attestProductionImageArchive(first.expected);
    const secondResult = await attestProductionImageArchive(second.expected);
    const firstCabinet = firstResult.inventory.clientReferences.find(
      (entry: { route: string }) => entry.route === "/cabinet/page",
    );
    const secondCabinet = secondResult.inventory.clientReferences.find(
      (entry: { route: string }) => entry.route === "/cabinet/page",
    );
    if (!firstCabinet || !secondCabinet) throw new Error("Synthetic cabinet closure is missing.");

    expect(firstCabinet.clientModuleSetSha256).toBe(secondCabinet.clientModuleSetSha256);
    expect(firstCabinet.moduleChunkAssignmentSha256)
      .not.toBe(secondCabinet.moduleChunkAssignmentSha256);
    expect(firstResult.inventory.staticChunkSetSha256)
      .not.toBe(secondResult.inventory.staticChunkSetSha256);
  });

  it("rejects a client-reference closure whose declared body is absent", async () => {
    const fixture = await createOciFixture({ declaredJavascript: "missing.js" });
    await expect(attestProductionImageArchive(fixture.expected))
      .rejects.toThrow("declares missing static chunk /_next/static/chunks/missing.js");
  });

  it("never executes or accepts a client-reference wrapper near miss", async () => {
    const fixture = await createOciFixture({ executablePrefix: "globalThis.compromised = true;\n" });
    await expect(attestProductionImageArchive(fixture.expected))
      .rejects.toThrow("unsupported executable wrapper");
    expect((globalThis as Record<string, unknown>).compromised).toBeUndefined();
  });

  it("rejects a layer whose compressed body does not match its OCI descriptor", async () => {
    const fixture = await createOciFixture({ corruptLayerDescriptor: true });
    await expect(attestProductionImageArchive(fixture.expected))
      .rejects.toThrow("compressed bytes do not match their descriptor");
  });

  it("rejects an unsupported or nested static media path", async () => {
    for (const mediaFilename of ["unexpected.txt", "nested/unexpected.woff2"]) {
      const fixture = await createOciFixture({ mediaFilename });
      await expect(attestProductionImageArchive(fixture.expected), mediaFilename)
        .rejects.toThrow("unsupported Next.js static media path");
    }
  });

  it("rejects an unsupported static chunk extension", async () => {
    const fixture = await createOciFixture({ javascriptFilename: "unexpected.map" });
    await expect(attestProductionImageArchive(fixture.expected))
      .rejects.toThrow("unsupported Next.js static chunk path");
  });

  it("keeps a historical CSS/JavaScript-only inventory projection exact", async () => {
    const fixture = await createOciFixture({ includeMedia: false });
    const result = await attestProductionImageArchive(fixture.expected);
    expect(result.inventory.staticChunks).toEqual([
      {
        imagePath: "/app/.next/static/chunks/cabinet.css",
        servedPath: "/_next/static/chunks/cabinet.css",
        sha256: sha256(fixture.cssBytes),
        size: fixture.cssBytes.length,
      },
      {
        imagePath: "/app/.next/static/chunks/cabinet.js",
        servedPath: "/_next/static/chunks/cabinet.js",
        sha256: sha256(fixture.javascriptBytes),
        size: fixture.javascriptBytes.length,
      },
    ]);
    expect(result.inventory.staticChunkCount).toBe(2);
  });
});

async function createOciFixture(options: {
  corruptLayerDescriptor?: boolean;
  declaredJavascript?: string;
  executablePrefix?: string;
  includeMedia?: boolean;
  javascriptFilename?: string;
  mediaFilename?: string;
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "clean-pay-image-asset-attestation-test-"));
  temporaryRoots.push(root);
  const archivePath = path.join(root, "image.oci.tar");
  const javascriptBytes = Buffer.from("self.__cleanPayChunk = 'cabinet';\n", "utf8");
  const cssBytes = Buffer.from(".cabinet{display:block}\n", "utf8");
  const fontBytes = Buffer.from("synthetic-font-bytes", "utf8");
  const eotBytes = Buffer.from("synthetic-eot-bytes", "utf8");
  const icoBytes = Buffer.from("synthetic-ico-bytes", "utf8");
  const pngBytes = Buffer.from("synthetic-png-bytes", "utf8");
  const svgBytes = Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"/>\n", "utf8");
  const ttfBytes = Buffer.from("synthetic-ttf-bytes", "utf8");
  const woffBytes = Buffer.from("synthetic-woff-bytes", "utf8");
  const javascriptFilename = options.javascriptFilename ?? "cabinet.js";
  const declaredJavascript = options.declaredJavascript ?? javascriptFilename;
  const clientReference = Buffer.from(
    `${options.executablePrefix ?? ""}globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\n`
      + `globalThis.__RSC_MANIFEST["/cabinet/page"] = ${JSON.stringify(clientReferenceValue(
        declaredJavascript,
      ))};\n`,
    "utf8",
  );
  const layerTar = createTar([
    fileEntry("app/.next/build-manifest.json", Buffer.from("{}\n", "utf8")),
    fileEntry(
      "app/.next/server/app/cabinet/page_client-reference-manifest.js",
      clientReference,
    ),
    fileEntry("app/.next/static/chunks/cabinet.css", cssBytes),
    fileEntry(`app/.next/static/chunks/${javascriptFilename}`, javascriptBytes),
    ...(options.includeMedia === false ? [] : [
      fileEntry("app/.next/static/media/brand.png", pngBytes),
      fileEntry("app/.next/static/media/favicon.ico", icoBytes),
      fileEntry("app/.next/static/media/primeicons.eot", eotBytes),
      fileEntry("app/.next/static/media/inter.woff2", fontBytes),
      fileEntry("app/.next/static/media/primeicons.woff", woffBytes),
      fileEntry("app/.next/static/media/primeicons.ttf", ttfBytes),
      fileEntry("app/.next/static/media/mark.svg", svgBytes),
    ]),
    ...(options.mediaFilename
      ? [fileEntry(`app/.next/static/media/${options.mediaFilename}`, fontBytes)]
      : []),
  ]);
  const compressedLayer = gzipSync(layerTar, { level: 9 });
  const realLayerDigest = sha256(compressedLayer);
  const layerDigest = options.corruptLayerDescriptor ? "a".repeat(64) : realLayerDigest;
  const configBytes = jsonBytes({
    architecture: "amd64",
    config: {
      Labels: {
        "io.clean-pay.public-build-contract-sha256": publicBuildContractSha256,
        "io.clean-pay.public-build-contract-version": "1",
        "io.clean-pay.role": "app",
        "org.opencontainers.image.revision": revision,
      },
    },
    os: "linux",
    rootfs: { diff_ids: [`sha256:${sha256(layerTar)}`], type: "layers" },
  });
  const configDescriptor = descriptor(
    "application/vnd.oci.image.config.v1+json",
    configBytes,
  );
  const layerDescriptor = {
    digest: `sha256:${layerDigest}`,
    mediaType: "application/vnd.oci.image.layer.v1.tar+gzip",
    size: compressedLayer.length,
  };
  const manifestBytes = jsonBytes({
    config: configDescriptor,
    layers: [layerDescriptor],
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    schemaVersion: 2,
  });
  const manifestDescriptor = {
    ...descriptor("application/vnd.oci.image.manifest.v1+json", manifestBytes),
    platform: { architecture: "amd64", os: "linux" },
  };
  const sourceIndexBytes = jsonBytes({
    manifests: [manifestDescriptor],
    mediaType: "application/vnd.oci.image.index.v1+json",
    schemaVersion: 2,
  });
  const sourceDescriptor = descriptor("application/vnd.oci.image.index.v1+json", sourceIndexBytes);
  const rootIndexBytes = jsonBytes({
    manifests: [sourceDescriptor],
    mediaType: "application/vnd.oci.image.index.v1+json",
    schemaVersion: 2,
  });
  const archive = createTar([
    fileEntry("oci-layout", jsonBytes({ imageLayoutVersion: "1.0.0" })),
    fileEntry("index.json", rootIndexBytes),
    fileEntry(blobPath(configDescriptor.digest), configBytes),
    fileEntry(blobPath(layerDescriptor.digest), compressedLayer),
    fileEntry(blobPath(manifestDescriptor.digest), manifestBytes),
    fileEntry(blobPath(sourceDescriptor.digest), sourceIndexBytes),
  ]);
  await writeFile(archivePath, archive, { flag: "wx" });
  return {
    cssBytes,
    eotBytes,
    fontBytes,
    icoBytes,
    javascriptBytes,
    pngBytes,
    svgBytes,
    ttfBytes,
    woffBytes,
    expected: {
      archivePath,
      expectedImageDigest: sourceDescriptor.digest,
      expectedPublicBuildContractSha256: publicBuildContractSha256,
      expectedPublicBuildContractVersion: "1",
      expectedRevision: revision,
      platform: "linux/amd64",
    },
  };
}

function clientReferenceValue(declaredJavascript: string) {
  const javascript = `/_next/static/chunks/${declaredJavascript}`;
  return {
    moduleLoading: { crossOrigin: "none", prefix: "" },
    clientModules: {
      "[project]/src/frontend/components/cabinet-panel.tsx": {
        async: false,
        chunks: [javascript],
        id: 1,
        name: "*",
      },
      "[project]/node_modules/next/dist/client/app-dir/link.js": {
        async: false,
        chunks: [javascript],
        id: 2,
        name: "*",
      },
    },
    ssrModuleMapping: {},
    edgeSSRModuleMapping: {},
    rscModuleMapping: {},
    edgeRscModuleMapping: {},
    entryCSSFiles: {
      "[project]/src/app/cabinet/page": [
        { inlined: false, path: "static/chunks/cabinet.css" },
      ],
    },
    entryJSFiles: {
      "[project]/src/app/cabinet/page": [`static/chunks/${declaredJavascript}`],
    },
  };
}

function descriptor(mediaType: string, bytes: Buffer) {
  return { digest: `sha256:${sha256(bytes)}`, mediaType, size: bytes.length };
}

function blobPath(digest: string) {
  return `blobs/sha256/${digest.slice("sha256:".length)}`;
}

function jsonBytes(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fileEntry(name: string, bytes: Buffer) {
  return { bytes, name };
}

function createTar(entries: Array<{ bytes: Buffer; name: string }>) {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    writeString(header, 0, 100, entry.name);
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, entry.bytes.length);
    writeOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header[156] = "0".charCodeAt(0);
    writeString(header, 257, 6, "ustar");
    writeString(header, 263, 2, "00");
    const checksum = header.reduce((sum, value) => sum + value, 0);
    const renderedChecksum = checksum.toString(8).padStart(6, "0");
    header.write(renderedChecksum, 148, 6, "ascii");
    header[154] = 0;
    header[155] = 0x20;
    blocks.push(header, entry.bytes);
    const padding = (512 - (entry.bytes.length % 512)) % 512;
    if (padding) blocks.push(Buffer.alloc(padding));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

function writeString(buffer: Buffer, offset: number, length: number, value: string) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > length) throw new Error(`Test TAR path is too long: ${value}`);
  bytes.copy(buffer, offset);
}

function writeOctal(buffer: Buffer, offset: number, length: number, value: number) {
  const rendered = value.toString(8).padStart(length - 1, "0");
  buffer.write(rendered, offset, length - 1, "ascii");
  buffer[offset + length - 1] = 0;
}

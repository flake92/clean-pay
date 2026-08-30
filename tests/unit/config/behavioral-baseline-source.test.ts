import { mkdtemp, readFile, realpath, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  BEHAVIORAL_BASELINE_SOURCE,
  assertBehavioralBaselineArchive,
  assertBehavioralBaselineIdentity,
  cleanupBehavioralBaselineSource,
  materializeBehavioralBaselineSource,
} from "../../../scripts/security/behavioral-baseline-source.mjs";

describe("behavioral baseline source", () => {
  it("materializes only the reviewed f5 archive and removes its exact owned root", async () => {
    const repositoryRoot = await realpath(process.cwd());
    const temporaryParent = await realpath(tmpdir());
    const isolatedTemporaryRoot = await mkdtemp(path.join(
      temporaryParent,
      "clean-pay-baseline-source-test-parent-",
    ));
    let materialized: Awaited<ReturnType<typeof materializeBehavioralBaselineSource>> | undefined;
    try {
      materialized = await materializeBehavioralBaselineSource({
        repositoryRoot,
        temporaryRoot: isolatedTemporaryRoot,
      });
      expect(path.dirname(materialized.root)).toBe(isolatedTemporaryRoot);
      expect(path.dirname(materialized.sourceDirectory)).toBe(materialized.root);
      expect(JSON.parse(await readFile(materialized.receiptPath, "utf8"))).toMatchObject({
        archive: {
          bytes: BEHAVIORAL_BASELINE_SOURCE.archiveBytes,
          sha256: BEHAVIORAL_BASELINE_SOURCE.archiveSha256,
        },
        extracted: {
          aggregateSha256: BEHAVIORAL_BASELINE_SOURCE.extractedAggregateSha256,
          fileCount: BEHAVIORAL_BASELINE_SOURCE.extractedFileCount,
          totalBytes: BEHAVIORAL_BASELINE_SOURCE.extractedTotalBytes,
        },
        source: {
          commit: BEHAVIORAL_BASELINE_SOURCE.commit,
          tree: BEHAVIORAL_BASELINE_SOURCE.tree,
        },
        status: "immutable_behavioral_baseline_materialized",
      });
      await expect(cleanupBehavioralBaselineSource({
        expectedReceiptSha256: materialized.receiptSha256,
        root: materialized.root,
        temporaryRoot: isolatedTemporaryRoot,
      })).resolves.toEqual({ status: "immutable_behavioral_baseline_cleaned" });
      materialized = undefined;
    } finally {
      if (materialized) {
        await cleanupBehavioralBaselineSource({
          expectedReceiptSha256: materialized.receiptSha256,
          root: materialized.root,
          temporaryRoot: isolatedTemporaryRoot,
        });
      }
      await rmdir(isolatedTemporaryRoot);
    }
  }, 30_000);

  it("requires the exact immutable receipt capability and rejects receipt extension", async () => {
    const repositoryRoot = await realpath(process.cwd());
    const isolatedTemporaryRoot = await mkdtemp(path.join(
      await realpath(tmpdir()),
      "clean-pay-baseline-receipt-test-parent-",
    ));
    const materialized = await materializeBehavioralBaselineSource({
      repositoryRoot,
      temporaryRoot: isolatedTemporaryRoot,
    });
    const originalReceipt = await readFile(materialized.receiptPath);
    try {
      await expect(cleanupBehavioralBaselineSource({
        expectedReceiptSha256: `${materialized.receiptSha256[0] === "0" ? "1" : "0"}${materialized.receiptSha256.slice(1)}`,
        root: materialized.root,
        temporaryRoot: isolatedTemporaryRoot,
      })).rejects.toThrow("receipt capability changed");
      const extended = JSON.parse(originalReceipt.toString("utf8"));
      extended.unreviewed = true;
      const extendedReceipt = Buffer.from(`${JSON.stringify(extended)}\n`, "utf8");
      await writeFile(materialized.receiptPath, extendedReceipt);
      await expect(cleanupBehavioralBaselineSource({
        expectedReceiptSha256: createHash("sha256").update(extendedReceipt).digest("hex"),
        root: materialized.root,
        temporaryRoot: isolatedTemporaryRoot,
      })).rejects.toThrow("does not match its exact contract");
    } finally {
      await writeFile(materialized.receiptPath, originalReceipt);
      await cleanupBehavioralBaselineSource({
        expectedReceiptSha256: materialized.receiptSha256,
        root: materialized.root,
        temporaryRoot: isolatedTemporaryRoot,
      });
      await rmdir(isolatedTemporaryRoot);
    }
  }, 30_000);

  it("rejects a temporary directory whose dot-dot-prefixed name is inside the repository", async () => {
    const repositoryRoot = await realpath(process.cwd());
    const repositoryChild = await mkdtemp(path.join(
      repositoryRoot,
      "..cache-baseline-source-isolation-test-",
    ));
    try {
      await expect(materializeBehavioralBaselineSource({
        repositoryRoot,
        temporaryRoot: repositoryChild,
      })).rejects.toThrow("not isolated from the repository");
    } finally {
      await rmdir(repositoryChild);
    }
  });

  it("rejects every Git identity near miss", () => {
    expect(() => assertBehavioralBaselineIdentity(
      `0${BEHAVIORAL_BASELINE_SOURCE.commit.slice(1)}`,
      BEHAVIORAL_BASELINE_SOURCE.tree,
    )).toThrow("reviewed immutable source");
    expect(() => assertBehavioralBaselineIdentity(
      BEHAVIORAL_BASELINE_SOURCE.commit,
      `0${BEHAVIORAL_BASELINE_SOURCE.tree.slice(1)}`,
    )).toThrow("reviewed immutable source");
  });

  it("rejects wrong archive bytes, length, and type", () => {
    expect(() => assertBehavioralBaselineArchive(new Uint8Array())).toThrow(
      "reviewed immutable bytes",
    );
    expect(() => assertBehavioralBaselineArchive(
      new Uint8Array(BEHAVIORAL_BASELINE_SOURCE.archiveBytes),
    )).toThrow("reviewed immutable bytes");
    expect(() => assertBehavioralBaselineArchive("not-bytes" as never)).toThrow(
      "reviewed immutable bytes",
    );
  });

  it("keeps the CLI network-free and digest-only on failure", async () => {
    const source = await readFile(
      path.resolve(process.cwd(), "scripts/security/behavioral-baseline-source.mjs"),
      "utf8",
    );
    expect(source).not.toMatch(/\b(?:fetch|curl|wget|https?):/u);
    expect(source).toContain('messageSha256: sha256(String(error?.message ?? "unknown"))');
    expect(source).toContain('"archive",');
    expect(source).toContain('"core.autocrlf=true",');
    expect(source).toContain('await runWithInput("tar", ["-xf", "-", "-C", sourceDirectory]');
    expect(source).not.toContain("root: result.root");
    expect(source).not.toContain("sourceDirectory: result.sourceDirectory");
    expect(source).toContain('"--format=tar",');
    expect(source).toContain('await rm(target, { recursive: true, force: false, maxRetries: 0 })');
  });
});
import { createHash } from "node:crypto";

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertPrivateCredentialDirectory,
  assertPrivateCredentialFile,
  readPrivateCredentialFile,
  writePrivateCredentialFileCas,
} from "../../../deploy/prod/credential-file-guard.mjs";
import { assertRemnashopEnvironmentFile } from "../../../deploy/prod/remnashop-env-preflight.mjs";

const temporaryRoots: string[] = [];
const powershellIntegrationTimeout = 45_000;

function temporaryRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "clean-pay-credential-guard-"));
  temporaryRoots.push(root);
  return root;
}

function currentIdentity(target: string) {
  const stat = lstatSync(target);
  return { expectedUid: stat.uid, expectedGid: stat.gid };
}

afterEach(() => {
  while (temporaryRoots.length) {
    const root = temporaryRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("credential-file metadata guards", () => {
  it("accepts a private regular file without reading its contents", () => {
    const root = temporaryRoot();
    const file = path.join(root, "private.env");
    writeFileSync(file, "SYNTHETIC_CANARY=not-a-secret\n", { mode: 0o600 });
    if (process.platform !== "win32") chmodSync(file, 0o600);

    const metadata = assertPrivateCredentialFile(
      file,
      "fixture",
      currentIdentity(file),
    );

    expect(metadata.inode).toBe(lstatSync(file).ino);
  });

  it("returns credential bytes from the same validated descriptor", () => {
    const root = temporaryRoot();
    const file = path.join(root, "private.env");
    const contents = "SYNTHETIC_CANARY=not-a-secret\n";
    writeFileSync(file, contents, { mode: 0o600 });
    if (process.platform !== "win32") chmodSync(file, 0o600);

    const guarded = readPrivateCredentialFile(file, "fixture", currentIdentity(file));

    expect(guarded.contents).toBe(contents);
    expect(guarded.metadata.inode).toBe(lstatSync(file).ino);
  });

  it.skipIf(process.platform === "win32")(
    "rejects a replaced parent directory before an atomic credential publish",
    () => {
      const root = temporaryRoot();
      const directory = path.join(root, "guarded");
      const movedDirectory = path.join(root, "guarded-before-race");
      const file = path.join(directory, "private.env");
      const replacement = "EXTERNAL_EDIT=parent-swap-must-survive\n";
      mkdirSync(directory, { mode: 0o700 });
      writeFileSync(file, "ORIGINAL=value\n", { mode: 0o600 });
      chmodSync(directory, 0o700);
      chmodSync(file, 0o600);
      const guarded = readPrivateCredentialFile(file, "fixture");

      expect(() => writePrivateCredentialFileCas(
        file,
        "fixture",
        "GENERATED=must-not-publish\n",
        guarded.metadata,
        {
          beforePublish() {
            renameSync(directory, movedDirectory);
            mkdirSync(directory, { mode: 0o700 });
            writeFileSync(file, replacement, { mode: 0o600 });
            chmodSync(directory, 0o700);
            chmodSync(file, 0o600);
          },
        },
      )).toThrow(/changed before publication|parent directory changed/);
      expect(readFileSync(file, "utf8")).toBe(replacement);
    },
  );

  it("keeps the parent descriptor open and fsyncs it after durable publication", () => {
    const source = readFileSync("deploy/prod/credential-file-guard.mjs", "utf8");
    const writer = source.slice(source.indexOf("export function writePrivateCredentialFileCas"));
    expect(writer).toContain("fstatSync(directoryDescriptor)");
    expect(writer.indexOf("renameSync(temporaryPath, path)")).toBeLessThan(
      writer.indexOf("fsyncSync(directoryDescriptor)"),
    );
  });

  it("keeps credential consumers on descriptor-bound reads", () => {
    for (const file of [
      "deploy/prod/prod.mjs",
      "deploy/prod/role-env.mjs",
      "deploy/prod/validate-env.mjs",
      "deploy/prod/zero-downtime-env.mjs",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain("readPrivateCredentialFile");
      expect(source, file).not.toMatch(
        /assertPrivateCredentialFile[\s\S]{0,200}readFileSync\(/,
      );
    }
  });

  it("rejects directories and final-component symlinks", () => {
    const root = temporaryRoot();
    expect(() => assertPrivateCredentialFile(root, "fixture"))
      .toThrow("regular non-symlink file");

    if (process.platform !== "win32") {
      const target = path.join(root, "target.env");
      const link = path.join(root, "link.env");
      writeFileSync(target, "SYNTHETIC_CANARY=not-a-secret\n", { mode: 0o600 });
      symlinkSync(target, link);
      expect(() => assertPrivateCredentialFile(link, "fixture"))
        .toThrow("regular non-symlink file");
    }
  });

  it.skipIf(process.platform === "win32")(
    "rejects 0644, 0640 and a mismatched owner policy",
    () => {
      const root = temporaryRoot();
      const file = path.join(root, "private.env");
      writeFileSync(file, "SYNTHETIC_CANARY=not-a-secret\n", { mode: 0o600 });
      const identity = currentIdentity(file);

      for (const mode of [0o644, 0o640]) {
        chmodSync(file, mode);
        expect(() => assertPrivateCredentialFile(file, "fixture", identity))
          .toThrow(`actual mode is ${mode.toString(8)}`);
      }

      chmodSync(file, 0o600);
      expect(() => assertPrivateCredentialFile(file, "fixture", {
        ...identity,
        expectedUid: identity.expectedUid + 1,
      })).toThrow("must be owned by uid");
    },
  );

  it.skipIf(process.platform === "win32")(
    "requires a private parent directory for the external Remnashop env",
    () => {
      const root = temporaryRoot();
      const directory = path.join(root, "remnashop");
      const file = path.join(directory, ".env");
      mkdirSync(directory, { mode: 0o700 });
      writeFileSync(file, "SYNTHETIC_CANARY=not-a-secret\n", { mode: 0o600 });
      chmodSync(directory, 0o700);
      chmodSync(file, 0o600);
      const identity = currentIdentity(file);

      expect(() => assertRemnashopEnvironmentFile(file, identity)).not.toThrow();

      chmodSync(directory, 0o755);
      expect(() => assertRemnashopEnvironmentFile(file, identity))
        .toThrow("Remnashop env directory must have mode");
      chmodSync(directory, 0o700);
      chmodSync(file, 0o644);
      expect(() => assertRemnashopEnvironmentFile(file, identity))
        .toThrow("Remnashop env file must have mode");
    },
  );

  it("rejects a prohibited Windows plaintext source by metadata only", () => {
    const root = temporaryRoot();
    const source = path.join(root, "legacy-credential-source.txt");
    const script = path.resolve("deploy/prod/operator-credential-source-preflight.ps1");
    writeFileSync(source, "SYNTHETIC_CANARY=not-a-secret\n");

    const rejected = spawnSync("pwsh", [
      "-NoProfile",
      "-File",
      script,
      "-ForbiddenPlaintextPath",
      source,
    ], { encoding: "utf8", shell: false });
    if ((rejected.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return;
    expect(rejected.error).toBeUndefined();
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).not.toContain("SYNTHETIC_CANARY");
    expect(rejected.stderr).toContain("Unapproved plaintext credential source still exists");

    rmSync(source);
    const accepted = spawnSync("pwsh", [
      "-NoProfile",
      "-File",
      script,
      "-ForbiddenPlaintextPath",
      source,
    ], { encoding: "utf8", shell: false });
    expect(accepted.status).toBe(0);
    expect(accepted.stdout).toContain("No prohibited plaintext operator credential source");
  }, powershellIntegrationTimeout);

  it("rejects a non-directory parent in the shared directory guard", () => {
    const root = temporaryRoot();
    const file = path.join(root, "not-a-directory");
    writeFileSync(file, "fixture");
    expect(() => assertPrivateCredentialDirectory(file, "fixture directory"))
      .toThrow("regular non-symlink directory");
  });
});

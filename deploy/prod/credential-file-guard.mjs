import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function octalMode(mode) {
  return (mode & 0o777).toString(8).padStart(3, "0");
}

function currentIdentity() {
  return {
    uid: typeof process.getuid === "function" ? process.getuid() : undefined,
    gid: typeof process.getgid === "function" ? process.getgid() : undefined,
  };
}

function validateIdentityAndMode(stat, label, { expectedUid, expectedGid, allowedModes }) {
  const actualMode = stat.mode & 0o777;
  if (!allowedModes.includes(actualMode)) {
    const expected = allowedModes.map(octalMode).join(" or ");
    throw new Error(
      `${label} must have mode ${expected}; actual mode is ${octalMode(actualMode)}`,
    );
  }
  if (expectedUid !== undefined && stat.uid !== expectedUid) {
    throw new Error(`${label} must be owned by uid ${expectedUid}`);
  }
  if (expectedGid !== undefined && stat.gid !== expectedGid) {
    throw new Error(`${label} must be owned by gid ${expectedGid}`);
  }
}

function validatePath(path, label) {
  if (typeof path !== "string" || !path.trim() || /[\x00\r\n]/.test(path)) {
    throw new Error(`${label} path is missing or contains a control character`);
  }
}

function metadata(stat) {
  return Object.freeze({
    device: stat.dev,
    inode: stat.ino,
    mode: stat.mode & 0o777,
    uid: stat.uid,
    gid: stat.gid,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  });
}

function errorCode(error) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "unknown";
}

export function assertPrivateCredentialDirectory(
  path,
  label,
  {
    expectedUid = currentIdentity().uid,
    expectedGid,
    allowedModes = [0o700, 0o750],
  } = {},
) {
  validatePath(path, label);
  if (!Array.isArray(allowedModes) || allowedModes.length === 0) {
    throw new Error(`${label} allowed mode policy is empty`);
  }
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    throw new Error(`${label} metadata is unavailable (${errorCode(error)})`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be a regular non-symlink directory`);
  }
  if (process.platform !== "win32") {
    validateIdentityAndMode(stat, label, {
      expectedUid,
      expectedGid,
      allowedModes,
    });
  }
  const noFollow = typeof constants.O_NOFOLLOW === "number"
    ? constants.O_NOFOLLOW
    : 0;
  const directoryOnly = typeof constants.O_DIRECTORY === "number"
    ? constants.O_DIRECTORY
    : 0;
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | noFollow | directoryOnly);
    const opened = fstatSync(descriptor);
    if (!opened.isDirectory() || opened.dev !== stat.dev || opened.ino !== stat.ino) {
      throw new Error(`${label} identity changed during metadata validation`);
    }
    if (process.platform !== "win32") {
      validateIdentityAndMode(opened, label, {
        expectedUid,
        expectedGid,
        allowedModes,
      });
    }
    return metadata(opened);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${label} `)) {
      throw error;
    }
    throw new Error(`${label} could not be opened safely (${errorCode(error)})`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function openPrivateCredentialFile(
  path,
  label,
  {
    expectedUid = currentIdentity().uid,
    expectedGid,
    allowedModes = [0o600],
  } = {},
) {
  validatePath(path, label);
  if (!Array.isArray(allowedModes) || allowedModes.length === 0) {
    throw new Error(`${label} allowed mode policy is empty`);
  }

  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    throw new Error(`${label} metadata is unavailable (${errorCode(error)})`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
  if (process.platform !== "win32") {
    validateIdentityAndMode(stat, label, {
      expectedUid,
      expectedGid,
      allowedModes,
    });
  }

  const noFollow = typeof constants.O_NOFOLLOW === "number"
    ? constants.O_NOFOLLOW
    : 0;
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | noFollow);
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) {
      throw new Error(`${label} identity changed during metadata validation`);
    }
    if (process.platform !== "win32") {
      validateIdentityAndMode(opened, label, {
        expectedUid,
        expectedGid,
        allowedModes,
      });
    }
    return { descriptor, opened };
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (error instanceof Error && error.message.startsWith(`${label} `)) {
      throw error;
    }
    throw new Error(`${label} could not be opened safely (${errorCode(error)})`);
  }
}

/**
 * Validate credential-file metadata without reading or returning its contents.
 *
 * Windows ACL policy is enforced by the companion PowerShell preflight. Node's
 * portable fs API does not expose Windows DACL ownership/inheritance details,
 * so Windows callers still receive the regular-file and anti-symlink checks.
 */
export function assertPrivateCredentialFile(
  path,
  label,
  {
    expectedUid = currentIdentity().uid,
    expectedGid,
    allowedModes = [0o600],
  } = {},
) {
  const { descriptor, opened } = openPrivateCredentialFile(path, label, {
    expectedUid,
    expectedGid,
    allowedModes,
  });
  try {
    return metadata(opened);
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Validate and read credential bytes through the same O_NOFOLLOW descriptor.
 * A second fstat rejects in-place mutation while the bytes are being read.
 */
export function readPrivateCredentialFile(path, label, options = {}) {
  const { descriptor, opened } = openPrivateCredentialFile(path, label, options);
  try {
    const before = fstatSync(descriptor, { bigint: true });
    const contents = readFileSync(descriptor, "utf8");
    const after = fstatSync(descriptor, { bigint: true });
    if (
      before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs
      || before.ctimeNs !== after.ctimeNs
    ) {
      throw new Error(`${label} changed while its contents were being read`);
    }
    return Object.freeze({
      contents,
      metadata: metadata(opened),
    });
  } finally {
    closeSync(descriptor);
  }
}

export function sameCredentialFileIdentity(left, right) {
  return Boolean(
    left
    && right
    && left.device === right.device
    && left.inode === right.inode
  );
}

export function sameCredentialFileVersion(left, right) {
  return Boolean(
    sameCredentialFileIdentity(left, right)
    && left.mode === right.mode
    && left.uid === right.uid
    && left.gid === right.gid
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
  );
}

function sameCredentialDirectoryIdentity(left, right) {
  return Boolean(
    sameCredentialFileIdentity(left, right)
    && left.mode === right.mode
    && left.uid === right.uid
    && left.gid === right.gid
  );
}

/**
 * Durably replace a guarded credential file only if the source bytes/metadata
 * and its parent directory still refer to the versions inspected by the
 * caller. The parent descriptor remains open across publication and is
 * fsync'd after rename on POSIX.
 * @param {string} path
 * @param {string} label
 * @param {string} contents
 * @param {{device: number, inode: number, mode: number, uid: number, gid: number, size: number, mtimeMs: number, ctimeMs: number}} expectedMetadata
 * @param {{allowedDirectoryModes?: number[], beforePublish?: () => void}} [options]
 */
export function writePrivateCredentialFileCas(
  path,
  label,
  contents,
  expectedMetadata,
  {
    allowedDirectoryModes = [0o700, 0o750, 0o755],
    beforePublish,
  } = {},
) {
  validatePath(path, label);
  if (typeof contents !== "string" || contents.includes("\0")) {
    throw new Error(`${label} replacement contents are invalid`);
  }
  const parent = dirname(path);
  const parentLabel = `${label} parent directory`;
  const expectedParent = assertPrivateCredentialDirectory(parent, parentLabel, {
    allowedModes: allowedDirectoryModes,
  });
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const directoryOnly = typeof constants.O_DIRECTORY === "number" ? constants.O_DIRECTORY : 0;
  let directoryDescriptor;
  let temporaryDescriptor;
  const temporaryPath = `${path}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  try {
    directoryDescriptor = openSync(
      parent,
      constants.O_RDONLY | noFollow | directoryOnly,
    );
    const openedParent = metadata(fstatSync(directoryDescriptor));
    if (!sameCredentialDirectoryIdentity(expectedParent, openedParent)) {
      throw new Error(`${parentLabel} identity changed before update`);
    }
    const sourceBeforeWrite = assertPrivateCredentialFile(path, label);
    if (!sameCredentialFileVersion(expectedMetadata, sourceBeforeWrite)) {
      throw new Error(`${label} changed after it was read; refusing to overwrite it`);
    }
    temporaryDescriptor = openSync(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
      0o600,
    );
    writeFileSync(temporaryDescriptor, contents, "utf8");
    fsyncSync(temporaryDescriptor);
    closeSync(temporaryDescriptor);
    temporaryDescriptor = undefined;
    if (process.platform !== "win32") chmodSync(temporaryPath, 0o600);
    const temporaryMetadata = assertPrivateCredentialFile(
      temporaryPath,
      `${label} temporary replacement`,
    );
    if (typeof beforePublish === "function") beforePublish();

    const sourceBeforePublish = assertPrivateCredentialFile(path, label);
    const parentBeforePublish = assertPrivateCredentialDirectory(parent, parentLabel, {
      allowedModes: allowedDirectoryModes,
    });
    const heldParentBeforePublish = metadata(fstatSync(directoryDescriptor));
    if (!sameCredentialFileVersion(expectedMetadata, sourceBeforePublish)) {
      throw new Error(`${label} changed before publication; refusing to overwrite it`);
    }
    if (
      !sameCredentialDirectoryIdentity(expectedParent, parentBeforePublish)
      || !sameCredentialDirectoryIdentity(expectedParent, heldParentBeforePublish)
    ) {
      throw new Error(`${parentLabel} changed before publication`);
    }

    renameSync(temporaryPath, path);
    const published = assertPrivateCredentialFile(path, label);
    if (!sameCredentialFileIdentity(temporaryMetadata, published)) {
      throw new Error(`${label} publication did not preserve the validated replacement identity`);
    }
    const parentAfterPublish = assertPrivateCredentialDirectory(parent, parentLabel, {
      allowedModes: allowedDirectoryModes,
    });
    if (!sameCredentialDirectoryIdentity(expectedParent, parentAfterPublish)) {
      throw new Error(`${parentLabel} changed during publication`);
    }
    if (process.platform !== "win32") fsyncSync(directoryDescriptor);
    return published;
  } finally {
    if (temporaryDescriptor !== undefined) closeSync(temporaryDescriptor);
    if (directoryDescriptor !== undefined) closeSync(directoryDescriptor);
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function replaceEnvironmentAssignment(contents, name, value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error("environment assignment name is invalid");
  }
  if (typeof value !== "string" || /[\0\r\n]/.test(value)) {
    throw new Error(`${name} contains an unsafe control character`);
  }
  let replaced = false;
  const output = contents.replaceAll("\r\n", "\n").split("\n").flatMap((line) => {
    const assignment = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (assignment?.[1] !== name) return [line];
    if (replaced) return [];
    replaced = true;
    return [`${name}=${value}`];
  });
  if (output.at(-1) === "") output.pop();
  if (!replaced) output.push(`${name}=${value}`);
  return `${output.join("\n")}\n`;
}

if (
  process.argv[1]
  && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])
) {
  try {
    if (
      !(
        process.argv.length === 4
        && process.argv[2] === "file"
      )
      && !(
        process.argv.length === 5
        && process.argv[2] === "env-set"
      )
    ) {
      throw new Error("usage: credential-file-guard.mjs file PATH | env-set PATH NAME < VALUE");
    }
    if (process.argv[2] === "env-set") {
      const path = process.argv[3];
      const name = process.argv[4];
      const value = readFileSync(0, "utf8");
      const current = readPrivateCredentialFile(path, "production environment file");
      writePrivateCredentialFileCas(
        path,
        "production environment file",
        replaceEnvironmentAssignment(current.contents, name, value),
        current.metadata,
      );
      process.exit(0);
    }
    assertPrivateCredentialFile(
      process.argv[3],
      "production environment file",
    );
  } catch (error) {
    process.stderr.write(
      `Credential file preflight failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

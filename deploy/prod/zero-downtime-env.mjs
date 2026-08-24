#!/usr/bin/env node

import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import {
  parseProductionEnvironmentFile,
  validateProductionEnvironment,
} from "./production-env-rules.mjs";

const IMAGE_CONFIGURATION_NAMES = Object.freeze([
  "CLEAN_PAY_DEPLOY_SOURCE",
  "CLEAN_PAY_IMAGE",
  "CLEAN_PAY_MIGRATION_IMAGE",
  "CLEAN_PAY_RELEASE",
  "CLEAN_PAY_REVISION",
]);
const IMAGE_CONFIGURATION_NAME_SET = new Set(IMAGE_CONFIGURATION_NAMES);

try {
  const input = parseArguments(process.argv.slice(2));
  const pair = readAndVerifyPair(input.currentPath, input.rollbackPath);
  if (input.command === "restore-images") {
    restoreImageConfiguration(pair);
  }
  process.stdout.write(
    input.command === "verify"
      ? "Zero-downtime environment pair is compatible.\n"
      : "Authoritative image configuration was restored.\n",
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write("Zero-downtime environment guard failed: " + message + "\n");
  process.exitCode = 1;
}

function parseArguments(args) {
  if (
    args.length !== 3 ||
    !["verify", "restore-images"].includes(args[0])
  ) {
    throw new Error(
      "usage: zero-downtime-env.mjs <verify|restore-images> CURRENT_ENV ROLLBACK_ENV",
    );
  }
  const currentPath = args[1];
  const rollbackPath = args[2];
  for (const [label, path] of [
    ["current env", currentPath],
    ["rollback env", rollbackPath],
  ]) {
    if (!isAbsolute(path)) {
      throw new Error(label + " path must be absolute");
    }
    if (/[\x00\r\n]/.test(path)) {
      throw new Error(label + " path contains a control character");
    }
  }
  if (resolve(currentPath) === resolve(rollbackPath)) {
    throw new Error("current and rollback env files must be different files");
  }
  return { command: args[0], currentPath, rollbackPath };
}

function inspectPrivateRegularFile(path, label) {
  if (!existsSync(path)) {
    throw new Error(label + " does not exist");
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(label + " must be a regular non-symlink file");
  }
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    throw new Error(label + " must not be accessible by group or other users");
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new Error(label + " must be owned by the current operator");
  }
  return stat;
}

function readAndVerifyPair(currentPath, rollbackPath) {
  const currentStat = inspectPrivateRegularFile(currentPath, "current env");
  inspectPrivateRegularFile(rollbackPath, "rollback env");
  const currentContents = readFileSync(currentPath, "utf8");
  const rollbackContents = readFileSync(rollbackPath, "utf8");
  const current = parseProductionEnvironmentFile(currentContents, "current env");
  const rollback = parseProductionEnvironmentFile(
    rollbackContents,
    "rollback env",
  );
  validateProductionEnvironment(current);
  validateProductionEnvironment(rollback);

  for (const name of IMAGE_CONFIGURATION_NAMES) {
    if (!Object.hasOwn(current, name) || !Object.hasOwn(rollback, name)) {
      throw new Error(name + " must exist in both env files");
    }
  }
  const names = new Set([...Object.keys(current), ...Object.keys(rollback)]);
  for (const name of names) {
    if (IMAGE_CONFIGURATION_NAME_SET.has(name)) {
      continue;
    }
    if (!Object.hasOwn(current, name) || !Object.hasOwn(rollback, name)) {
      throw new Error(name + " must exist in both env files");
    }
    if (current[name] !== rollback[name]) {
      throw new Error(
        name +
          " differs; only the five image/release settings may change during rollout",
      );
    }
  }
  return {
    currentContents,
    currentPath,
    currentStat,
    rollback,
    rollbackContents,
  };
}

function restoreImageConfiguration(pair) {
  const rollbackAssignments = assignmentLines(
    pair.rollbackContents,
    "rollback env",
  );
  const newline = pair.currentContents.includes("\r\n") ? "\r\n" : "\n";
  const hadFinalNewline = /\r?\n$/.test(pair.currentContents);
  const currentLines = pair.currentContents.split(/\r?\n/);
  if (hadFinalNewline) {
    currentLines.pop();
  }

  const replaced = new Set();
  const restoredLines = currentLines.map((line) => {
    const name = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
    if (!name || !IMAGE_CONFIGURATION_NAME_SET.has(name)) {
      return line;
    }
    if (replaced.has(name)) {
      throw new Error("current env duplicates " + name);
    }
    replaced.add(name);
    return rollbackAssignments.get(name);
  });
  for (const name of IMAGE_CONFIGURATION_NAMES) {
    if (!replaced.has(name)) {
      throw new Error("current env is missing " + name);
    }
  }

  let restoredContents = restoredLines.join(newline);
  if (hadFinalNewline) {
    restoredContents += newline;
  }
  const restored = parseProductionEnvironmentFile(restoredContents, "restored env");
  validateProductionEnvironment(restored);
  const rollbackNames = Object.keys(pair.rollback);
  if (Object.keys(restored).length !== rollbackNames.length) {
    throw new Error("restored env has a different set of variables");
  }
  for (const name of rollbackNames) {
    if (restored[name] !== pair.rollback[name]) {
      throw new Error("restored env does not match rollback value for " + name);
    }
  }

  const directory = dirname(pair.currentPath);
  const temporaryPath =
    pair.currentPath + ".zdt-restore-" + String(process.pid);
  let temporaryExists = false;
  try {
    const descriptor = openSync(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      pair.currentStat.mode & 0o700,
    );
    temporaryExists = true;
    try {
      writeFileSync(descriptor, restoredContents, "utf8");
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    inspectPrivateRegularFile(temporaryPath, "temporary restored env");
    const currentBeforePublish = inspectPrivateRegularFile(
      pair.currentPath,
      "current env before atomic publish",
    );
    if (
      currentBeforePublish.dev !== pair.currentStat.dev ||
      currentBeforePublish.ino !== pair.currentStat.ino
    ) {
      throw new Error("current env identity changed before atomic publish");
    }
    renameSync(temporaryPath, pair.currentPath);
    temporaryExists = false;
    fsyncDirectory(directory);
  } finally {
    if (temporaryExists) {
      unlinkSync(temporaryPath);
    }
  }
}

function assignmentLines(contents, source) {
  const assignments = new Map();
  const lines = contents.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const name = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
    if (!name || !IMAGE_CONFIGURATION_NAME_SET.has(name)) {
      continue;
    }
    if (assignments.has(name)) {
      throw new Error(source + ":" + String(index + 1) + " duplicates " + name);
    }
    assignments.set(name, line);
  }
  for (const name of IMAGE_CONFIGURATION_NAMES) {
    if (!assignments.has(name)) {
      throw new Error(source + " is missing " + name);
    }
  }
  return assignments;
}

function fsyncDirectory(directory) {
  if (process.platform === "win32") {
    return;
  }
  const descriptor = openSync(directory, constants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

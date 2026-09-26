import { existsSync, statfsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = path.join(rootDir, ".devcontainer", "docker-compose.yml");
const explicitProjectName = process.env.CLEAN_PAY_DEVCONTAINER_PROJECT?.trim();
const projectName = explicitProjectName
  || `clean-pay-e2e-${process.pid}-${randomUUID().slice(0, 8)}`;
const devcontainerHostPortDefaults = {
  CLEAN_PAY_DEVCONTAINER_APP_HOST_PORT: "4000",
  CLEAN_PAY_DEVCONTAINER_PRISMA_STUDIO_HOST_PORT: "5555",
  CLEAN_PAY_DEVCONTAINER_POSTGRES_HOST_PORT: "5432",
  CLEAN_PAY_DEVCONTAINER_REDIS_HOST_PORT: "6379",
  CLEAN_PAY_DEVCONTAINER_REMNASHOP_HOST_PORT: "5001",
  CLEAN_PAY_DEVCONTAINER_REMNASHOP_POSTGRES_HOST_PORT: "6767",
  CLEAN_PAY_DEVCONTAINER_TELEGRAM_OIDC_HOST_PORT: "8090",
  CLEAN_PAY_DEVCONTAINER_MAILPIT_HTTP_HOST_PORT: "8025",
  CLEAN_PAY_DEVCONTAINER_MAILPIT_SMTP_HOST_PORT: "1025",
  CLEAN_PAY_DEVCONTAINER_CADDY_APP_HOST_PORT: "8080",
  CLEAN_PAY_DEVCONTAINER_CADDY_REMNASHOP_HOST_PORT: "8081",
  CLEAN_PAY_DEVCONTAINER_CADDY_MAILPIT_HOST_PORT: "8026",
};
const hostE2eMinimumFreeBytes = 15n * 1024n * 1024n * 1024n;
const internalDiskPreflightOnlyEnv =
  "CLEAN_PAY_INTERNAL_E2E_DISK_PREFLIGHT_ONLY";
const internalHostPlatformEnv = "CLEAN_PAY_INTERNAL_E2E_HOST_PLATFORM";
const internalMinimumFreeBytesEnv =
  "CLEAN_PAY_INTERNAL_E2E_MIN_FREE_BYTES";
const internalRunnerLocationEnv = "CLEAN_PAY_INTERNAL_E2E_RUNNER_LOCATION";

configureDevcontainerIsolation();

function configureDevcontainerIsolation() {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(projectName)) {
    console.error(
      "CLEAN_PAY_DEVCONTAINER_PROJECT must start with a lowercase letter or digit " +
      "and contain only lowercase letters, digits, hyphens, or underscores.",
    );
    process.exit(1);
  }

  const allocatedPorts = new Map();

  for (const [name, fallback] of Object.entries(devcontainerHostPortDefaults)) {
    // An automatically named, one-shot E2E project does not need stable host
    // publications. Ask Docker for ephemeral loopback ports so parallel runs
    // cannot collide; explicit devcontainer projects keep their documented
    // development defaults.
    const value = process.env[name]?.trim() || (explicitProjectName ? fallback : "0");

    if (!/^(?:0|[1-9][0-9]{0,4})$/.test(value) || Number(value) > 65_535) {
      console.error(`${name} must be an integer between 0 and 65535.`);
      process.exit(1);
    }

    const previous = value === "0" ? undefined : allocatedPorts.get(value);

    if (previous) {
      console.error(`${name} and ${previous} cannot publish the same host port ${value}.`);
      process.exit(1);
    }

    if (value !== "0") {
      allocatedPorts.set(value, name);
    }
    process.env[name] = value;
  }

  process.env.CLEAN_PAY_DEVCONTAINER_PROJECT = projectName;
  process.env.CLEAN_PAY_DEVCONTAINER_REMNASHOP_IMAGE =
    process.env.CLEAN_PAY_DEVCONTAINER_REMNASHOP_IMAGE?.trim() ||
    `${projectName}-remnashop:latest`;
}

function isRemnashopSource(directory) {
  return (
    existsSync(path.join(directory, "Dockerfile")) &&
    existsSync(path.join(directory, "docker-migrate.sh")) &&
    existsSync(path.join(directory, "src"))
  );
}

if (
  !isInsideDevcontainer() &&
  process.env.REMNASHOP_DISCOVER_HOST_SOURCE === "1" &&
  !process.env.REMNASHOP_HOST_SOURCE &&
  !process.env.REMNASHOP_BUILD_CONTEXT
) {
  const workspaceParent = path.dirname(rootDir);
  const candidates = [
    path.join(workspaceParent, "remnashop-security-remediation"),
    path.join(workspaceParent, "remnashop"),
  ];
  const discovered = candidates.find(isRemnashopSource);
  if (discovered) process.env.REMNASHOP_HOST_SOURCE = discovered;
}

if (
  !isInsideDevcontainer() &&
  process.env.REMNASHOP_HOST_SOURCE &&
  !isRemnashopSource(path.resolve(process.env.REMNASHOP_HOST_SOURCE))
) {
  console.error(
    "REMNASHOP_HOST_SOURCE is not a compatible Remnashop checkout: " +
    process.env.REMNASHOP_HOST_SOURCE,
  );
  process.exit(1);
}

if (process.platform === "win32" && !process.env.CLEAN_PAY_HOST_DEVCONTAINER_DIR) {
  process.env.CLEAN_PAY_HOST_DEVCONTAINER_DIR = path.join(rootDir, ".devcontainer");
}

if (process.env.REMNASHOP_HOST_SOURCE && !process.env.REMNASHOP_BUILD_CONTEXT) {
  process.env.REMNASHOP_BUILD_CONTEXT = process.env.REMNASHOP_HOST_SOURCE;
}

const passThroughEnv = [
  "CLEAN_PAY_DEVCONTAINER_PROJECT",
  "CLEAN_PAY_DEVCONTAINER_APP_HOST_PORT",
  "CLEAN_PAY_DEVCONTAINER_PRISMA_STUDIO_HOST_PORT",
  "CLEAN_PAY_DEVCONTAINER_POSTGRES_HOST_PORT",
  "CLEAN_PAY_DEVCONTAINER_REDIS_HOST_PORT",
  "CLEAN_PAY_DEVCONTAINER_REMNASHOP_HOST_PORT",
  "CLEAN_PAY_DEVCONTAINER_REMNASHOP_POSTGRES_HOST_PORT",
  "CLEAN_PAY_DEVCONTAINER_TELEGRAM_OIDC_HOST_PORT",
  "CLEAN_PAY_DEVCONTAINER_MAILPIT_HTTP_HOST_PORT",
  "CLEAN_PAY_DEVCONTAINER_MAILPIT_SMTP_HOST_PORT",
  "CLEAN_PAY_DEVCONTAINER_CADDY_APP_HOST_PORT",
  "CLEAN_PAY_DEVCONTAINER_CADDY_REMNASHOP_HOST_PORT",
  "CLEAN_PAY_DEVCONTAINER_CADDY_MAILPIT_HOST_PORT",
  "CLEAN_PAY_DEVCONTAINER_REMNASHOP_IMAGE",
  "CLEAN_PAY_E2E_BASE_URL",
  "CLEAN_PAY_E2E_MAILPIT_URL",
  "CLEAN_PAY_E2E_OIDC_URL",
  "CLEAN_PAY_HOST_DEVCONTAINER_DIR",
  "CLEAN_PAY_E2E_DIAGNOSTICS",
  "KEEP_E2E_STACK",
  "REMNASHOP_BUILD_CONTEXT",
  "REMNASHOP_BUILD_REVISION",
  "REMNASHOP_HOST_SOURCE",
  "REMNASHOP_DISCOVER_HOST_SOURCE",
  "REMNASHOP_MINIMUM_ALEMBIC_REVISION",
];

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: process.env,
    shell: false,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  process.exitCode = result.status ?? 1;
  return process.exitCode;
}

function sleepSync(milliseconds) {
  Atomics.wait(
    new Int32Array(new SharedArrayBuffer(4)),
    0,
    0,
    milliseconds,
  );
}

function runWithRetries(command, args, {
  attempts = 3,
  beforeRetry,
  label = command,
} = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const status = run(command, args);

    if (status === 0) {
      return 0;
    }

    if (attempt < attempts) {
      console.error(
        `${label} failed on attempt ${attempt}/${attempts}; retrying...`,
      );
      if (beforeRetry && beforeRetry() !== 0) {
        console.error(`${label} cleanup failed; aborting retries.`);
        return process.exitCode || status;
      }
      sleepSync(attempt * 2_000);
    }
  }

  return process.exitCode || 1;
}

function dockerDesktopHostPath(value) {
  const windowsPath = /^([A-Za-z]):[\\/](.*)$/.exec(value);

  if (!windowsPath) {
    return value;
  }

  return `/host_mnt/${windowsPath[1].toLowerCase()}/${windowsPath[2].replaceAll("\\", "/")}`;
}

function isInsideDevcontainer() {
  if (process.env.NODE_ENV === "test") {
    const internalLocation = process.env[internalRunnerLocationEnv]?.trim();

    if (internalLocation === "host") return false;
    if (internalLocation === "inner") return true;
  }

  return (
    process.env.CLEAN_PAY_E2E_RUNNER_INSIDE === "1" ||
    process.env.REMOTE_CONTAINERS === "true" ||
    existsSync("/.dockerenv")
  );
}

function isCiEnvironment() {
  return /^(?:1|true)$/iu.test(process.env.CI?.trim() ?? "");
}

function hostPlatform() {
  if (process.env.NODE_ENV === "test") {
    return process.env[internalHostPlatformEnv]?.trim() || process.platform;
  }

  return process.platform;
}

function requiredHostFreeBytes() {
  const internalValue = process.env.NODE_ENV === "test"
    ? process.env[internalMinimumFreeBytesEnv]?.trim()
    : undefined;

  if (internalValue === undefined || internalValue === "") {
    return hostE2eMinimumFreeBytes;
  }

  if (!/^[1-9][0-9]*$/u.test(internalValue)) {
    throw new Error(
      `${internalMinimumFreeBytesEnv} must be a positive integer in test mode.`,
    );
  }

  return BigInt(internalValue);
}

function assertHostDiskSpace() {
  if (
    isInsideDevcontainer()
    || hostPlatform() !== "win32"
    || isCiEnvironment()
  ) {
    return;
  }

  const requiredBytes = requiredHostFreeBytes();
  let stats;

  try {
    stats = statfsSync(rootDir, { bigint: true });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      && typeof error.code === "string" && /^[A-Z0-9_]{1,32}$/u.test(error.code)
      ? error.code
      : "UNKNOWN";

    throw new Error(
      "E2E host disk preflight failed: " +
      `path=${JSON.stringify(rootDir)} fsType=unavailable ` +
      `freeBytes=unavailable requiredBytes=${requiredBytes} ` +
      `statfsCode=${code}.`,
    );
  }

  const freeBytes = stats.bavail * stats.bsize;

  if (freeBytes < requiredBytes) {
    throw new Error(
      "E2E host disk preflight failed: " +
      `path=${JSON.stringify(rootDir)} ` +
      `fsType=0x${stats.type.toString(16)} ` +
      `blockSizeBytes=${stats.bsize} availableBlocks=${stats.bavail} ` +
      `freeBytes=${freeBytes} requiredBytes=${requiredBytes}.`,
    );
  }
}

function isInternalDiskPreflightOnly() {
  return process.env.NODE_ENV === "test"
    && process.env[internalDiskPreflightOnlyEnv] === "1";
}

function runShellScript() {
  return run("bash", ["scripts/e2e-devcontainer.sh"]);
}

function cleanupComposeStack(composeArgs) {
  return run("docker", [
    ...composeArgs,
    "down",
    "--remove-orphans",
    "--volumes",
  ]);
}

function runInsideDevcontainer() {
  const composeArgs = ["compose", "-p", projectName, "-f", composeFile];
  const resetE2e = process.env.RESET_E2E ?? "1";
  let status = 0;

  try {
    if (resetE2e === "1") {
      status = cleanupComposeStack(composeArgs);

      if (status !== 0) {
        return status;
      }
    }

    status = runWithRetries(
      "docker",
      [...composeArgs, "up", "-d", "--build", "app"],
      {
        attempts: 3,
        beforeRetry: () => cleanupComposeStack(composeArgs),
        label: "Devcontainer image build/start",
      },
    );

    if (status !== 0) {
      return status;
    }

    status = run("docker", [
      ...composeArgs,
      "exec",
      "-T",
      "-u",
      "root",
      "app",
      "sh",
      "-lc",
      "for attempt in $(seq 1 120); do [ -f /tmp/clean-pay-dev-ready ] && exit 0; sleep 1; done; echo 'Timed out waiting 120 seconds for the Clean Pay devcontainer bootstrap' >&2; exit 1",
    ]);

    if (status !== 0) {
      return status;
    }

    const execArgs = [...composeArgs, "exec", "-T", "-u", "node"];

    for (const name of passThroughEnv) {
      if (process.env[name] !== undefined) {
        const value = name === "CLEAN_PAY_E2E_BASE_URL"
          ? "http://localhost:4000"
          : name === "CLEAN_PAY_E2E_MAILPIT_URL"
            ? "http://smtp:8025"
            : name === "CLEAN_PAY_E2E_OIDC_URL"
              ? "http://telegram-oidc-mock:8090"
              : name === "CLEAN_PAY_HOST_DEVCONTAINER_DIR"
                ? dockerDesktopHostPath(process.env[name])
                : name === "REMNASHOP_BUILD_CONTEXT" && process.env.REMNASHOP_HOST_SOURCE
                  ? "/workspace/remnashop-source"
                  : process.env[name];

        execArgs.push("-e", `${name}=${value}`);
      }
    }

    execArgs.push("app", "bash", "-lc", "CLEAN_PAY_E2E_RUNNER_INSIDE=1 npm run test:e2e:devcontainer");
    status = run("docker", execArgs);
    return status;
  } finally {
    if (process.env.KEEP_E2E_STACK !== "1") {
      const cleanupStatus = cleanupComposeStack(composeArgs);
      process.exitCode = status || cleanupStatus;
    }
  }
}

const insideDevcontainer = isInsideDevcontainer();

if (!insideDevcontainer) {
  try {
    assertHostDiskSpace();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "E2E host disk preflight failed.");
    process.exit(1);
  }
}

if (isInternalDiskPreflightOnly()) {
  process.exitCode = 0;
} else if (insideDevcontainer) {
  runShellScript();
} else {
  runInsideDevcontainer();
}

import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = path.join(rootDir, ".devcontainer", "docker-compose.yml");
const projectName = process.env.CLEAN_PAY_DEVCONTAINER_PROJECT ?? "clean-pay-dev";
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
    const value = process.env[name]?.trim() || fallback;

    if (!/^[1-9][0-9]{0,4}$/.test(value) || Number(value) > 65_535) {
      console.error(`${name} must be an integer between 1 and 65535.`);
      process.exit(1);
    }

    const previous = allocatedPorts.get(value);

    if (previous) {
      console.error(`${name} and ${previous} cannot publish the same host port ${value}.`);
      process.exit(1);
    }

    allocatedPorts.set(value, name);
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
  return (
    process.env.CLEAN_PAY_E2E_RUNNER_INSIDE === "1" ||
    process.env.REMOTE_CONTAINERS === "true" ||
    existsSync("/.dockerenv")
  );
}

function runShellScript() {
  return run("bash", ["scripts/e2e-devcontainer.sh"]);
}

function runInsideDevcontainer() {
  const composeArgs = ["compose", "-p", projectName, "-f", composeFile];
  const resetE2e = process.env.RESET_E2E ?? "1";

  if (resetE2e === "1") {
    const resetStatus = run("docker", [...composeArgs, "down", "--remove-orphans", "--volumes"]);

    if (resetStatus !== 0) {
      return resetStatus;
    }
  }

  const upStatus = runWithRetries(
    "docker",
    [...composeArgs, "up", "-d", "--build", "app"],
    {
      attempts: 3,
      label: "Devcontainer image build/start",
    },
  );

  if (upStatus !== 0) {
    return upStatus;
  }

  const readyStatus = run("docker", [
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

  if (readyStatus !== 0) {
    return readyStatus;
  }

  const execArgs = [...composeArgs, "exec", "-T", "-u", "node"];

  for (const name of passThroughEnv) {
    if (process.env[name] !== undefined) {
      const value = name === "CLEAN_PAY_HOST_DEVCONTAINER_DIR"
        ? dockerDesktopHostPath(process.env[name])
        : name === "REMNASHOP_BUILD_CONTEXT" && process.env.REMNASHOP_HOST_SOURCE
          ? "/workspace/remnashop-source"
          : process.env[name];

      execArgs.push("-e", `${name}=${value}`);
    }
  }

  execArgs.push("app", "bash", "-lc", "CLEAN_PAY_E2E_RUNNER_INSIDE=1 npm run test:e2e:devcontainer");
  return run("docker", execArgs);
}

if (isInsideDevcontainer()) {
  runShellScript();
} else {
  runInsideDevcontainer();
}

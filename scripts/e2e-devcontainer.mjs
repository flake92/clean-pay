import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = path.join(rootDir, ".devcontainer", "docker-compose.yml");
const projectName = process.env.CLEAN_PAY_DEVCONTAINER_PROJECT ?? "clean-pay-dev";
const passThroughEnv = [
  "CLEAN_PAY_DEVCONTAINER_PROJECT",
  "CLEAN_PAY_E2E_BASE_URL",
  "CLEAN_PAY_E2E_MAILPIT_URL",
  "CLEAN_PAY_E2E_OIDC_URL",
  "CLEAN_PAY_HOST_DEVCONTAINER_DIR",
  "KEEP_E2E_STACK",
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

  if (process.env.RESET_E2E === "1") {
    const resetStatus = run("docker", [...composeArgs, "down", "--remove-orphans", "--volumes"]);

    if (resetStatus !== 0) {
      return resetStatus;
    }
  }

  const upStatus = run("docker", [...composeArgs, "up", "-d", "--build", "app"]);

  if (upStatus !== 0) {
    return upStatus;
  }

  const execArgs = [...composeArgs, "exec", "-T", "-u", "node"];

  for (const name of passThroughEnv) {
    if (process.env[name] !== undefined) {
      execArgs.push("-e", `${name}=${process.env[name]}`);
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

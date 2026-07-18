import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  COMPOSE_INTERPOLATION_ENVIRONMENT_NAMES,
  ProductionEnvironmentError,
  parseProductionEnvironmentFile,
} from "./production-env-rules.mjs";
import { assessReadinessResponse } from "./readiness.mjs";

const prodDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(prodDir, "../..");
const envFile = path.join(prodDir, ".env");
const validateEnvScript = path.join(prodDir, "validate-env.mjs");
const composeFiles = [
  path.join(prodDir, "docker-compose.yml"),
];

const args = process.argv.slice(2);
const debug = args.includes("-debug") || args.includes("--debug");
const command = args.find((arg) => !arg.startsWith("-")) || "help";
let parsedEnvironment = null;

if (debug) {
  composeFiles.push(path.join(prodDir, "docker-compose.debug.yml"));
}

function readEnvValue(name, fallback) {
  if (!existsSync(envFile)) {
    return fallback;
  }

  const value = productionFileEnvironment()[name]?.trim() || "";

  return value || fallback;
}

function productionFileEnvironment() {
  if (!parsedEnvironment) {
    try {
      parsedEnvironment = parseProductionEnvironmentFile(
        readFileSync(envFile, "utf8"),
        envFile,
      );
    } catch (error) {
      const message =
        error instanceof ProductionEnvironmentError || error instanceof Error
          ? error.message
          : String(error);

      console.error(`Invalid production environment: ${message}`);
      process.exit(1);
    }
  }

  return parsedEnvironment;
}

function productionChildEnvironment() {
  const environment = { ...process.env };

  for (const name of COMPOSE_INTERPOLATION_ENVIRONMENT_NAMES) {
    delete environment[name];
  }

  return { ...environment, ...productionFileEnvironment() };
}

function composeArgs(...extra) {
  const base = ["compose", "--env-file", envFile];

  for (const file of composeFiles) {
    base.push("-f", file);
  }

  if (readEnvValue("PAYMENT_RECONCILIATION_ENABLED", "false") === "true") {
    base.push("--profile", "reconciliation");
  }

  return [...base, ...extra];
}

function run(commandName, commandArgs) {
  const result = spawnSync(commandName, commandArgs, {
    cwd: rootDir,
    env: productionChildEnvironment(),
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

function runDocker(args, options = {}) {
  const result = spawnSync("docker", args, {
    cwd: rootDir,
    env: productionChildEnvironment(),
    stdio: options.stdio ?? "inherit",
    shell: false,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  return result.status ?? 1;
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function assertReconciliationWorkerHealthy() {
  if (readEnvValue("PAYMENT_RECONCILIATION_ENABLED", "false") !== "true") {
    return;
  }

  const deadline = Date.now() + 120_000;
  let lastStatus = "container not found";

  while (Date.now() < deadline) {
    const container = spawnSync(
      "docker",
      composeArgs("ps", "-q", "reconciliation-worker"),
      {
        cwd: rootDir,
        env: productionChildEnvironment(),
        encoding: "utf8",
        stdio: "pipe",
        shell: false,
      },
    );

    if (container.error) {
      console.error(container.error.message);
      process.exit(1);
    }

    if (container.status !== 0) {
      process.stderr.write(
        container.stderr || "Failed to inspect reconciliation-worker.\n",
      );
      process.exit(container.status ?? 1);
    }

    const containerId = container.stdout.trim();

    if (containerId) {
      const health = spawnSync(
        "docker",
        [
          "inspect",
          "--format",
          "{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}",
          containerId,
        ],
        {
          cwd: rootDir,
          env: productionChildEnvironment(),
          encoding: "utf8",
          stdio: "pipe",
          shell: false,
        },
      );

      if (!health.error && health.status === 0) {
        lastStatus = health.stdout.trim() || "unknown";

        if (lastStatus === "healthy") {
          console.log("OK reconciliation-worker is healthy");
          return;
        }
      } else {
        lastStatus = health.error?.message || health.stderr.trim() || "inspect failed";
      }
    }

    sleepSync(2_000);
  }

  console.error(
    `PAYMENT_RECONCILIATION_ENABLED=true, but reconciliation-worker is not healthy (${lastStatus}).`,
  );
  process.exit(1);
}

function assertRetentionWorkerHealthy() {
  const deadline = Date.now() + 120_000;
  let lastStatus = "container not found";

  while (Date.now() < deadline) {
    const container = spawnSync(
      "docker",
      composeArgs("ps", "-q", "retention-worker"),
      {
        cwd: rootDir,
        env: productionChildEnvironment(),
        encoding: "utf8",
        stdio: "pipe",
        shell: false,
      },
    );

    if (container.error) {
      console.error(container.error.message);
      process.exit(1);
    }

    if (container.status !== 0) {
      process.stderr.write(
        container.stderr || "Failed to inspect retention-worker.\n",
      );
      process.exit(container.status ?? 1);
    }

    const containerId = container.stdout.trim();

    if (containerId) {
      const health = spawnSync(
        "docker",
        [
          "inspect",
          "--format",
          "{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}",
          containerId,
        ],
        {
          cwd: rootDir,
          env: productionChildEnvironment(),
          encoding: "utf8",
          stdio: "pipe",
          shell: false,
        },
      );

      if (!health.error && health.status === 0) {
        lastStatus = health.stdout.trim() || "unknown";

        if (lastStatus === "healthy") {
          console.log("OK retention-worker is healthy");
          return;
        }
      } else {
        lastStatus = health.error?.message || health.stderr.trim() || "inspect failed";
      }
    }

    sleepSync(2_000);
  }

  console.error(`retention-worker is not healthy (${lastStatus}).`);
  process.exit(1);
}

function ensureEdgeNetwork() {
  const networkName = readEnvValue("CLEAN_PAY_EDGE_NETWORK", "remnawave-network");
  const inspectStatus = runDocker(["network", "inspect", networkName], { stdio: "ignore" });

  if (inspectStatus === 0) {
    console.log(`Docker network ${networkName} already exists.`);
    return;
  }

  console.log(`Docker network ${networkName} not found. Creating it...`);
  const createStatus = runDocker(["network", "create", networkName]);

  if (createStatus !== 0) {
    console.error(`Failed to create Docker network ${networkName}.`);
    process.exit(createStatus);
  }
}

function requireEnvFile() {
  if (!existsSync(envFile)) {
    console.error(`Missing ${envFile}. Copy deploy/prod/.env.example and fill real values.`);
    process.exit(1);
  }
}

function validateProductionEnvFile() {
  const result = spawnSync(process.execPath, [validateEnvScript, "--env-file", envFile], {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function get(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = "";

      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => resolve({ status: response.statusCode, body }));
    });

    request.on("error", reject);
    request.setTimeout(5000, () => {
      request.destroy(new Error(`Timed out waiting for ${url}`));
    });
  });
}

async function verify() {
  requireEnvFile();

  const port = readEnvValue("CLEAN_PAY_PORT", "4000");
  const url = `http://127.0.0.1:${port}/api/health/readiness`;
  const deadline = Date.now() + 120_000;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await get(url);

      const assessment = assessReadinessResponse(response);

      if (assessment.ready) {
        console.log(`OK ${url}`);
        console.log(response.body);
        assertReconciliationWorkerHealthy();
        assertRetentionWorkerHealthy();
        return;
      }

      lastError = new Error(`${assessment.reason}: ${response.body}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.error(`Verify failed for ${url}`);
  console.error(lastError?.message || lastError);
  process.exit(1);
}

requireEnvFile();

switch (command) {
  case "build":
    validateProductionEnvFile();
    run("docker", composeArgs("build"));
    break;
  case "up":
    validateProductionEnvFile();
    ensureEdgeNetwork();
    if (runDocker(composeArgs("up", "-d", "--build")) !== 0) {
      process.exit(1);
    }
    await verify();
    break;
  case "down":
    run("docker", composeArgs("down"));
    break;
  case "logs":
    run("docker", composeArgs("logs", "-f", "app"));
    break;
  case "ps":
    {
      const status = runDocker(composeArgs("ps"));

      if (status !== 0) {
        process.exit(status);
      }

      assertReconciliationWorkerHealthy();
      assertRetentionWorkerHealthy();
    }
    break;
  case "verify":
    await verify();
    break;
  default:
    console.log("Usage: node deploy/prod/prod.mjs <build|up|down|logs|ps|verify> [-debug]");
    process.exit(command === "help" ? 0 : 1);
}

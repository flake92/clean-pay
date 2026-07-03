import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

if (debug) {
  composeFiles.push(path.join(prodDir, "docker-compose.debug.yml"));
}

function readEnvValue(name, fallback) {
  if (!existsSync(envFile)) {
    return fallback;
  }

  const line = readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${name}=`));

  const value = line ? line.slice(name.length + 1).replace(/^"|"$/g, "").trim() : "";

  return value || fallback;
}

function composeArgs(...extra) {
  const base = ["compose", "--env-file", envFile];

  for (const file of composeFiles) {
    base.push("-f", file);
  }

  return [...base, ...extra];
}

function run(commandName, commandArgs) {
  const result = spawnSync(commandName, commandArgs, {
    cwd: rootDir,
    env: process.env,
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
    env: process.env,
    stdio: options.stdio ?? "inherit",
    shell: false,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  return result.status ?? 1;
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
  const url = `http://127.0.0.1:${port}/api/health`;
  const deadline = Date.now() + 120_000;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await get(url);

      if (response.status === 200) {
        console.log(`OK ${url}`);
        console.log(response.body);
        return;
      }

      lastError = new Error(`HTTP ${response.status}: ${response.body}`);
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
    run("docker", composeArgs("up", "-d", "--build"));
    break;
  case "down":
    run("docker", composeArgs("down"));
    break;
  case "logs":
    run("docker", composeArgs("logs", "-f", "app"));
    break;
  case "ps":
    run("docker", composeArgs("ps"));
    break;
  case "verify":
    await verify();
    break;
  default:
    console.log("Usage: node deploy/prod/prod.mjs <build|up|down|logs|ps|verify> [-debug]");
    process.exit(command === "help" ? 0 : 1);
}

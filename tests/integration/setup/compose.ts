import { execFileSync } from "node:child_process";
import path from "node:path";

const rootDir = path.resolve(__dirname, "../../..");
const dockerHostRootDir = process.env.CLEAN_PAY_DOCKER_HOST_ROOT ?? rootDir;
const composeFile = path.join(dockerHostRootDir, "tests/integration/docker-compose.yml");
const projectName = process.env.CLEAN_PAY_INTEGRATION_PROJECT ?? "clean-pay-integration";

function dockerCompose(args: string[], options: { stdio?: "inherit" | "pipe" } = {}) {
  return execFileSync("docker", ["compose", "-p", projectName, "-f", composeFile, ...args], {
    cwd: dockerHostRootDir,
    stdio: options.stdio ?? "inherit",
    encoding: "utf8",
  });
}

export const integrationCompose = {
  rootDir,
  composeFile,
  projectName,
  run(args: string[], options: { stdio?: "inherit" | "pipe" } = {}) {
    return dockerCompose(args, options);
  },
  logs(services: string[]) {
    for (const service of services) {
      console.error(`\n== ${service} logs ==`);
      try {
        dockerCompose(["logs", "--tail=160", service]);
      } catch {
        // The original failure is more useful than a secondary log failure.
      }
    }
  },
};

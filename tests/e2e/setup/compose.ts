import { execFileSync } from "node:child_process";
import path from "node:path";

const rootDir = path.resolve(__dirname, "../../..");
const composeFile = path.join(rootDir, ".devcontainer/docker-compose.yml");
const projectName = process.env.CLEAN_PAY_DEVCONTAINER_PROJECT ?? "clean-pay-dev";

function dockerCompose(args: string[], options: { stdio?: "inherit" | "pipe" } = {}) {
  const composeArgs = ["compose", "-p", projectName, "-f", composeFile];

  return execFileSync("docker", [...composeArgs, ...args], {
    cwd: rootDir,
    stdio: options.stdio ?? "inherit",
    encoding: "utf8",
  });
}

export const e2eCompose = {
  rootDir,
  composeFile,
  projectName,
  logs(services: string[]) {
    for (const service of services) {
      console.error(`\n== ${service} logs ==`);
      try {
        dockerCompose(["logs", "--tail=160", service]);
      } catch {
        // Keep the original test failure as the primary signal.
      }
    }
  },
};

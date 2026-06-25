import { integrationCompose } from "./compose";

function checkDocker() {
  try {
    integrationCompose.run(["version"], { stdio: "pipe" });
  } catch {
    throw new Error("Docker Compose v2 is required for real integration tests.");
  }
}

async function setup() {
  if (process.env.SKIP_INTEGRATION_COMPOSE === "1" || process.argv.includes("list")) {
    return async () => undefined;
  }

  checkDocker();

  if (process.env.RESET_INTEGRATION === "1") {
    integrationCompose.run(["down", "--remove-orphans", "--volumes"]);
  }

  try {
    integrationCompose.run(["up", "-d", "--build", "--wait", "--wait-timeout", "300"]);
  } catch (error) {
    integrationCompose.logs([
      "app",
      "remnashop",
      "remnashop-worker",
      "remnashop-scheduler",
      "smtp",
      "telegram-oidc-mock",
      "remnawave-mock",
    ]);
    throw error;
  }
  return async () => {
    if (process.env.KEEP_INTEGRATION_STACK === "1") {
      return;
    }

    integrationCompose.run(["down", "--remove-orphans"]);
  };
}

export default setup;

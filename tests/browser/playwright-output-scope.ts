import path from "node:path";

const COMPOSE_PROJECT_SCOPE_SHA256_PREFIX = /^[a-f0-9]{16}$/;

export function projectScopedPlaywrightOutputDirectory(
  defaultDirectory: string,
  scope: string | undefined,
) {
  if (scope === undefined) return defaultDirectory;
  if (!COMPOSE_PROJECT_SCOPE_SHA256_PREFIX.test(scope)) {
    throw new Error("CLEAN_PAY_BROWSER_PLAYWRIGHT_OUTPUT_SCOPE is invalid.");
  }

  const root = path.resolve(defaultDirectory);
  const target = path.resolve(root, scope);
  const relative = path.relative(root, target);
  if (
    !relative
    || path.isAbsolute(relative)
    || relative === ".."
    || relative.startsWith(`..${path.sep}`)
  ) {
    throw new Error("Playwright output scope escaped its fixed output root.");
  }
  return path.join(defaultDirectory, scope);
}

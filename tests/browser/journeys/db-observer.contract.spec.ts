import { spawn } from "node:child_process";
import path from "node:path";

import { expect, test } from "@playwright/test";

test("DB observer refuses every database outside an exact disposable journey scope", async () => {
  const result = await runObserver({
    CLEAN_PAY_BROWSER_DB_SCOPE: "shared-production",
    DATABASE_URL: "postgresql://owner:credential@outside.example:5432/production",
  });
  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain("exact disposable journey project scope");
  expect(result.stderr).not.toContain("credential");

  const productionRole = await runObserver({
    CLEAN_PAY_BROWSER_DB_SCOPE: "clean-pay-browser-journey-contract-observer",
    DATABASE_URL: "postgresql://clean_pay_migration:credential@postgres:5432/clean_pay",
  });
  expect(productionRole.code).not.toBe(0);
  expect(productionRole.stderr).toContain("owned synthetic Compose network");
  expect(productionRole.stderr).not.toContain("credential");
});

function runObserver(environment: Record<string, string>) {
  return new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    let stderr = "";
    const child = spawn(process.execPath, [path.resolve(__dirname, "db-observer.mjs")], {
      cwd: process.cwd(),
      env: { ...process.env, ...environment },
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stderr }));
  });
}

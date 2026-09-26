import { test } from "@playwright/test";
import { createCiV10Cases } from "./ci-v10.cases.mjs";
for (const { name, run } of createCiV10Cases(__dirname)) {
  test(name, async () => { await run(); });
}

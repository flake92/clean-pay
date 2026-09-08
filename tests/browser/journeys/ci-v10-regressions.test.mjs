import test from "node:test";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCiV10Cases } from "./ci-v10.cases.mjs";
for (const { name, run } of createCiV10Cases(dirname(fileURLToPath(import.meta.url)))) {
  test(name, run);
}

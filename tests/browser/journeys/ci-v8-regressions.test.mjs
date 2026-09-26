import test from "node:test";
import { fileURLToPath } from "node:url";
import { createFixtureLifecycleCases } from "./fixture-process-lifecycle.cases.mjs";

const fixtureLifecycleCases = createFixtureLifecycleCases(fileURLToPath(new URL(".", import.meta.url)));
for (const { name, run } of fixtureLifecycleCases) test(name, { timeout: 30_000 }, run);

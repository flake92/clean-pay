import test from "node:test";
import { fixtureLifecycleCases } from "./fixture-process-lifecycle.cases.mjs";

for (const { name, run } of fixtureLifecycleCases) test(name, { timeout: 30_000 }, run);

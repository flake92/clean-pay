import { test } from "@playwright/test";

import { createFixtureLifecycleCases } from "./fixture-process-lifecycle.cases.mjs";

// Native and Playwright entry points run the SAME assertions and real fixtures.
const fixtureLifecycleCases = createFixtureLifecycleCases(__dirname);
for (const { name, run } of fixtureLifecycleCases) {
  test(name, async () => { await run(); });
}

import { test } from "@playwright/test";

import { fixtureLifecycleCases } from "./fixture-process-lifecycle.cases.mjs";

// Native and Playwright entry points run the SAME assertions and real fixtures.
for (const { name, run } of fixtureLifecycleCases) {
  test(name, async () => { await run(); });
}

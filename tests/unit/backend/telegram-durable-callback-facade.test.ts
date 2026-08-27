import { describe, expect, it } from "vitest";

import * as durableCallback from "@/backend/integrations/telegram/durable-callback";

describe("durable Telegram callback facade", () => {
  it("preserves the exact runtime export surface", () => {
    expect(Object.keys(durableCallback).sort()).toEqual([
      "DURABLE_TELEGRAM_CALLBACK_MAX_IN_FLIGHT_MS",
      "DURABLE_TELEGRAM_CALLBACK_RESULT_TTL_MS",
      "DurableTelegramCallbackClaimConflictError",
      "checkpointDurableTelegramIdentity",
      "checkpointDurableTelegramIdentityResolved",
      "checkpointDurableTelegramOutcome",
      "checkpointDurableTelegramProvider",
      "checkpointDurableTelegramRecoveryCommitted",
      "claimDurableTelegramProviderReady",
      "completeDurableTelegramMerge",
      "completeDurableTelegramSession",
      "createDurableTelegramCallbackSession",
      "failDurableTelegramCallback",
      "loadDurableTelegramCallback",
      "markDurableTelegramProviderDispatching",
      "markDurableTelegramRecoveryDispatching",
      "markDurableTelegramRemnashopDispatching",
      "releaseDurableTelegramCallback",
      "runWithDurableTelegramCallbackLease",
    ]);
  });
});

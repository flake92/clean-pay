import { describe, expect, it, vi } from "vitest";

vi.mock("@/backend/database/prisma", () => ({ prisma: {} }));

import * as paymentUserMerge from "@/backend/integrations/payments/payment-user-merge-service";

describe("payment user merge facade", () => {
  it("preserves the exact runtime export surface", () => {
    expect(Object.keys(paymentUserMerge).sort()).toEqual([
      "assertNoActivePaymentDispatches",
      "assertPaymentOwnerChangeFenceHeld",
      "lockPaymentOwnerFence",
      "markPaymentOwnerChangeLocalFinalized",
      "markPaymentOwnerChangeUpstreamMutationStarted",
      "preflightPaymentOperationsForUserMerge",
      "reconcileCompletedPaymentOwnerChange",
      "transferPaymentOperationsForUserMerge",
      "withPaymentOwnerChangeFence",
    ]);
  });
});

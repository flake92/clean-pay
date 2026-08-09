import { describe, expect, it, vi } from "vitest";
import { writeAuditEvent } from "@/application/observability/write-audit-event";

describe("writeAuditEvent", () => {
  it("uses the supplied persistence port", async () => {
    const append = vi.fn(async () => undefined);
    const event = { action: "login", userId: "user-1", severity: "INFO" as const, ipHash: "hash" };
    await writeAuditEvent({ append }, event);
    expect(append).toHaveBeenCalledWith(event);
  });
});

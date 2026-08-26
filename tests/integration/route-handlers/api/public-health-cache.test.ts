import { describe, expect, it } from "vitest";

import { GET as getHealth } from "@/app/api/health/route";
import { GET as getLiveness } from "@/app/api/health/liveness/route";

describe("public health route cache policy", () => {
  it.each([
    ["health", getHealth],
    ["liveness", getLiveness],
  ])("marks %s responses as non-cacheable", async (_name, handler) => {
    const response = await handler();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

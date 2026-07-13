import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("production Docker network startup", () => {
  it("checks and creates the configured Remnawave edge network before compose up", () => {
    const source = readFileSync("start.sh", "utf8");
    const startFunction = source.slice(source.indexOf("start() {"), source.indexOf("verify() {"));

    expect(source).toContain("validate_env");
    expect(source).toContain("env_value REMNASHOP_DOCKER_NETWORK remnawave-network");
    expect(source).toContain('docker network inspect "$network_name"');
    expect(source).toContain('docker network create "$network_name"');
    expect(startFunction.indexOf("ensure_network")).toBeGreaterThanOrEqual(0);
    expect(startFunction.indexOf("compose up -d --build")).toBeGreaterThan(
      startFunction.indexOf("ensure_network"),
    );
  });
});

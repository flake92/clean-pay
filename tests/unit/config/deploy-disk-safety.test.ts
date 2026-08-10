import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const deploy = readFileSync("deploy.sh", "utf8");

describe("deployment disk safety", () => {
  it("checks capacity before Docker starts a build", () => {
    expect(deploy).toContain("env_value CLEAN_PAY_MIN_FREE_DISK_MB 8192");
    expect(deploy.indexOf("ensure_build_disk_space\n  printf 'Building")).toBeGreaterThan(-1);
    expect(deploy.indexOf("ensure_build_disk_space\n  printf 'Building")).toBeLessThan(
      deploy.indexOf("compose up -d --build"),
    );
  });

  it("only removes unused Docker artifacts and rechecks free space", () => {
    expect(deploy).toContain("docker builder prune -af");
    expect(deploy).toContain("docker image prune -f");
    expect(deploy).not.toContain("docker volume prune");
    expect(deploy).not.toContain("docker system prune");
    expect(deploy).toContain("available_kb=$(available_disk_kb)");
  });

  it("cleans stale build artifacts after a successful deployment", () => {
    expect(deploy).toContain("docker builder prune -af --filter until=24h");
    expect(deploy.indexOf("cleanup_build_artifacts\n  verify_external_security_headers")).toBeGreaterThan(
      deploy.indexOf("compose up -d --build"),
    );
    expect(deploy.indexOf("verify_external_security_headers\n  sh")).toBeGreaterThan(
      deploy.indexOf("cleanup_build_artifacts\n  verify_external_security_headers"),
    );
  });
});

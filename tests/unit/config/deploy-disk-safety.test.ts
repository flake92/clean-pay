import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const deploy = readFileSync("deploy.sh", "utf8");
const up = deploy.match(/install_services\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
const prepareImages = deploy.match(/prepare_images\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";

describe("deployment disk safety", () => {
  it("checks capacity before Docker starts a build", () => {
    expect(deploy).toContain("env_value CLEAN_PAY_MIN_FREE_DISK_MB 8192");
    expect(prepareImages.indexOf("ensure_build_disk_space")).toBeGreaterThan(-1);
    expect(prepareImages.indexOf("ensure_build_disk_space")).toBeLessThan(
      prepareImages.indexOf("compose build migration app"),
    );
    const pullBranch = prepareImages.slice(prepareImages.indexOf("pull)"));
    expect(pullBranch).not.toContain("ensure_build_disk_space");
    expect(pullBranch).not.toContain("prune");
    expect(up.indexOf("prepare_images")).toBeLessThan(
      up.indexOf("start_verified_runtimes"),
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
    expect(up.indexOf("cleanup_build_artifacts")).toBeGreaterThan(
      up.indexOf("start_verified_runtimes"),
    );
    expect(up.indexOf("verify_detailed_readiness")).toBeGreaterThan(
      up.indexOf("cleanup_build_artifacts"),
    );
    expect(up.indexOf("verify_external_security_headers")).toBeGreaterThan(
      up.indexOf("verify_detailed_readiness"),
    );
  });
});

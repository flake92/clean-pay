import { describe, expect, it } from "vitest";

import { verifyRehearsalMigrationImageInspection } from "../../../scripts/security/verify-rehearsal-migration-image.mjs";

const imageReference = `registry.example/clean-pay-migration@sha256:${"1".repeat(64)}`;
const imageId = `sha256:${"2".repeat(64)}`;
const expected = {
  imageId,
  imageReference,
  publicBuildContractSha256: "3".repeat(64),
  publicBuildContractVersion: "1",
  release: "candidate-final",
  revision: "4".repeat(40),
};

function exactInspection() {
  return [{
    Id: imageId,
    RepoDigests: [imageReference],
    Config: {
      Labels: {
        "io.clean-pay.public-build-contract-sha256": expected.publicBuildContractSha256,
        "io.clean-pay.public-build-contract-version": expected.publicBuildContractVersion,
        "io.clean-pay.release": expected.release,
        "io.clean-pay.role": "migration",
        "org.opencontainers.image.revision": expected.revision,
        "org.opencontainers.image.version": expected.release,
      },
    },
  }];
}

describe("migration rehearsal exact-image contract", () => {
  it("binds one digest-pinned caller reference to its local ID and complete OCI identity", () => {
    expect(verifyRehearsalMigrationImageInspection(exactInspection(), expected)).toEqual({
      imageId,
      imageReference,
      publicBuildContractSha256: expected.publicBuildContractSha256,
      publicBuildContractVersion: expected.publicBuildContractVersion,
      release: expected.release,
      revision: expected.revision,
    });
  });

  it("fails closed for every identity, role, release and public-contract near miss", () => {
    const mutations: Array<(inspection: ReturnType<typeof exactInspection>) => void> = [
      (inspection) => { inspection[0]!.Id = `sha256:${"5".repeat(64)}`; },
      (inspection) => { inspection[0]!.RepoDigests = []; },
      (inspection) => { inspection[0]!.Config.Labels["io.clean-pay.role"] = "app"; },
      (inspection) => {
        inspection[0]!.Config.Labels["org.opencontainers.image.revision"] = "6".repeat(40);
      },
      (inspection) => {
        inspection[0]!.Config.Labels["org.opencontainers.image.version"] = "other-release";
      },
      (inspection) => {
        inspection[0]!.Config.Labels["io.clean-pay.release"] = "other-release";
      },
      (inspection) => {
        inspection[0]!.Config.Labels["io.clean-pay.public-build-contract-version"] = "2";
      },
      (inspection) => {
        inspection[0]!.Config.Labels["io.clean-pay.public-build-contract-sha256"] = "7".repeat(64);
      },
    ];

    for (const mutate of mutations) {
      const inspection = exactInspection();
      mutate(inspection);
      expect(() => verifyRehearsalMigrationImageInspection(inspection, expected)).toThrow();
    }
  });

  it("rejects mutable references, malformed expected values and ambiguous inspections", () => {
    expect(() => verifyRehearsalMigrationImageInspection(exactInspection(), {
      ...expected,
      imageReference: "registry.example/clean-pay-migration:candidate-final",
    })).toThrow(/digest-pinned/u);
    expect(() => verifyRehearsalMigrationImageInspection(exactInspection(), {
      ...expected,
      imageReference: `registry.example/clean-pay-migration:tag@sha256:${"1".repeat(64)}`,
    })).toThrow(/valid image repository/u);
    expect(() => verifyRehearsalMigrationImageInspection(exactInspection(), {
      ...expected,
      imageId: "sha256:short",
    })).toThrow(/image ID/u);
    expect(() => verifyRehearsalMigrationImageInspection(exactInspection(), {
      ...expected,
      revision: "4".repeat(39),
    })).toThrow(/revision/u);
    expect(() => verifyRehearsalMigrationImageInspection([], expected)).toThrow(/exactly one/u);
    expect(() => verifyRehearsalMigrationImageInspection([
      ...exactInspection(),
      ...exactInspection(),
    ], expected)).toThrow(/exactly one/u);
  });
});

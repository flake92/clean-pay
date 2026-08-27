import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

function jobSource(name: string, nextName: string): string {
  const start = workflow.indexOf(`  ${name}:\n`);
  const end = workflow.indexOf(`  ${nextName}:\n`, start + 1);

  expect(start, `${name} job`).toBeGreaterThanOrEqual(0);
  expect(end, `${nextName} job`).toBeGreaterThan(start);
  return workflow.slice(start, end);
}

describe("CI static-analysis boundary", () => {
  it("runs each static analyzer from its exact reviewed image index", () => {
    const job = jobSource("static-analysis", "dependency-review");

    expect(job).toContain(
      "koalaman/shellcheck-alpine:v0.11.0@sha256:9955be09ea7f0dbf7ae942ac1f2094355bb30d96fffba0ec09f5432207544002",
    );
    expect(job).toContain(
      "hadolint/hadolint:v2.14.0-alpine@sha256:7aba693c1442eb31c0b015c129697cb3b6cb7da589d85c7562f9deb435a6657c",
    );
    expect(job).toContain(
      "rhysd/actionlint:1.7.7@sha256:887a259a5a534f3c4f36cb02dca341673c6089431057242cdc931e9f133147e9",
    );
    expect(job).toContain("git ls-files -z -- '*.sh'");
    expect(job).toContain(
      '"$HADOLINT_IMAGE" Dockerfile .devcontainer/Dockerfile',
    );
    expect(job).toContain('"$SHELLCHECK_IMAGE" "${shell_files[@]}"');
    expect(job).toContain('"$ACTIONLINT_IMAGE" -no-color');
    expect(job).not.toContain("-shellcheck=");
    expect(job.match(/--network none/gu)).toHaveLength(3);
    expect(job.match(/--read-only/gu)).toHaveLength(3);
    expect(job.match(/--cap-drop ALL/gu)).toHaveLength(3);
    expect(job.match(/no-new-privileges:true/gu)).toHaveLength(3);
  });

  it("reviews dependency changes only for pull requests with read-only access", () => {
    const job = jobSource("dependency-review", "validate");

    expect(job).toContain("if: github.event_name == 'pull_request'");
    expect(job).toContain("permissions:\n      contents: read");
    expect(job).not.toMatch(/^\s+[a-z-]+: write$/mu);
    expect(job).toContain("persist-credentials: false");
    expect(job).toContain(
      "actions/dependency-review-action@2031cfc080254a8a887f58cffee85186f0e49e48 # v4.9.0",
    );
  });

  it("keeps apt lint exceptions local and preserves pipe failure semantics", () => {
    const production = readFileSync("Dockerfile", "utf8");
    const development = readFileSync(".devcontainer/Dockerfile", "utf8");
    const combined = `${production}\n${development}`;

    expect(combined.match(/# hadolint ignore=DL3008/gu)).toHaveLength(3);
    expect(combined).not.toMatch(/# hadolint (?:global )?ignore=(?!DL3008)/u);
    expect(development).toContain('SHELL ["/bin/bash", "-o", "pipefail", "-c"]');
    expect(production.match(/digest-pinned Debian base/gu)).toHaveLength(2);
    expect(development).toContain("never copied into production images");
  });
});

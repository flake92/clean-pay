import { expect, test } from "@playwright/test";

import { projectCharacterizationManifestPairForComparison } from "./comparison-projection";
import {
  PINNED_JOURNEY_V5_FIXTURE_SHA256,
  currentJourneyFixtureContractSha256,
} from "./journeys/journey-fixture-contract";
import { digestValue } from "./redaction";

const WINDOWS_PLATFORM = '"Windows"';
const LINUX_PLATFORM = '"Linux"';
const WINDOWS_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/151.0.7922.34 Safari/537.36";
const LINUX_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/151.0.7922.34 Safari/537.36";

test("projects only the pinned Windows baseline to pinned Linux Chromium transport identity", () => {
  const baseline = publicManifest(WINDOWS_PLATFORM, WINDOWS_USER_AGENT);
  const candidate = publicManifest(LINUX_PLATFORM, LINUX_USER_AGENT);
  const baselineBefore = structuredClone(baseline);
  const candidateBefore = structuredClone(candidate);

  const projected = projectCharacterizationManifestPairForComparison(
    baseline,
    candidate,
  );

  expect(projected.actual).toEqual(projected.expected);
  expect(requestHeaders(projected.actual)).toEqual(
    requestHeaders(projected.expected),
  );
  expect(baseline).toEqual(baselineBefore);
  expect(candidate).toEqual(candidateBefore);
});

test("keeps an already pinned Windows candidate byte-exact", () => {
  const baseline = publicManifest(WINDOWS_PLATFORM, WINDOWS_USER_AGENT);
  const candidate = publicManifest(WINDOWS_PLATFORM, WINDOWS_USER_AGENT);

  const projected = projectCharacterizationManifestPairForComparison(
    baseline,
    candidate,
  );

  expect(projected.actual).toEqual(projected.expected);
  expect(requestHeaders(projected.actual)).toEqual(requestHeaders(candidate));
});

test("applies the same exact transport projection to the pinned journey envelope", () => {
  const baseline = journeyManifest(
    "baseline",
    PINNED_JOURNEY_V5_FIXTURE_SHA256,
    WINDOWS_PLATFORM,
    WINDOWS_USER_AGENT,
  );
  const candidate = journeyManifest(
    "candidate",
    currentJourneyFixtureContractSha256(),
    LINUX_PLATFORM,
    LINUX_USER_AGENT,
  );

  const projected = projectCharacterizationManifestPairForComparison(
    baseline,
    candidate,
  );

  expect(projected.actual).toEqual(projected.expected);
});

test("rejects transport identity near misses atomically", () => {
  const cases: Array<{
    label: string;
    mutateBaseline?: (value: ReturnType<typeof publicManifest>) => void;
    mutateCandidate?: (value: ReturnType<typeof publicManifest>) => void;
  }> = [
    {
      label: "unknown candidate platform",
      mutateCandidate: (value) => {
        header(value, "sec-ch-ua-platform").value = digestValue('"macOS"');
      },
    },
    {
      label: "unknown candidate user agent keeps the valid platform unprojected",
      mutateCandidate: (value) => {
        header(value, "user-agent").value = digestValue("unreviewed-linux-browser");
      },
    },
    {
      label: "duplicate candidate identity header",
      mutateCandidate: (value) => {
        requestHeaders(value).splice(
          1,
          0,
          structuredClone(requestHeaders(value)[0]!),
        );
      },
    },
    {
      label: "identity header order changed",
      mutateCandidate: (value) => {
        requestHeaders(value).reverse();
      },
    },
    {
      label: "identity header has an adjacent field",
      mutateCandidate: (value) => {
        Object.assign(header(value, "user-agent"), { source: "fixture" });
      },
    },
    {
      label: "reverse Linux baseline to Windows candidate",
      mutateBaseline: (value) => {
        header(value, "sec-ch-ua-platform").value = digestValue(LINUX_PLATFORM);
        header(value, "user-agent").value = digestValue(LINUX_USER_AGENT);
      },
      mutateCandidate: (value) => {
        header(value, "sec-ch-ua-platform").value = digestValue(WINDOWS_PLATFORM);
        header(value, "user-agent").value = digestValue(WINDOWS_USER_AGENT);
      },
    },
    {
      label: "request index changed",
      mutateCandidate: (value) => {
        value.network.requests[0]!.index = 1;
      },
    },
    {
      label: "route changed",
      mutateCandidate: (value) => {
        value.route.id = "register";
      },
    },
  ];

  for (const nearMiss of cases) {
    const baseline = publicManifest(WINDOWS_PLATFORM, WINDOWS_USER_AGENT);
    const candidate = publicManifest(LINUX_PLATFORM, LINUX_USER_AGENT);
    nearMiss.mutateBaseline?.(baseline);
    nearMiss.mutateCandidate?.(candidate);
    const candidatePlatformBefore = structuredClone(
      header(candidate, "sec-ch-ua-platform").value,
    );

    const projected = projectCharacterizationManifestPairForComparison(
      baseline,
      candidate,
    );

    expect(projected.actual, nearMiss.label).not.toEqual(projected.expected);
    expect(
      header(projected.actual as ReturnType<typeof publicManifest>, "sec-ch-ua-platform").value,
      `${nearMiss.label}: atomic candidate projection`,
    ).toEqual(candidatePlatformBefore);
  }
});

function publicManifest(platform: string, userAgent: string) {
  return {
    schemaVersion: 1,
    baselineCommit: "f5cb6f543d85256e7733a1ade6a4f451d86cf378",
    project: "chromium-390x844",
    route: {
      id: "login",
      kind: "public",
      requested: applicationUrl("/login"),
      final: applicationUrl("/login"),
      redirects: [],
      finalStatus: 200,
    },
    network: network(platform, userAgent),
  };
}

function journeyManifest(
  seed: "baseline" | "candidate",
  fixtureContractSha256: string,
  platform: string,
  userAgent: string,
) {
  return {
    schemaVersion: 2,
    baselineCommit: "f5cb6f543d85256e7733a1ade6a4f451d86cf378",
    project: "journey-390x844",
    journey: "transport-identity-contract",
    source: {
      revision: seed === "baseline"
        ? "f5cb6f543d85256e7733a1ade6a4f451d86cf378"
        : "1".repeat(40),
      imageDigest: `sha256:${(seed === "baseline" ? "2" : "3").repeat(64)}`,
      imageTag: `clean-pay:${seed}`,
      migrationImageDigest: `sha256:${(seed === "baseline" ? "4" : "5").repeat(64)}`,
      migrationImageTag: `clean-pay-migration:${seed}`,
      publicBuildContract: { version: "1", sha256: "6".repeat(64) },
      fixtureContract: {
        version: "journey-v5",
        sha256: fixtureContractSha256,
      },
      browser: { name: "chromium", version: "151.0.7922.34" },
    },
    network: network(platform, userAgent),
  };
}

function network(platform: string, userAgent: string) {
  return {
    requests: [{
      index: 0,
      method: "GET",
      url: applicationUrl("/login"),
      scope: "application",
      resourceType: "document",
      navigation: true,
      serverAction: { present: false, identifier: null },
      requestHeaders: [
        { name: "sec-ch-ua-platform", value: digestValue(platform) },
        { name: "user-agent", value: digestValue(userAgent) },
      ],
      postData: null,
      redirectedFrom: null,
      response: null,
      failure: null,
      externalTransport: null,
    }],
    serverActionCount: 0,
    serverActions: [],
  };
}

function applicationUrl(pathname: string) {
  return { origin: "<app-origin>", pathname, query: [], fragment: null };
}

function requestHeaders(value: ReturnType<typeof publicManifest> | unknown) {
  return (value as ReturnType<typeof publicManifest>).network.requests[0]!
    .requestHeaders;
}

function header(value: ReturnType<typeof publicManifest> | unknown, name: string) {
  const found = requestHeaders(value).find((entry) => entry.name === name);
  if (!found) throw new Error(`Missing ${name} header.`);
  return found as { name: string; value: unknown; source?: string };
}

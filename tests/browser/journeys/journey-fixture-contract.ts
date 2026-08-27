import {
  currentJourneyFixtureContractSha256 as currentFixtureContractSha256,
  currentJourneyFixtureContractSha256Async as currentFixtureContractSha256Async,
} from "./journey-fixture-manifest.mjs";

export const PINNED_JOURNEY_V5_FIXTURE_SHA256 = "7b62f993647d20582018297505f8557d201962a9bd768a5438dd3b8fa06cb5f9";

export function currentJourneyFixtureContractSha256() {
  return currentFixtureContractSha256();
}

export function currentJourneyFixtureContractSha256Async() {
  return currentFixtureContractSha256Async();
}

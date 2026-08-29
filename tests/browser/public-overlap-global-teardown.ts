import {
  requirePublicOverlapEnvironment,
  sealExactCapture,
} from "./public-overlap-evidence";

export default async function publicOverlapGlobalTeardown() {
  const environment = requirePublicOverlapEnvironment();
  await sealExactCapture(environment);
}

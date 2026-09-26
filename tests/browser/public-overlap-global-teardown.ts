import {
  requirePublicOverlapEnvironment,
  requirePublicOverlapPairEnvironment,
  sealExactCapture,
} from "./public-overlap-evidence";

export default async function publicOverlapGlobalTeardown() {
  if (process.env.CLEAN_PAY_PUBLIC_OVERLAP_ROLE === "pair") {
    const environment = requirePublicOverlapPairEnvironment();
    const settlements = await Promise.allSettled(
      (["baseline", "candidate"] as const).map((role) => sealExactCapture(
        environment.roles[role],
      )),
    );
    const failures = settlements.flatMap((result) => (
      result.status === "rejected" ? [result.reason] : []
    ));
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(
        failures,
        "Both paired public overlap role seals failed.",
      );
    }
    return;
  }
  const environment = requirePublicOverlapEnvironment();
  await sealExactCapture(environment);
}

import { authenticatedJourneyLivePairCaptureEnabled } from "./authenticated-journey-capture-mode";
import { sealJourneyLivePairCapture } from "./journey-live-pair-evidence";

export default async function journeyGlobalTeardown() {
  if (!authenticatedJourneyLivePairCaptureEnabled(process.env)) return;
  await sealJourneyLivePairCapture();
}

import {
  JOURNEY_SYNTHETIC_HOSTNAMES,
  JOURNEY_SYNTHETIC_TLS_POLICY,
  assertJourneyBrowserPolicy as assertRuntimeJourneyBrowserPolicy,
  isJourneyBrowserRequestAllowed as isRuntimeJourneyBrowserRequestAllowed,
  journeyChromiumLaunchArgs as runtimeJourneyChromiumLaunchArgs,
  journeyConnectProxy as runtimeJourneyConnectProxy,
  journeyProvenanceLaunchArgs as runtimeJourneyProvenanceLaunchArgs,
} from "./journey-browser-policy.mjs";

export { JOURNEY_SYNTHETIC_HOSTNAMES, JOURNEY_SYNTHETIC_TLS_POLICY };

export type JourneyRendererPolicy = "canonical" | "live-overlap";

export function journeyConnectProxy(server: string | undefined) {
  return runtimeJourneyConnectProxy(server) as Readonly<{
    server: string;
    bypass: "<-loopback>";
  }>;
}

export function journeyChromiumLaunchArgs(
  resolverIp: string | undefined,
  rendererPolicy: JourneyRendererPolicy = "canonical",
) {
  return runtimeJourneyChromiumLaunchArgs(resolverIp, rendererPolicy) as string[];
}

export function journeyProvenanceLaunchArgs(
  rendererPolicy: JourneyRendererPolicy = "canonical",
) {
  return runtimeJourneyProvenanceLaunchArgs(rendererPolicy) as string[];
}

export function assertJourneyBrowserPolicy(value: {
  resolverIp?: string;
  launchArgs?: readonly string[];
  syntheticHostnames?: readonly string[];
  tlsPolicy?: Readonly<Record<string, string>>;
}, rendererPolicy: JourneyRendererPolicy = "canonical") {
  assertRuntimeJourneyBrowserPolicy(value, rendererPolicy);
}

export function isJourneyBrowserRequestAllowed(rawUrl: string) {
  return isRuntimeJourneyBrowserRequestAllowed(rawUrl);
}

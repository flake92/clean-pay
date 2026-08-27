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

export function journeyConnectProxy(server: string | undefined) {
  return runtimeJourneyConnectProxy(server) as Readonly<{
    server: string;
    bypass: "<-loopback>";
  }>;
}

export function journeyChromiumLaunchArgs(resolverIp: string | undefined) {
  return runtimeJourneyChromiumLaunchArgs(resolverIp) as string[];
}

export function journeyProvenanceLaunchArgs() {
  return runtimeJourneyProvenanceLaunchArgs() as string[];
}

export function assertJourneyBrowserPolicy(value: {
  resolverIp?: string;
  launchArgs?: readonly string[];
  syntheticHostnames?: readonly string[];
  tlsPolicy?: Readonly<Record<string, string>>;
}) {
  assertRuntimeJourneyBrowserPolicy(value);
}

export function isJourneyBrowserRequestAllowed(rawUrl: string) {
  return isRuntimeJourneyBrowserRequestAllowed(rawUrl);
}

import { DETERMINISTIC_CHROMIUM_LAUNCH_ARGS } from "../render-policy.mjs";
import { JOURNEY_SYNTHETIC_HOSTNAMES } from "./journey-network-policy.mjs";

export { JOURNEY_SYNTHETIC_HOSTNAMES } from "./journey-network-policy.mjs";

export const JOURNEY_SYNTHETIC_TLS_POLICY = Object.freeze({
  connectProxy: "loopback-only-exact-host-connect-443",
  mode: "ignore-ephemeral-caddy-ca-errors",
  scope: "isolated-synthetic-hostnames",
  unexpectedDns: "fail-closed",
});

export function journeyConnectProxy(server) {
  const value = server?.trim();
  if (!value || !/^http:\/\/127\.0\.0\.1:(?:[1-9]\d{3,4})$/.test(value)) {
    throw new Error("Journey CONNECT proxy must be an explicit loopback HTTP endpoint.");
  }
  const port = Number(new URL(value).port);
  if (port > 65_535 || port === 443) {
    throw new Error("Journey CONNECT proxy port is invalid.");
  }
  return Object.freeze({ server: value, bypass: "<-loopback>" });
}

export function journeyChromiumLaunchArgs(resolverIp) {
  const target = assertResolverIp(resolverIp);
  return [
    ...DETERMINISTIC_CHROMIUM_LAUNCH_ARGS,
    "--ignore-certificate-errors",
    hostResolverRule(target),
  ];
}

export function journeyProvenanceLaunchArgs() {
  return [
    ...DETERMINISTIC_CHROMIUM_LAUNCH_ARGS,
    "--ignore-certificate-errors",
    hostResolverRule("<isolated-loopback>"),
  ];
}

export function assertJourneyBrowserPolicy(value) {
  const resolverIp = assertResolverIp(value.resolverIp);
  if (!exactArray(value.launchArgs, journeyChromiumLaunchArgs(resolverIp))) {
    throw new Error("Journey Chromium launch arguments do not match the exact synthetic TLS policy.");
  }
  if (value.launchArgs?.some((entry) => entry.startsWith("--proxy-bypass-list="))) {
    throw new Error("Journey Chromium policy forbids proxy bypass-list expansion.");
  }
  if (!exactArray(value.syntheticHostnames, JOURNEY_SYNTHETIC_HOSTNAMES)) {
    throw new Error("Journey synthetic hostname allowlist does not match the exact policy.");
  }
  if (JSON.stringify(value.tlsPolicy) !== JSON.stringify(JOURNEY_SYNTHETIC_TLS_POLICY)) {
    throw new Error("Journey synthetic TLS policy metadata does not match the exact policy.");
  }
}

export function isJourneyBrowserRequestAllowed(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol === "about:" || url.protocol === "blob:" || url.protocol === "data:") {
    return true;
  }
  return url.protocol === "https:"
    && url.port === ""
    && !url.username
    && !url.password
    && JOURNEY_SYNTHETIC_HOSTNAMES.includes(url.hostname);
}

function hostResolverRule(target) {
  return `--host-resolver-rules=MAP ${JOURNEY_SYNTHETIC_HOSTNAMES.join(
    ` ${target}, MAP `,
  )} ${target}, EXCLUDE 127.0.0.1, MAP * ~NOTFOUND`;
}

function assertResolverIp(value) {
  const resolverIp = value?.trim();
  if (!resolverIp || !/^127\.0\.0\.(?:[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])$/.test(resolverIp)) {
    throw new Error("Journey resolver must be an explicit isolated IPv4 loopback address.");
  }
  return resolverIp;
}

function exactArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((entry, index) => entry === expected[index]);
}

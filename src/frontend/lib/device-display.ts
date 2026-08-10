import type { SubscriptionDevice } from "@/shared/domain/subscriptions";

export const MISSING_DEVICE_VALUE = "—";

const MAX_DEVICE_FIELD_LENGTH = 80;
const MAX_USER_AGENT_LENGTH = 512;

const GENERIC_CLIENT_NAMES = new Set([
  "android",
  "applewebkit",
  "cfnetwork",
  "dalvik",
  "darwin",
  "ios",
  "linux",
  "macos",
  "mozilla",
  "okhttp",
  "windows",
]);

const TECHNICAL_DEVICE_MODEL_PATTERNS = [
  /^(?:(?:byte|generic)[-_ ]*)?(?:aarch64|amd64|arm64|armeabi(?:-v7a)?|armv[5-9](?:l)?|i[3-6]86|ia32|x64|x86(?:_64)?)(?:[-_ ].*)?$/iu,
  /^sdk[-_ ]*gphone(?:64)?(?:[-_ ]*(?:aarch64|arm64|x86(?:_64)?))?$/iu,
  /^android sdk built for (?:aarch64|arm64|x86(?:_64)?)$/iu,
];

const EMPTY_DEVICE_VALUE =
  /^(?:-|–|—|device|generic|n\/a|none|not available|null|undefined|unknown|unknown device)$/iu;

function isTechnicalDeviceModel(value: string) {
  return TECHNICAL_DEVICE_MODEL_PATTERNS.some((pattern) => pattern.test(value));
}

function cleanTelemetry(value: string | null | undefined, maxLength = MAX_DEVICE_FIELD_LENGTH) {
  if (!value) {
    return null;
  }

  const cleaned = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/\p{Cf}/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength)
    .trim();

  if (!cleaned || EMPTY_DEVICE_VALUE.test(cleaned)) {
    return null;
  }

  return cleaned;
}

function platformLabel(value: string | null | undefined) {
  const cleaned = cleanTelemetry(value);
  if (!cleaned || isTechnicalDeviceModel(cleaned)) {
    return null;
  }

  const normalized = cleaned.toLowerCase().replace(/[\s_-]+/gu, "");

  if (normalized === "ipados") {
    return "iPadOS";
  }

  if (normalized === "ios" || normalized === "iphoneos") {
    return "iOS";
  }

  if (normalized === "android") {
    return "Android";
  }

  if (normalized === "windows" || normalized === "win32" || normalized === "win64") {
    return "Windows";
  }

  if (normalized === "macos" || normalized === "macosx" || normalized === "osx") {
    return "macOS";
  }

  if (normalized === "linux") {
    return "Linux";
  }

  return cleaned;
}

function inferPlatform(userAgent: string | null | undefined) {
  const value = cleanTelemetry(userAgent, MAX_USER_AGENT_LENGTH);
  if (!value) {
    return null;
  }
  const searchableValue = value.replace(/_/gu, " ");

  if (/\b(?:iphone|ipad|ipod|ios)\b/iu.test(searchableValue)) {
    return "iOS";
  }

  if (/\bandroid\b/iu.test(searchableValue)) {
    return "Android";
  }

  if (/\bwindows\b/iu.test(searchableValue)) {
    return "Windows";
  }

  if (/\b(?:macintosh|macos|mac os x)\b/iu.test(searchableValue)) {
    return "macOS";
  }

  if (/\blinux\b/iu.test(searchableValue)) {
    return "Linux";
  }

  return null;
}

function deviceTypeFromPlatform(platform: string, userAgent: string | null | undefined) {
  if (platform === "iOS") {
    const value = (
      cleanTelemetry(userAgent, MAX_USER_AGENT_LENGTH) ?? ""
    ).replace(/_/gu, " ");

    if (/\biphone\b/iu.test(value)) {
      return "iPhone";
    }

    if (/\bipad\b/iu.test(value)) {
      return "iPad";
    }

    if (/\bipod\b/iu.test(value)) {
      return "iPod";
    }

    return platform;
  }

  return platform;
}

function formatDeviceType(device: SubscriptionDevice, platform: string | null) {
  const model = cleanTelemetry(device.device_model);

  if (model && !isTechnicalDeviceModel(model)) {
    return model;
  }

  return platform
    ? deviceTypeFromPlatform(platform, device.user_agent)
    : MISSING_DEVICE_VALUE;
}

function formatOperatingSystem(
  platform: string | null,
  osVersion: string | null | undefined,
) {
  const version = cleanTelemetry(osVersion);

  if (!platform) {
    return version ?? MISSING_DEVICE_VALUE;
  }

  if (!version) {
    return platform;
  }

  if (version.toLowerCase().startsWith(platform.toLowerCase())) {
    return version;
  }

  return `${platform} ${version}`;
}

function formatClient(userAgent: string | null | undefined) {
  const value = cleanTelemetry(userAgent, MAX_USER_AGENT_LENGTH);
  if (!value) {
    return MISSING_DEVICE_VALUE;
  }

  const spaceVersionMatch = value.match(
    /^([\p{L}][\p{L}\p{N}._+-]*)\s+[vV]?(\d[\p{L}\p{N}._+-]*)(?=[/\s(]|$)/u,
  );
  if (spaceVersionMatch) {
    const [, rawName, rawVersion] = spaceVersionMatch;
    const name = cleanTelemetry(rawName, 32);
    const version = cleanTelemetry(rawVersion, 32);

    if (
      name &&
      version &&
      !GENERIC_CLIENT_NAMES.has(name.toLowerCase())
    ) {
      return `${name} ${version}`;
    }
  }

  const separatorIndex = value.indexOf("/");
  const rawName = separatorIndex >= 0 ? value.slice(0, separatorIndex) : value;
  const name = cleanTelemetry(rawName, 32);

  if (
    !name ||
    !/^[\p{L}][\p{L}\p{N} ._+-]*$/u.test(name) ||
    GENERIC_CLIENT_NAMES.has(name.toLowerCase())
  ) {
    return MISSING_DEVICE_VALUE;
  }

  if (separatorIndex < 0) {
    return /^[\p{L}][\p{L}\p{N}._+-]*$/u.test(name)
      ? name
      : MISSING_DEVICE_VALUE;
  }

  const rawVersion = value.slice(separatorIndex + 1).split(/[\/\s(]/u, 1)[0] ?? "";
  const version = cleanTelemetry(rawVersion, 32)?.replace(/^[vV](?=\d)/u, "") ?? null;

  if (!version || !/^\d[\p{L}\p{N}._+-]*$/u.test(version)) {
    return name;
  }

  return `${name} ${version}`;
}

export type DevicePresentation = {
  deviceType: string;
  os: string;
  client: string;
  summary: string;
};

export function formatSubscriptionDevice(device: SubscriptionDevice): DevicePresentation {
  const platform = platformLabel(device.platform) ?? inferPlatform(device.user_agent);
  const deviceType = formatDeviceType(device, platform);
  const client = formatClient(device.user_agent);
  const summaryParts = [deviceType, client].filter(
    (value) => value !== MISSING_DEVICE_VALUE,
  );

  return {
    deviceType,
    os: formatOperatingSystem(platform, device.os_version),
    client,
    summary: summaryParts.join(" ") || MISSING_DEVICE_VALUE,
  };
}

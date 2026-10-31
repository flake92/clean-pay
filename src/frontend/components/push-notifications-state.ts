export type PushCardStatus =
  | "hidden"
  | "loading"
  | "unsupported"
  | "ios-install"
  | "denied"
  | "off"
  | "on";

export type PushEnvironment = {
  serverAvailable: boolean;
  pushSupported: boolean;
  appleMobile: boolean;
  standalone: boolean;
  permission: "default" | "granted" | "denied" | null;
};

// iOS and iPadOS deliver Web Push only to a site added to the Home Screen
// (16.4+); in Safari itself PushManager is missing, so explain how to install.
export function pushCardStatus(
  env: PushEnvironment,
  setup: { loaded: boolean; subscribed: boolean },
): PushCardStatus {
  if (!env.serverAvailable) return "hidden";
  if (env.appleMobile && !env.standalone) return "ios-install";
  if (!env.pushSupported) return "unsupported";
  if (env.permission === "denied") return "denied";
  if (!setup.loaded) return "loading";
  return setup.subscribed ? "on" : "off";
}

// Browsers show the permission prompt only inside a click. A link within the
// cabinet keeps the page alive; "Pay" and "Log out" leave it, which would hide
// the prompt, and Chrome counts that as a refusal.
export function isPushPromptClick(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  const link = target.closest('a[href^="/"]');
  return link !== null
    && !link.closest(".push-reminder")
    && !link.getAttribute("href")?.startsWith("//")
    && link.getAttribute("target") !== "_blank";
}

export function applicationServerKey(base64url: string): Uint8Array {
  const padded = base64url + "=".repeat((4 - (base64url.length % 4)) % 4);
  const binary = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function sameServerKey(current: ArrayBuffer | null | undefined, expected: Uint8Array) {
  if (!current) return true;
  const actual = new Uint8Array(current);
  return actual.length === expected.length && actual.every((byte, index) => byte === expected[index]);
}

import { TURNSTILE_SCRIPT_URL } from "./turnstile-stub";

export type CharacterizationRequestPolicyInput = {
  applicationOrigin: string;
  headers: Readonly<Record<string, string | undefined>>;
  method: string;
  resourceType: string;
  url: string;
};

/** Allows only same-origin GETs and the exact credential-free stubbed script. */
export function permitsCharacterizationReplayRequest(
  request: CharacterizationRequestPolicyInput,
) {
  if (
    request.method !== "GET"
    || typeof request.headers["next-action"] === "string"
  ) {
    return false;
  }
  let origin: string;
  try {
    origin = new URL(request.url).origin;
  } catch {
    return false;
  }
  if (origin === request.applicationOrigin) return true;
  return request.url === TURNSTILE_SCRIPT_URL
    && request.resourceType === "script"
    && !["authorization", "cookie", "proxy-authorization"].some(
      (name) => typeof request.headers[name] === "string",
    );
}

const BOUNDARY_LABELS = new Set([
  "chatwoot-authenticated",
  "chatwoot-guest",
  "keyboard-first-tab",
  "passkey-virtual-authenticator",
  "passkey-webauthn-operations",
  "payment-idempotency-fencing",
  "pwa-install",
  "pwa-ios-pristine-csp-client-boundary",
  "pwa-service-worker-offline",
  "referral-browser-apis",
  "telegram-account-merge",
  "telegram-oidc-cookie-lifecycle",
  "telegram-webapp",
  "turnstile-lifecycle",
]);

/**
 * Keeps browser-boundary evidence useful without allowing arbitrary page data
 * into immutable artifacts. Every accepted label has a narrow, PII-free
 * structural contract; unknown labels and near-miss fields fail closed.
 */
export function sanitizeJourneyBoundary(label: string, value: unknown) {
  if (!BOUNDARY_LABELS.has(label)) {
    throw new Error(`Unknown journey boundary label: ${JSON.stringify(label)}.`);
  }
  const valid = label === "chatwoot-authenticated" ? validChatwootCalls(value, true)
    : label === "chatwoot-guest" ? validChatwootCalls(value, false)
      : label === "keyboard-first-tab" ? validFocusedControl(value)
        : label === "passkey-virtual-authenticator" ? validVirtualAuthenticator(value)
          : label === "passkey-webauthn-operations" ? validWebAuthnOperations(value)
            : label === "payment-idempotency-fencing" ? validPaymentFencing(value)
              : label === "pwa-install" ? validExactStringArray(value, [
                  "preventDefault", "prompt", "userChoice", "appinstalled",
                ])
                : label === "pwa-ios-pristine-csp-client-boundary" ? validIosCspBoundary(value)
                  : label === "pwa-service-worker-offline" ? validServiceWorkerBoundary(value)
                    : label === "referral-browser-apis" ? validReferralCalls(value)
                      : label === "telegram-account-merge" ? validTelegramMerge(value)
                        : label === "telegram-oidc-cookie-lifecycle" ? validOidcLifecycle(value)
                          : label === "telegram-webapp" ? validExactStringArray(value, ["ready", "expand"])
                            : validTurnstileCalls(value);
  if (!valid) {
    throw new Error(`Journey boundary ${label} violates its exact sanitized schema.`);
  }
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function validChatwootCalls(value: unknown, authenticated: boolean) {
  if (!Array.isArray(value)) return false;
  if (!authenticated) return value.length === 0;
  const calls = value.every((entry) => {
    if (!isRecord(entry) || typeof entry.method !== "string") return false;
    if (entry.method === "run") {
      return exactKeys(entry, ["baseUrl", "method", "websiteTokenBytes"])
        && entry.baseUrl === "https://chatwoot.browser.clean-pay.dev"
        && entry.websiteTokenBytes === 64;
    }
    if (["frame.loaded", "identity.confirmed", "reset"].includes(entry.method)) {
      return exactKeys(entry, ["method"]);
    }
    if (entry.method === "setUser") {
      return exactKeys(entry, ["attributeKeys", "identifierBytes", "method"])
        && Number.isSafeInteger(entry.identifierBytes)
        && Number(entry.identifierBytes) >= 20
        && Number(entry.identifierBytes) <= 80
        && Array.isArray(entry.attributeKeys)
        && entry.attributeKeys.length >= 3
        && entry.attributeKeys.every((key) => [
          "custom_attributes", "email", "identifier_hash", "name",
        ].includes(String(key)));
    }
    if (entry.method === "setCustomAttributes") {
      return exactKeys(entry, ["attributeKeys", "method"])
        && safeNameArray(entry.attributeKeys);
    }
    if (entry.method === "toggleBubbleVisibility") {
      return exactKeys(entry, ["method", "value"])
        && ["hide", "show"].includes(String(entry.value));
    }
    if (entry.method === "toggle") {
      return exactKeys(entry, ["method", "value"])
        && typeof entry.value === "boolean";
    }
    if (["setLabel", "removeLabel"].includes(entry.method)) {
      return exactKeys(entry, ["label", "method"])
        && ["payment_problem", "subscription_expired"].includes(String(entry.label));
    }
    return false;
  });
  return calls
    && value.some((entry) => isRecord(entry) && entry.method === "setUser")
    && value.some((entry) => isRecord(entry) && entry.method === "identity.confirmed");
}

function validFocusedControl(value: unknown) {
  return isRecord(value)
    && exactKeys(value, ["name", "role", "tag"])
    && typeof value.tag === "string"
    && /^[a-z][a-z0-9-]{0,30}$/.test(value.tag)
    && (value.role === null || (typeof value.role === "string" && /^[a-z-]{1,30}$/.test(value.role)))
    && safeVisibleText(value.name);
}

function validVirtualAuthenticator(value: unknown) {
  return isRecord(value)
    && exactKeys(value, ["credentialCount", "protocol", "transport"])
    && value.protocol === "ctap2"
    && value.transport === "internal"
    && value.credentialCount === 1;
}

function validWebAuthnOperations(value: unknown) {
  if (!Array.isArray(value) || value.length !== 4) return false;
  const operations = value.map((entry) => isRecord(entry) ? entry.operation : null);
  if (JSON.stringify(operations) !== JSON.stringify([
    "create.request", "create.result", "get.request", "get.result",
  ])) return false;
  return value.every((entry) => {
    if (!isRecord(entry) || typeof entry.operation !== "string") return false;
    if (entry.operation.endsWith(".result")) {
      return exactKeys(entry, ["credentialType", "idBytes", "operation"])
        && entry.credentialType === "public-key"
        && Number.isSafeInteger(entry.idBytes)
        && Number(entry.idBytes) >= 16
        && Number(entry.idBytes) <= 1024;
    }
    if (entry.operation === "create.request") {
      return exactKeys(entry, [
        "algorithms", "attestation", "challengeBytes", "operation", "origin",
        "residentKey", "rpId", "rpName", "userIdBytes", "userNameBytes",
        "userVerification",
      ])
        && entry.origin === "https://pay.ci.clean-pay.dev"
        && entry.rpId === "pay.ci.clean-pay.dev"
        && entry.rpName === "Clean Pay"
        && safePositiveInteger(entry.challengeBytes, 16, 256)
        && safePositiveInteger(entry.userIdBytes, 1, 128)
        && safePositiveInteger(entry.userNameBytes, 1, 255)
        && Array.isArray(entry.algorithms)
        && entry.algorithms.every((algorithm) => Number.isSafeInteger(algorithm))
        && ["preferred", "required"].includes(String(entry.residentKey))
        && entry.userVerification === "required"
        && entry.attestation === "none";
    }
    return exactKeys(entry, [
      "allowCredentialCount", "allowCredentialTypes", "challengeBytes",
      "operation", "origin", "rpId", "userVerification",
    ])
      && entry.origin === "https://pay.ci.clean-pay.dev"
      && entry.rpId === "pay.ci.clean-pay.dev"
      && safePositiveInteger(entry.challengeBytes, 16, 256)
      && safePositiveInteger(entry.allowCredentialCount, 1, 20)
      && Array.isArray(entry.allowCredentialTypes)
      && entry.allowCredentialTypes.every((kind) => kind === "public-key")
      && entry.userVerification === "required";
  });
}

function validPaymentFencing(value: unknown) {
  return isRecord(value)
    && exactKeys(value, [
      "commitThenRateLimit", "initializationCount", "replayCount", "sameBody", "sameKey",
    ])
    && value.commitThenRateLimit === true
    && value.initializationCount === 1
    && value.replayCount === 1
    && value.sameBody === true
    && value.sameKey === true;
}

function validIosCspBoundary(value: unknown) {
  return isRecord(value)
    && exactKeys(value, ["dialogCount", "reason"])
    && value.dialogCount === 0
    && value.reason === "pristine-static-csp-blocks-client-hydration";
}

function validServiceWorkerBoundary(value: unknown) {
  if (!isRecord(value) || !isRecord(value.online) || !isRecord(value.offline)) return false;
  return exactKeys(value, ["offline", "online", "reason", "registrationMode"])
    && value.registrationMode === "playwright-explicit-production-sw"
    && value.reason === "pristine-static-csp-blocks-install-page-hydration"
    && exactKeys(value.online, ["cacheNames", "scopePath", "scriptPath"])
    && value.online.scriptPath === "/sw.js"
    && value.online.scopePath === "/"
    && Array.isArray(value.online.cacheNames)
    && value.online.cacheNames.length === 1
    && value.online.cacheNames.every((name) => (
      typeof name === "string" && /^clean-pay-shell-[A-Za-z0-9._-]{1,200}$/.test(name)
    ))
    && exactKeys(value.offline, ["controlled", "pathname", "queryKeys"])
    && value.offline.controlled === true
    && value.offline.pathname === "/offline"
    && JSON.stringify(value.offline.queryKeys) === JSON.stringify(["journey_offline"]);
}

function validReferralCalls(value: unknown) {
  if (!Array.isArray(value) || value.length !== 2) return false;
  return JSON.stringify(value.map((entry) => isRecord(entry) ? entry.operation : null))
      === JSON.stringify(["clipboard.writeText", "navigator.share"])
    && value.every((entry) => isRecord(entry)
      && exactKeys(entry, ["bytes", "operation"])
      && safePositiveInteger(entry.bytes, 1, 2048));
}

function validTelegramMerge(value: unknown) {
  return isRecord(value)
    && exactKeys(value, ["confirmed", "dryRunCount", "mergeCount", "redirectPath"])
    && value.confirmed === true
    && value.dryRunCount === 2
    && value.mergeCount === 1
    && value.redirectPath === "/cabinet";
}

function validOidcLifecycle(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.preCallback) || !isRecord(value.final)) return false;
  const expectedNames = [
    "clean_pay_tg_code_verifier", "clean_pay_tg_nonce", "clean_pay_tg_state",
  ];
  return exactKeys(value, ["final", "preCallback", "redirectChain"])
    && value.preCallback.length === 3
    && JSON.stringify(value.preCallback.map((cookie) => isRecord(cookie) ? cookie.name : null))
      === JSON.stringify(expectedNames)
    && value.preCallback.every((cookie) => validSafeCookie(cookie, "temporary"))
    && exactKeys(value.final, ["callbackReceipt", "temporaryCookiesCleared"])
    && value.final.temporaryCookiesCleared === true
    && validSafeCookie(value.final.callbackReceipt, "receipt")
    && isRecord(value.final.callbackReceipt)
    && value.final.callbackReceipt.name === "clean_pay_tg_callback_receipt"
    && Array.isArray(value.redirectChain)
    && value.redirectChain.length >= 4
    && value.redirectChain.length <= 8
    && value.redirectChain.every(validRedirectHop)
    && value.redirectChain.some((hop) => isRecord(hop) && hop.pathname === "/auth/telegram/callback")
    && value.redirectChain.at(-1)?.pathname === "/cabinet";
}

function validSafeCookie(value: unknown, kind: "temporary" | "receipt") {
  if (!isRecord(value)) return false;
  return exactKeys(value, [
    "domain", "expiry", "httpOnly", "name", "path", "sameSite", "secure", "valueBytes",
    "valueSha256",
  ])
    && typeof value.name === "string"
    && /^clean_pay_[a-z0-9_]+$/.test(value.name)
    && safePositiveInteger(value.valueBytes, 16, 4096)
    && typeof value.valueSha256 === "string"
    && /^[a-f0-9]{64}$/.test(value.valueSha256)
    && value.domain === "pay.ci.clean-pay.dev"
    && value.path === (kind === "temporary" ? "/" : "/auth/telegram/callback")
    && value.httpOnly === true
    && value.secure === true
    && value.sameSite === "Lax"
    && isRecord(value.expiry)
    && exactKeys(value.expiry, ["boundedSeconds", "epochSeconds"])
    && value.expiry.boundedSeconds === (kind === "temporary" ? "1700..1950" : "60..150")
    && typeof value.expiry.epochSeconds === "number"
    && Number.isFinite(value.expiry.epochSeconds)
    && value.expiry.epochSeconds > 0;
}

function validRedirectHop(value: unknown) {
  return isRecord(value)
    && exactKeys(value, ["origin", "pathname", "queryKeys"])
    && ["https://pay.ci.clean-pay.dev", "https://oauth.telegram.org"].includes(String(value.origin))
    && ["/auth/telegram/start", "/auth", "/auth/telegram/callback", "/cabinet"].includes(String(value.pathname))
    && Array.isArray(value.queryKeys)
    && value.queryKeys.every((key) => [
      "client_id", "code", "code_challenge", "code_challenge_method", "nonce",
      "redirect_to", "redirect_uri", "response_type", "scope", "state",
      "turnstile_token", "cf-turnstile-response",
    ].includes(String(key)));
}

function validTurnstileCalls(value: unknown) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 100) return false;
  const validCalls = value.every((entry) => {
    if (!isRecord(entry) || typeof entry.method !== "string") return false;
    if (entry.method === "render") {
      return exactKeys(entry, ["action", "method", "widgetId"])
        && validTurnstileAction(entry.action)
        && validWidgetId(entry.widgetId);
    }
    if (entry.method === "challenge") {
      return exactKeys(entry, ["action", "issue", "method", "widgetId"])
        && validTurnstileAction(entry.action)
        && validWidgetId(entry.widgetId)
        && safePositiveInteger(entry.issue, 1, 10_000);
    }
    return ["execute", "remove", "reset"].includes(entry.method)
      && exactKeys(entry, ["method", "widgetId"])
      && validWidgetId(entry.widgetId);
  });
  return validCalls
    && value.some((entry) => isRecord(entry) && entry.method === "render")
    && value.some((entry) => isRecord(entry) && entry.method === "challenge");
}

function validExactStringArray(value: unknown, allowed: string[]) {
  return Array.isArray(value)
    && value.length === allowed.length
    && value.every((entry, index) => entry === allowed[index]);
}

function validTurnstileAction(value: unknown) {
  return typeof value === "string" && [
    "auth_login", "email_change", "email_verification", "telegram_auth_start",
  ].includes(value);
}

function validWidgetId(value: unknown) {
  return typeof value === "string" && /^synthetic-turnstile-[1-9]\d*$/.test(value);
}

function safeNameArray(value: unknown) {
  return Array.isArray(value)
    && value.length <= 32
    && value.every((name) => typeof name === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(name));
}

function safeVisibleText(value: unknown) {
  return typeof value === "string"
    && value.length <= 200
    && !/@/.test(value)
    && !/(?:bearer|password|secret|token)=?/i.test(value);
}

function safePositiveInteger(value: unknown, minimum: number, maximum: number) {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function exactKeys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length
    && actual.every((key, index) => key === sorted[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

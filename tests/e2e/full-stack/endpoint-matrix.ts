export type MatrixSession = "none" | "unverified-email" | "telegram";
export type MatrixVerifiedEmail = "not-required" | "required" | "blocked-until-verified";
export type MatrixUpstream = "clean-pay" | "postgres" | "redis" | "remnashop" | "mailpit" | "telegram-oidc" | "remnawave";

export type EndpointMatrixCase = {
  method: string;
  path: string;
  body?: unknown;
  statuses?: number[];
  session: MatrixSession;
  verifiedEmail: MatrixVerifiedEmail;
  upstream: MatrixUpstream[];
  unexpected5xx: "bug";
};

const cleanPayOnly = ["clean-pay"] satisfies MatrixUpstream[];
const coreReadiness = ["clean-pay", "postgres", "redis", "remnashop", "mailpit", "telegram-oidc", "remnawave"] satisfies MatrixUpstream[];
const remnashopFlow = ["clean-pay", "postgres", "redis", "remnashop"] satisfies MatrixUpstream[];
const subscriptionReadFlow = ["clean-pay", "postgres", "redis", "remnashop", "remnawave"] satisfies MatrixUpstream[];
const emailFlow = ["clean-pay", "postgres", "redis", "remnashop", "mailpit"] satisfies MatrixUpstream[];
const telegramFlow = ["clean-pay", "postgres", "redis", "telegram-oidc"] satisfies MatrixUpstream[];
const telegramWebAppFlow = ["clean-pay", "postgres", "redis", "remnashop"] satisfies MatrixUpstream[];

export const protectedEndpoints: EndpointMatrixCase[] = [
  { method: "GET", path: "/api/me", session: "none", verifiedEmail: "required", upstream: cleanPayOnly, unexpected5xx: "bug" },
  { method: "GET", path: "/api/bff/auth/me", session: "none", verifiedEmail: "required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/auth/change-password", body: { current_password: "old", new_password: "new" }, session: "none", verifiedEmail: "required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/auth/email/request-verification", body: { email: "nobody@example.com" }, session: "none", verifiedEmail: "not-required", upstream: emailFlow, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/auth/email/confirm", body: { email: "nobody@example.com", code: "000000" }, session: "none", verifiedEmail: "not-required", upstream: emailFlow, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/auth/email/change", body: { email: "new@example.com" }, session: "none", verifiedEmail: "required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/auth/passkey/register/options", session: "none", verifiedEmail: "required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/auth/passkey/register/verify", body: { id: "missing" }, session: "none", verifiedEmail: "required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "GET", path: "/api/bff/auth/passkey/credentials", session: "none", verifiedEmail: "required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "DELETE", path: "/api/bff/auth/passkey/credentials/missing", session: "none", verifiedEmail: "required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/link/remnashop", body: { email: "nobody@example.com", password: "secret" }, session: "none", verifiedEmail: "required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "GET", path: "/api/bff/subscription/current", session: "none", verifiedEmail: "required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "GET", path: "/api/bff/subscription/offers", session: "none", verifiedEmail: "required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "GET", path: "/api/bff/subscription/devices", session: "none", verifiedEmail: "required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "DELETE", path: "/api/bff/subscription/devices", session: "none", verifiedEmail: "required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "DELETE", path: "/api/bff/subscription/devices/missing-device", session: "none", verifiedEmail: "required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/subscription/promocode", body: { code: "NOPE" }, session: "none", verifiedEmail: "required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/subscription/reissue", session: "none", verifiedEmail: "required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/subscription/purchase", body: { plan_code: "missing", duration_days: 30, gateway_type: "TEST" }, session: "none", verifiedEmail: "required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/subscription/extend", body: { duration_days: 30, gateway_type: "TEST" }, session: "none", verifiedEmail: "required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "GET", path: "/api/bff/payments/history", session: "none", verifiedEmail: "required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "GET", path: "/api/bff/payments/status", session: "none", verifiedEmail: "required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "GET", path: "/api/bff/support", session: "none", verifiedEmail: "required", upstream: cleanPayOnly, unexpected5xx: "bug" },
];

export const anonymousPublicCases: EndpointMatrixCase[] = [
  { method: "GET", path: "/api/health", statuses: [200], session: "none", verifiedEmail: "not-required", upstream: cleanPayOnly, unexpected5xx: "bug" },
  { method: "GET", path: "/api/health/liveness", statuses: [200], session: "none", verifiedEmail: "not-required", upstream: cleanPayOnly, unexpected5xx: "bug" },
  { method: "GET", path: "/api/health/readiness", statuses: [200], session: "none", verifiedEmail: "not-required", upstream: coreReadiness, unexpected5xx: "bug" },
  { method: "GET", path: "/api/bff/plans/public", statuses: [200], session: "none", verifiedEmail: "not-required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/auth/identify", body: { email: "nobody@example.com" }, statuses: [200], session: "none", verifiedEmail: "not-required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/auth/identify", body: { email: "" }, statuses: [400], session: "none", verifiedEmail: "not-required", upstream: cleanPayOnly, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/auth/login", body: { email: "nobody@example.com", password: "bad-password" }, statuses: [400, 401, 404], session: "none", verifiedEmail: "not-required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/auth/register", body: { email: "", password: "" }, statuses: [400], session: "none", verifiedEmail: "not-required", upstream: cleanPayOnly, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/auth/telegram/webapp", body: {}, statuses: [400, 429], session: "none", verifiedEmail: "not-required", upstream: telegramWebAppFlow, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/auth/passkey/login/options", body: {}, statuses: [200], session: "none", verifiedEmail: "not-required", upstream: cleanPayOnly, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/auth/passkey/login/verify", body: { id: "missing", response: {} }, statuses: [400, 401], session: "none", verifiedEmail: "not-required", upstream: cleanPayOnly, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/auth/logout", statuses: [200], session: "none", verifiedEmail: "not-required", upstream: cleanPayOnly, unexpected5xx: "bug" },
  { method: "POST", path: "/api/logout", statuses: [200], session: "none", verifiedEmail: "not-required", upstream: cleanPayOnly, unexpected5xx: "bug" },
  { method: "GET", path: "/login", statuses: [200], session: "none", verifiedEmail: "not-required", upstream: cleanPayOnly, unexpected5xx: "bug" },
  { method: "GET", path: "/register", statuses: [200], session: "none", verifiedEmail: "not-required", upstream: cleanPayOnly, unexpected5xx: "bug" },
  { method: "GET", path: "/auth/telegram/callback?code=bad-code&state=bad-state", statuses: [307], session: "none", verifiedEmail: "not-required", upstream: telegramFlow, unexpected5xx: "bug" },
  { method: "GET", path: "/auth/telegram/webapp", statuses: [200], session: "none", verifiedEmail: "not-required", upstream: cleanPayOnly, unexpected5xx: "bug" },
  { method: "GET", path: "/cabinet", statuses: [307], session: "none", verifiedEmail: "required", upstream: cleanPayOnly, unexpected5xx: "bug" },
];

export const unverifiedAllowedCases: EndpointMatrixCase[] = [
  { method: "GET", path: "/api/me", statuses: [403], session: "unverified-email", verifiedEmail: "blocked-until-verified", upstream: cleanPayOnly, unexpected5xx: "bug" },
  { method: "GET", path: "/api/bff/auth/me", statuses: [403], session: "unverified-email", verifiedEmail: "blocked-until-verified", upstream: cleanPayOnly, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/auth/email/request-verification", body: { email: undefined }, statuses: [200, 201, 202, 400, 429], session: "unverified-email", verifiedEmail: "not-required", upstream: emailFlow, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/auth/email/confirm", body: { code: "000000", registrationFlow: true }, statuses: [400, 429], session: "unverified-email", verifiedEmail: "not-required", upstream: emailFlow, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/auth/email/change", body: { email: "bad-email" }, statuses: [400, 403, 409, 422, 429], session: "unverified-email", verifiedEmail: "blocked-until-verified", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "GET", path: "/register/verify-email", statuses: [200], session: "unverified-email", verifiedEmail: "blocked-until-verified", upstream: cleanPayOnly, unexpected5xx: "bug" },
];

export const unverifiedBlockedCases: EndpointMatrixCase[] = protectedEndpoints
  .filter((entry) => !["/api/me", "/api/bff/auth/me", "/api/bff/auth/email/request-verification", "/api/bff/auth/email/confirm", "/api/bff/auth/email/change"].includes(entry.path))
  .map((entry) => ({
    ...entry,
    session: "unverified-email",
    verifiedEmail: "blocked-until-verified",
  }));

export const telegramBusinessCases: EndpointMatrixCase[] = [
  { method: "GET", path: "/api/me", statuses: [200], session: "telegram", verifiedEmail: "not-required", upstream: cleanPayOnly, unexpected5xx: "bug" },
  { method: "GET", path: "/api/bff/auth/me", statuses: [200], session: "telegram", verifiedEmail: "not-required", upstream: cleanPayOnly, unexpected5xx: "bug" },
  { method: "GET", path: "/api/bff/support", statuses: [200], session: "telegram", verifiedEmail: "not-required", upstream: cleanPayOnly, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/auth/passkey/register/options", body: {}, statuses: [200], session: "telegram", verifiedEmail: "not-required", upstream: cleanPayOnly, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/auth/passkey/register/verify", body: { id: "missing", response: {} }, statuses: [400], session: "telegram", verifiedEmail: "not-required", upstream: cleanPayOnly, unexpected5xx: "bug" },
  { method: "GET", path: "/api/bff/auth/passkey/credentials", statuses: [200], session: "telegram", verifiedEmail: "not-required", upstream: cleanPayOnly, unexpected5xx: "bug" },
  { method: "DELETE", path: "/api/bff/auth/passkey/credentials/missing", statuses: [403, 404], session: "telegram", verifiedEmail: "not-required", upstream: cleanPayOnly, unexpected5xx: "bug" },
  { method: "GET", path: "/api/bff/subscription/current", statuses: [200, 403, 404, 409], session: "telegram", verifiedEmail: "not-required", upstream: subscriptionReadFlow, unexpected5xx: "bug" },
  { method: "GET", path: "/api/bff/subscription/offers", statuses: [200, 400, 403, 404, 409, 422], session: "telegram", verifiedEmail: "not-required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "GET", path: "/api/bff/subscription/devices", statuses: [200, 400, 403, 404, 409], session: "telegram", verifiedEmail: "not-required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "DELETE", path: "/api/bff/subscription/devices", statuses: [200, 400, 403, 404, 409], session: "telegram", verifiedEmail: "not-required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "DELETE", path: "/api/bff/subscription/devices/missing-device", statuses: [200, 400, 403, 404, 409], session: "telegram", verifiedEmail: "not-required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/subscription/promocode", body: { code: "NOPE" }, statuses: [200, 400, 403, 404, 409, 422], session: "telegram", verifiedEmail: "not-required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/subscription/reissue", statuses: [200, 400, 403, 404, 409], session: "telegram", verifiedEmail: "not-required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/subscription/purchase", body: { plan_code: "missing", duration_days: 30, gateway_type: "TEST" }, statuses: [400, 403, 404, 409, 422], session: "telegram", verifiedEmail: "not-required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/subscription/extend", body: { duration_days: 30, gateway_type: "TEST" }, statuses: [400, 403, 404, 409, 422], session: "telegram", verifiedEmail: "not-required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "GET", path: "/api/bff/payments/history", statuses: [200], session: "telegram", verifiedEmail: "not-required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "GET", path: "/api/bff/payments/status", statuses: [200], session: "telegram", verifiedEmail: "not-required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "GET", path: "/cabinet", statuses: [200], session: "telegram", verifiedEmail: "not-required", upstream: cleanPayOnly, unexpected5xx: "bug" },
  { method: "GET", path: "/login", statuses: [307], session: "telegram", verifiedEmail: "not-required", upstream: cleanPayOnly, unexpected5xx: "bug" },
];

export const malformedPayloadCases: EndpointMatrixCase[] = [
  { method: "POST", path: "/api/bff/auth/identify", body: {}, statuses: [400], session: "none", verifiedEmail: "not-required", upstream: cleanPayOnly, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/auth/login", body: {}, statuses: [400, 401, 422], session: "none", verifiedEmail: "not-required", upstream: cleanPayOnly, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/auth/register", body: {}, statuses: [400, 422], session: "none", verifiedEmail: "not-required", upstream: cleanPayOnly, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/auth/passkey/login/verify", body: {}, statuses: [400, 401], session: "none", verifiedEmail: "not-required", upstream: cleanPayOnly, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/auth/passkey/login/verify", body: { response: { clientDataJSON: "bad" } }, statuses: [400, 401], session: "none", verifiedEmail: "not-required", upstream: cleanPayOnly, unexpected5xx: "bug" },
  { method: "POST", path: "/api/bff/auth/logout", body: { ignored: true }, statuses: [200], session: "none", verifiedEmail: "not-required", upstream: cleanPayOnly, unexpected5xx: "bug" },
  { method: "GET", path: "/api/bff/plans/public?unexpected=1", statuses: [200], session: "none", verifiedEmail: "not-required", upstream: remnashopFlow, unexpected5xx: "bug" },
  { method: "GET", path: "/auth/telegram/start?redirect_to=https://evil.example.test", statuses: [307], session: "none", verifiedEmail: "not-required", upstream: telegramFlow, unexpected5xx: "bug" },
];

export const endpointMatrix = [
  ...protectedEndpoints,
  ...anonymousPublicCases,
  ...unverifiedAllowedCases,
  ...unverifiedBlockedCases,
  ...telegramBusinessCases,
  ...malformedPayloadCases,
];

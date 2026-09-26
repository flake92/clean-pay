export {
  telegramAccountMergeCookieMaxAgeSeconds,
  telegramAccountMergeCookieName,
} from "@/backend/integrations/auth/telegram-account-merge-store";
export {
  completedTelegramCallbackDestination,
  setTelegramCallbackReceipt,
} from "@/backend/integrations/telegram/callback-receipt";
export {
  checkpointDurableTelegramIdentityResolved,
  checkpointDurableTelegramOutcome,
  checkpointDurableTelegramRecoveryCommitted,
  completeDurableTelegramMerge,
  completeDurableTelegramSession,
  createDurableTelegramCallbackSession,
  failDurableTelegramCallback,
  loadDurableTelegramCallback,
  markDurableTelegramRecoveryDispatching,
  releaseDurableTelegramCallback,
  runWithDurableTelegramCallbackLease,
  type DurableTelegramCallbackCheckpoint,
  type DurableTelegramCallbackOwnership,
  type DurableTelegramCallbackReplay,
} from "@/backend/integrations/telegram/durable-callback";
export {
  createWebSessionOnResponse,
  getCurrentSession,
  setDurableCallbackReplayCookies,
} from "@/backend/integrations/sessions/web-session-service";
export { revokeWebSessionById } from "@/backend/integrations/sessions/web-session-revocation";
export { readTelegramPopupRequest } from "@/backend/integrations/telegram/popup-request";
export {
  clearTelegramAuthCookiesOnResponse,
  readTelegramCallbackCookieProof,
  resumeTelegramOidcCodeExchange,
  resumeTelegramProviderAuthentication,
  TelegramAuthStateAlreadyConsumedError,
} from "@/backend/integrations/telegram/oidc";
export { validateRequestSource } from "@/backend/security/csrf";

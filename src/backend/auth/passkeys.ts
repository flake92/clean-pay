// Compatibility facade. WebAuthn and persistence details live in the
// infrastructure adapter and are exposed to application code through
// PasskeyCommands.
export {
  beginPasskeyLogin,
  beginPasskeyRegistration,
  deleteOwnedPasskey,
  deletePasskey,
  finishPasskeyLogin,
  finishPasskeyRegistration,
  listPasskeys,
  recordPasskeyUse,
} from "@/backend/integrations/auth/passkey-service";

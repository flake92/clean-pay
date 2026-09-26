import { createRemnashopEndpointOperations } from "@/backend/integrations/remnashop/endpoint-operations";
import { remnashopTransport } from "@/backend/integrations/remnashop/api-client-runtime";

export {
  getJwtExpiresAt,
  getRemnashopUserIdFromAccessToken,
} from "@/backend/integrations/remnashop/jwt-codec";
export {
  protectRemnashopToken,
  revealRemnashopToken,
} from "@/backend/integrations/remnashop/token-protection";

export const {
  remnashopAdminRequestResult,
  remnashopRequest,
  remnashopRequestResult,
} = remnashopTransport;

export const {
  getRemnashopMe,
  getRemnashopNotificationPreferences,
  remnashopAuth,
  remnashopAuthTelegramIdentity,
  remnashopChangePassword,
  remnashopCreateServiceSession,
  remnashopIdentifyEmail,
  remnashopLinkTelegram,
  remnashopMergeUsers,
  remnashopRefreshTokens,
  remnashopRequestPasswordReset,
  updateRemnashopNotificationPreferences,
} = createRemnashopEndpointOperations(remnashopTransport);

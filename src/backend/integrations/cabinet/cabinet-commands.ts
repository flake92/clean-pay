import {
  CabinetCommandError,
  type CabinetCommands,
} from "@/application/cabinet/ports/cabinet-commands";
import { ServiceError } from "@/backend/errors/service-error";
import { remnashopValidatedRequest } from "@/backend/integrations/remnashop/api-client-runtime";
import { getAuthorizedRemnashopTokens } from "@/backend/integrations/remnashop/client";
import { auditLog } from "@/backend/observability/audit";
import { auditedMutation } from "@/backend/observability/mutation-audit";
import {
  clearWebSession,
  getWebSessionUserIdFromAccessCookie,
} from "@/backend/integrations/sessions/web-session-service";
import type {
  DeviceDeleteResponse,
  DevicesDeleteAllResponse,
  PromocodeActivateResponse,
  ReissueResponse,
} from "@/backend/integrations/remnashop/contracts";
import { hasUnsafeDeviceHwidPathSegment } from "@/shared/domain/device-hwid";

type CabinetAuthorizer = typeof getAuthorizedRemnashopTokens;

export function createProductionCabinetCommands(
  authorize: CabinetAuthorizer = getAuthorizedRemnashopTokens,
): CabinetCommands {
  async function authorizedMutation<T>(action: string, mutate: (accessToken: string) => Promise<T>) {
    try {
      const { accessToken, session } = await authorize();
      await auditedMutation({ action, userId: session.userId, mutate: () => mutate(accessToken) });
    } catch (error) {
      if (error instanceof ServiceError) {
        throw new CabinetCommandError(error.prodMessage);
      }
      throw error;
    }
  }

  return {
  async deleteDevice(hwid) {
    if (hasUnsafeDeviceHwidPathSegment(hwid)) {
      throw new CabinetCommandError("Это устройство нельзя безопасно удалить отдельно.");
    }

    await authorizedMutation("device_delete", (accessToken) =>
      remnashopValidatedRequest<DeviceDeleteResponse>(`/subscription/devices/${encodeURIComponent(hwid)}`, {
        method: "DELETE", accessToken,
      }));
  },
  deleteAllDevices: () => authorizedMutation("devices_delete_all", (accessToken) =>
    remnashopValidatedRequest<DevicesDeleteAllResponse>("/subscription/devices", { method: "DELETE", accessToken })),
  reissueSubscription: () => authorizedMutation("subscription_reissue", (accessToken) =>
    remnashopValidatedRequest<ReissueResponse>("/subscription/reissue", { method: "POST", accessToken })),
  activatePromocode: (code) => authorizedMutation("promocode_activation", (accessToken) =>
    remnashopValidatedRequest<PromocodeActivateResponse>("/subscription/promocode", {
      method: "POST", accessToken, body: { code },
    })),
  async logout() {
    const userId = await getWebSessionUserIdFromAccessCookie();
    await auditLog({ action: "auth_logout", userId });
    await clearWebSession();
  },
  };
}

export const productionCabinetCommands = createProductionCabinetCommands();

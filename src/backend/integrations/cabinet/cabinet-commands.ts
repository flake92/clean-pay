import {
  CabinetCommandError,
  type CabinetCommands,
} from "@/backend/application/cabinet/ports/cabinet-commands";
import { ServiceError } from "@/backend/errors/service-error";
import { getAuthorizedRemnashopTokens, remnashopRequest } from "@/backend/integrations/remnashop/client";
import { auditLog } from "@/backend/observability/audit";
import { auditedMutation } from "@/backend/observability/mutation-audit";
import { clearWebSession } from "@/backend/sessions/web-session";
import type {
  DeviceDeleteResponse,
  DevicesDeleteAllResponse,
  PromocodeActivateResponse,
  ReissueResponse,
} from "@/shared/remnashop/types";

async function authorizedMutation<T>(action: string, mutate: (accessToken: string) => Promise<T>) {
  try {
    const { accessToken, session } = await getAuthorizedRemnashopTokens();
    await auditedMutation({ action, userId: session.userId, mutate: () => mutate(accessToken) });
  } catch (error) {
    if (error instanceof ServiceError) {
      throw new CabinetCommandError(error.prodMessage);
    }
    throw error;
  }
}

export const productionCabinetCommands: CabinetCommands = {
  deleteDevice: (hwid) => authorizedMutation("device_delete", (accessToken) =>
    remnashopRequest<DeviceDeleteResponse>(`/subscription/devices/${encodeURIComponent(hwid)}`, {
      method: "DELETE", accessToken,
    })),
  deleteAllDevices: () => authorizedMutation("devices_delete_all", (accessToken) =>
    remnashopRequest<DevicesDeleteAllResponse>("/subscription/devices", { method: "DELETE", accessToken })),
  reissueSubscription: () => authorizedMutation("subscription_reissue", (accessToken) =>
    remnashopRequest<ReissueResponse>("/subscription/reissue", { method: "POST", accessToken })),
  activatePromocode: (code) => authorizedMutation("promocode_activation", (accessToken) =>
    remnashopRequest<PromocodeActivateResponse>("/subscription/promocode", {
      method: "POST", accessToken, body: { code },
    })),
  async logout() {
    await auditLog({ action: "auth_logout" });
    await clearWebSession();
  },
};

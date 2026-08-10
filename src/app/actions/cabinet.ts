"use server";

import { revalidatePath } from "next/cache";

import {
  activateCabinetPromocode,
  deleteAllCabinetDevices,
  deleteCabinetDevice,
  reissueCabinetSubscription,
} from "@/application/cabinet/execute-command";
import { productionCabinetCommands } from "@/backend/integrations/cabinet/cabinet-commands";

export async function deleteDeviceAction(hwid: string) {
  const result = await deleteCabinetDevice(productionCabinetCommands, hwid);
  if (result.status === "success") revalidatePath("/cabinet");
  return result;
}

export async function deleteAllDevicesAction() {
  const result = await deleteAllCabinetDevices(productionCabinetCommands);
  if (result.status === "success") revalidatePath("/cabinet");
  return result;
}

export async function reissueSubscriptionAction() {
  const result = await reissueCabinetSubscription(productionCabinetCommands);
  if (result.status === "success") revalidatePath("/cabinet");
  return result;
}

export async function activatePromocodeAction(code: string) {
  const result = await activateCabinetPromocode(productionCabinetCommands, code);
  if (result.status === "success") revalidatePath("/cabinet");
  return result;
}

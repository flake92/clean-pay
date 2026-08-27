"use server";

import { revalidatePath } from "next/cache";

import {
  activateCabinetPromocode,
  deleteAllCabinetDevices,
  deleteCabinetDevice,
  reissueCabinetSubscription,
} from "@/application/cabinet/execute-command";
import { productionCabinetCommands } from "@/app/_composition/session-gateways";
import { parseBoundedIdentifier } from "@/app/actions/runtime-payload";

export async function deleteDeviceAction(hwid: string) {
  const parsed = parseBoundedIdentifier(hwid, 512);
  if (!parsed) {
    return { status: "error" as const, message: "Некорректный идентификатор устройства." };
  }
  const result = await deleteCabinetDevice(productionCabinetCommands, parsed);
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
  const parsed = parseBoundedIdentifier(code, 256);
  if (!parsed) {
    return { status: "error" as const, message: "Введите корректный промокод." };
  }
  const result = await activateCabinetPromocode(productionCabinetCommands, parsed);
  if (result.status === "success") revalidatePath("/cabinet");
  return result;
}

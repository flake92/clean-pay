import type { CabinetCommands } from "@/backend/application/cabinet/ports/cabinet-commands";
import type { CabinetCommandResult } from "@/shared/presentation/cabinet-actions";

function printable(value: string, maxLength: number) {
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength && !/[\u0000-\u001f\u007f-\u009f]/u.test(normalized)
    ? normalized
    : null;
}

export async function deleteCabinetDevice(commands: CabinetCommands, hwid: string): Promise<CabinetCommandResult> {
  const validHwid = printable(hwid, 512);
  if (!validHwid) return { status: "error", message: "Некорректный идентификатор устройства." };
  try {
    await commands.deleteDevice(validHwid);
    return { status: "success", message: "Устройство удалено." };
  } catch {
    return { status: "error", message: "Не удалось удалить устройство." };
  }
}

export async function deleteAllCabinetDevices(commands: CabinetCommands): Promise<CabinetCommandResult> {
  try {
    await commands.deleteAllDevices();
    return { status: "success", message: "Все устройства удалены." };
  } catch {
    return { status: "error", message: "Не удалось удалить устройства." };
  }
}

export async function reissueCabinetSubscription(commands: CabinetCommands): Promise<CabinetCommandResult> {
  try {
    await commands.reissueSubscription();
    return { status: "success", message: "Подписка перевыпущена. Ссылка обновлена." };
  } catch {
    return { status: "error", message: "Не удалось перевыпустить подписку." };
  }
}

export async function activateCabinetPromocode(commands: CabinetCommands, code: string): Promise<CabinetCommandResult> {
  const validCode = printable(code, 256);
  if (!validCode) return { status: "error", message: "Введите корректный промокод." };
  try {
    await commands.activatePromocode(validCode);
    return { status: "success", message: "Промокод активирован. Данные кабинета обновлены." };
  } catch {
    return { status: "error", message: "Не удалось активировать промокод." };
  }
}

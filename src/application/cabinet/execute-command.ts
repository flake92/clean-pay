import {
  CabinetCommandError,
  type CabinetCommands,
} from "@/application/cabinet/ports/cabinet-commands";
import type { CabinetCommandResult } from "@/application/models/cabinet-actions";

function printable(value: string, maxLength: number) {
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength && !/[\u0000-\u001f\u007f-\u009f]/u.test(normalized)
    ? normalized
    : null;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof CabinetCommandError) {
    return error.publicMessage;
  }
  return fallback;
}

export async function deleteCabinetDevice(commands: CabinetCommands, hwid: string): Promise<CabinetCommandResult> {
  const validHwid = printable(hwid, 512);
  if (!validHwid) return { status: "error", message: "Некорректный идентификатор устройства." };
  try {
    await commands.deleteDevice(validHwid);
    return { status: "success", message: "Устройство удалено." };
  } catch (error) {
    return { status: "error", message: errorMessage(error, "Не удалось удалить устройство.") };
  }
}

export async function deleteAllCabinetDevices(commands: CabinetCommands): Promise<CabinetCommandResult> {
  try {
    await commands.deleteAllDevices();
    return { status: "success", message: "Все устройства удалены." };
  } catch (error) {
    return { status: "error", message: errorMessage(error, "Не удалось удалить устройства.") };
  }
}

export async function reissueCabinetSubscription(commands: CabinetCommands): Promise<CabinetCommandResult> {
  try {
    await commands.reissueSubscription();
    return { status: "success", message: "Подписка перевыпущена. Ссылка обновлена." };
  } catch (error) {
    return { status: "error", message: errorMessage(error, "Не удалось перевыпустить подписку.") };
  }
}

export async function activateCabinetPromocode(commands: CabinetCommands, code: string): Promise<CabinetCommandResult> {
  const validCode = printable(code, 256);
  if (!validCode) return { status: "error", message: "Введите корректный промокод." };
  try {
    await commands.activatePromocode(validCode);
    return { status: "success", message: "Промокод активирован. Данные кабинета обновлены." };
  } catch (error) {
    return { status: "error", message: errorMessage(error, "Не удалось активировать промокод.") };
  }
}

export function endCabinetSession(commands: CabinetCommands) {
  return commands.logout();
}

export async function clearCabinetSession(commands: CabinetCommands) {
  try {
    await endCabinetSession(commands);
    return { status: "success" as const };
  } catch {
    return {
      status: "error" as const,
      message: "Не удалось завершить сессию.",
    };
  }
}

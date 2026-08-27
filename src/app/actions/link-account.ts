"use server";

import { revalidatePath } from "next/cache";
import {
  cancelLinkedTelegram,
  confirmLinkedTelegram,
  linkAccountEmail,
  removeLinkedPasskey,
} from "@/application/auth/manage-linked-account";
import {
  productionLinkAccountCommands,
  productionPasskeyManagementGateway,
  productionTelegramAccountMergeGateway,
} from "@/app/_composition/action-runtime";
import {
  parseBoundedIdentifier,
  parseLinkAccountEmailPayload,
} from "@/app/actions/runtime-payload";

export async function linkAccountEmailAction(input: { email: string; password: string }) {
  const parsed = parseLinkAccountEmailPayload(input);
  return parsed
    ? linkAccountEmail(productionLinkAccountCommands, parsed)
    : { ok: false as const, code: "VALIDATION_ERROR", message: "Проверьте введённые данные." };
}
export async function confirmLinkedTelegramAction() { return confirmLinkedTelegram(productionTelegramAccountMergeGateway); }
export async function cancelLinkedTelegramAction() { const result = await cancelLinkedTelegram(productionTelegramAccountMergeGateway); if (result.ok) revalidatePath("/link-account"); return result; }
export async function removeLinkedPasskeyAction(id: string) {
  const parsed = parseBoundedIdentifier(id);
  if (!parsed) {
    return { ok: false as const, code: "VALIDATION_ERROR", message: "Не удалось удалить ключ быстрого входа." };
  }
  const result = await removeLinkedPasskey(productionPasskeyManagementGateway, parsed);
  if (result.ok) revalidatePath("/link-account");
  return result;
}

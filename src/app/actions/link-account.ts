"use server";

import { revalidatePath } from "next/cache";
import {
  cancelLinkedTelegram,
  confirmLinkedTelegram,
  linkAccountEmail,
  removeLinkedPasskey,
} from "@/application/auth/manage-linked-account";
import { productionLinkAccountCommands } from "@/backend/integrations/auth/link-account";
import { productionTelegramAccountMergeGateway } from "@/backend/integrations/auth/telegram-account-merge-gateway";
import { productionPasskeyManagementGateway } from "@/backend/integrations/auth/passkey-management-gateway";

export async function linkAccountEmailAction(input: { email: string; password: string }) { return linkAccountEmail(productionLinkAccountCommands, input); }
export async function confirmLinkedTelegramAction() { return confirmLinkedTelegram(productionTelegramAccountMergeGateway); }
export async function cancelLinkedTelegramAction() { const result = await cancelLinkedTelegram(productionTelegramAccountMergeGateway); if (result.ok) revalidatePath("/link-account"); return result; }
export async function removeLinkedPasskeyAction(id: string) { const result = await removeLinkedPasskey(productionPasskeyManagementGateway, id); if (result.ok) revalidatePath("/link-account"); return result; }

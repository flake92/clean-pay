"use server";

import { revalidatePath } from "next/cache";
import {
  cancelLinkedTelegram,
  confirmLinkedTelegram,
  linkAccountEmail,
  removeLinkedPasskey,
} from "@/application/auth/manage-linked-account";
import { productionLinkAccountCommands } from "@/backend/integrations/auth/link-account";

export async function linkAccountEmailAction(input: { email: string; password: string }) { return linkAccountEmail(productionLinkAccountCommands, input); }
export async function confirmLinkedTelegramAction() { return confirmLinkedTelegram(productionLinkAccountCommands); }
export async function cancelLinkedTelegramAction() { const result = await cancelLinkedTelegram(productionLinkAccountCommands); if (result.ok) revalidatePath("/link-account"); return result; }
export async function removeLinkedPasskeyAction(id: string) { const result = await removeLinkedPasskey(productionLinkAccountCommands, id); if (result.ok) revalidatePath("/link-account"); return result; }

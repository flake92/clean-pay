import { cookies } from "next/headers";

import type { LinkAccountCommands, LinkAccountReader } from "@/backend/application/auth/ports/link-account";
import { deletePasskey, listPasskeys } from "@/backend/auth/passkeys";
import { getCurrentAuthProfile } from "@/backend/auth/profile";
import { linkRemnashopAccount } from "@/backend/auth/remnashop-link";
import {
  cancelTelegramAccountMerge,
  confirmTelegramAccountMerge,
  getTelegramAccountMergeConfirmation,
  telegramAccountMergeCookieName,
} from "@/backend/auth/telegram-account-merge";
import { ServiceError } from "@/backend/errors/service-error";

async function mergeToken() {
  const token = (await cookies()).get(telegramAccountMergeCookieName)?.value;
  if (!token) throw new ServiceError("NOT_FOUND", 404, "Account merge confirmation was not found.");
  return token;
}

async function clearMergeToken() {
  (await cookies()).delete(telegramAccountMergeCookieName);
}

export const productionLinkAccountReader: LinkAccountReader = {
  async loadProfile() {
    const { user } = await getCurrentAuthProfile();
    return {
      email: user.email ?? null,
      emailVerified: Boolean(user.emailVerified ?? user.is_email_verified),
      telegramId: user.telegramId ?? user.telegram_id?.toString() ?? null,
    };
  },
  async loadPasskeys() {
    const { credentials } = await listPasskeys();
    return credentials.map((credential) => ({
      id: credential.id,
      name: credential.name,
      createdAt: credential.createdAt.toISOString(),
      lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
    }));
  },
  async loadTelegramMergeConfirmation() {
    const confirmation = await getTelegramAccountMergeConfirmation(await mergeToken());
    return { ...confirmation, emailWillBeReplaced: confirmation.emailWillBeReplaced };
  },
};

export const productionLinkAccountCommands: LinkAccountCommands = {
  async linkEmail(input) {
    const result = await linkRemnashopAccount(input);
    return { linked: result.linked };
  },
  async confirmTelegramMerge() {
    await confirmTelegramAccountMerge(await mergeToken());
    await clearMergeToken();
  },
  async cancelTelegramMerge() {
    await cancelTelegramAccountMerge(await mergeToken());
    await clearMergeToken();
  },
  async deletePasskey(id) { await deletePasskey(id); },
};

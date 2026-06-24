import type { WebSession, WebUser } from "@prisma/client";

import type { RemnashopMe } from "@/lib/remnashop/types";

type SessionWithUser = WebSession & { user: WebUser };

export function localUserProfile(session: SessionWithUser) {
  return {
    telegram_id: session.user.telegramId?.toString() ?? null,
    auth_type: session.authMethod === "TELEGRAM" ? "telegram" : "email",
    email: session.user.email,
    is_email_verified: session.user.emailVerified,
    pending_email: null,
    name: session.user.fullName ?? session.user.displayName ?? "",
    username: session.user.telegramUsername,
    language: "ru",
    telegramId: session.user.telegramId?.toString() ?? null,
    telegramUsername: session.user.telegramUsername ?? null,
    fullName: session.user.fullName,
    displayName: session.user.displayName,
    emailVerified: session.user.emailVerified,
  };
}

export function remnashopUserProfile(session: SessionWithUser, profile: RemnashopMe) {
  const localUser = session.user;

  return {
    ...profile,
    auth_type: session.authMethod === "TELEGRAM" ? "telegram" : "email",
    telegram_id: localUser.telegramId?.toString() ?? profile.telegram_id?.toString() ?? null,
    telegramId: localUser.telegramId?.toString() ?? null,
    telegramUsername: localUser.telegramUsername ?? null,
    fullName: localUser.fullName ?? profile.name,
    displayName: localUser.displayName ?? profile.name,
    emailVerified: localUser.emailVerified ?? profile.is_email_verified,
  };
}

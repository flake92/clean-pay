import type { WebSession, WebUser } from "@prisma/client";

import type { RemnashopMe } from "@/shared/remnashop/types";

type SessionWithUser = WebSession & { user: WebUser };

export function localUserProfile(session: SessionWithUser) {
  const hasEmail = Boolean(session.user.email);
  const emailVerified = hasEmail && session.user.emailVerified;

  return {
    telegram_id: session.user.telegramId?.toString() ?? null,
    auth_type: session.authMethod === "TELEGRAM" ? "telegram" : "email",
    email: session.user.email,
    is_email_verified: emailVerified,
    pending_email: null,
    name: session.user.fullName ?? session.user.displayName ?? "",
    username: session.user.telegramUsername,
    language: "ru",
    telegramId: session.user.telegramId?.toString() ?? null,
    telegramUsername: session.user.telegramUsername ?? null,
    fullName: session.user.fullName,
    displayName: session.user.displayName,
    emailVerified,
  };
}

export function remnashopUserProfile(session: SessionWithUser, profile: RemnashopMe) {
  const localUser = session.user;
  const email = localUser.email ?? profile.email;
  const emailVerified = Boolean(email && (localUser.email ? localUser.emailVerified : profile.is_email_verified));

  return {
    ...profile,
    email,
    is_email_verified: emailVerified,
    auth_type: session.authMethod === "TELEGRAM" ? "telegram" : "email",
    telegram_id: localUser.telegramId?.toString() ?? profile.telegram_id?.toString() ?? null,
    telegramId: localUser.telegramId?.toString() ?? null,
    telegramUsername: localUser.telegramUsername ?? null,
    fullName: localUser.fullName ?? profile.name,
    displayName: localUser.displayName ?? profile.name,
    emailVerified,
  };
}

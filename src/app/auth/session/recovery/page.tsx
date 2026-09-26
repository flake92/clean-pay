import { AuthShell } from "@/frontend/components/auth-shell";
import { LinkButton } from "@/frontend/components/prime/link-button";
import { safeRedirectPath } from "@/shared/auth/redirect-policy";
import { safeAuthenticationFallback } from "@/shared/domain/post-auth-continuation";

function boundedRetryAfter(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed = Number(candidate);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 3_600
    ? parsed
    : 3;
}

function completedAttempts(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === "1" ? 1 : 0;
}

export default async function ProviderSessionRecoveryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const returnTo = safeRedirectPath(
    Array.isArray(params.return_to) ? params.return_to[0] : params.return_to,
  ) ?? "/cabinet";
  const retryAfter = boundedRetryAfter(params.retry_after);
  const attempt = completedAttempts(params.attempt);
  const kind = params.kind === "session" ? "session" : "provider";
  const retryParams = new URLSearchParams({
    return_to: returnTo,
    attempt: "1",
  });
  const fallbackTo = safeAuthenticationFallback(
    Array.isArray(params.fallback_to) ? params.fallback_to[0] : params.fallback_to,
    returnTo,
  );
  if (fallbackTo && kind === "session") {
    retryParams.set("fallback_to", fallbackTo);
  }
  const retryPath = kind === "session"
    ? "/auth/session/refresh"
    : "/auth/session/recover";

  return (
    <AuthShell
      description={kind === "session"
        ? "Сервис авторизации временно не завершил вход. Ваши данные сессии сохранены."
        : "Вход выполнен, но сервис подписки временно не ответил. Ваша сессия сохранена."}
      title="Завершаем вход"
    >
      <div className="flex flex-column gap-3" role="alert">
        <div className="surface-100 border-round p-3 line-height-3 text-700">
          {attempt === 0
            ? `Подождите около ${retryAfter} сек. и повторите попытку.`
            : "Повторная попытка пока не удалась. Попробуйте ещё раз чуть позже."}
        </div>
        <LinkButton
          href={`${retryPath}?${retryParams.toString()}`}
          icon="pi pi-refresh"
          label="Повторить восстановление"
        />
        <LinkButton
          href="/support"
          label="Открыть поддержку"
          outlined
        />
      </div>
    </AuthShell>
  );
}

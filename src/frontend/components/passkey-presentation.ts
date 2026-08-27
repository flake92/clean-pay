function normalizedError(error: unknown) {
  if (!(error instanceof Error)) return null;
  return {
    message: error.message.toLowerCase(),
    name: error.name.toLowerCase(),
  };
}

export function isPasskeyUserCancellation(error: unknown) {
  const normalized = normalizedError(error);
  if (!normalized) return false;
  return (
    normalized.name.includes("notallowed")
    || normalized.name.includes("abort")
    || normalized.message.includes("not allowed")
    || normalized.message.includes("timed out")
    || normalized.message.includes("cancel")
  );
}

export function isPasskeyTransportError(error: unknown) {
  const normalized = normalizedError(error);
  if (!normalized) return false;
  return (
    (normalized.name.includes("typeerror")
      && normalized.message.includes("failed to fetch"))
    || normalized.message.includes("bluetooth")
    || normalized.message.includes("networkerror")
  );
}

export function isPasskeyCredentialUnavailable(error: unknown) {
  const normalized = normalizedError(error);
  if (!normalized) return false;
  return (
    normalized.name.includes("unknownerror")
    || normalized.name.includes("notreadable")
    || normalized.message.includes("credential manager")
    || normalized.message.includes("credential not found")
    || normalized.message.includes("no credentials")
  );
}

export function passkeyLoginErrorMessage(error: unknown) {
  if (isPasskeyUserCancellation(error)) {
    return "Окно быстрого входа закрыто. Можно войти по паролю.";
  }
  if (isPasskeyCredentialUnavailable(error)) {
    return "Сохранённый на устройстве ключ больше не связан с этим стендом. Войдите через e-mail или Telegram и создайте новый ключ в профиле.";
  }
  if (isPasskeyTransportError(error)) {
    return "Браузер не смог связаться с ключом. Для входа через телефон включите Bluetooth на компьютере и телефоне, затем повторите попытку.";
  }
  return "Не удалось войти быстрым способом.";
}

export function passkeySetupErrorMessage(error: unknown, required: boolean) {
  if (isPasskeyUserCancellation(error)) {
    return required
      ? "Окно Passkey закрыто. Повторите настройку, чтобы завершить вход."
      : "Окно быстрого входа закрыто. Это не проблема, можно продолжить без него.";
  }
  if (isPasskeyTransportError(error)) {
    return "Браузер не смог связаться с ключом. Для ключа на телефоне включите Bluetooth на компьютере и телефоне, держите телефон рядом и повторите попытку.";
  }
  return "Не удалось создать быстрый вход.";
}

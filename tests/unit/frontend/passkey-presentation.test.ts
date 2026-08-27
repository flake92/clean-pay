import { describe, expect, it } from "vitest";

import {
  isPasskeyCredentialUnavailable,
  isPasskeyTransportError,
  isPasskeyUserCancellation,
  passkeyLoginErrorMessage,
  passkeySetupErrorMessage,
} from "@/frontend/components/passkey-presentation";

describe("passkey presentation policies", () => {
  it("classifies browser failures without treating arbitrary values as errors", () => {
    expect(isPasskeyUserCancellation(Object.assign(new Error("cancel"), { name: "AbortError" }))).toBe(true);
    expect(isPasskeyTransportError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isPasskeyCredentialUnavailable(Object.assign(new Error("missing"), { name: "NotReadableError" }))).toBe(true);
    expect(isPasskeyUserCancellation("cancel")).toBe(false);
    expect(isPasskeyTransportError(null)).toBe(false);
    expect(isPasskeyCredentialUnavailable({ name: "UnknownError" })).toBe(false);
  });

  it("keeps login failure copy and precedence unchanged", () => {
    const cancellation = Object.assign(new Error("cancel"), {
      name: "NotAllowedError",
    });
    expect(passkeyLoginErrorMessage(cancellation))
      .toBe("Окно быстрого входа закрыто. Можно войти по паролю.");
    expect(passkeyLoginErrorMessage(Object.assign(new Error("missing"), { name: "UnknownError" })))
      .toBe("Сохранённый на устройстве ключ больше не связан с этим стендом. Войдите через e-mail или Telegram и создайте новый ключ в профиле.");
    expect(passkeyLoginErrorMessage(new TypeError("Failed to fetch")))
      .toBe("Браузер не смог связаться с ключом. Для входа через телефон включите Bluetooth на компьютере и телефоне, затем повторите попытку.");
    expect(passkeyLoginErrorMessage(new Error("other")))
      .toBe("Не удалось войти быстрым способом.");
  });

  it("keeps required and optional setup cancellation copy distinct", () => {
    const cancellation = Object.assign(new Error("cancel"), {
      name: "NotAllowedError",
    });
    expect(passkeySetupErrorMessage(cancellation, true))
      .toBe("Окно Passkey закрыто. Повторите настройку, чтобы завершить вход.");
    expect(passkeySetupErrorMessage(cancellation, false))
      .toBe("Окно быстрого входа закрыто. Это не проблема, можно продолжить без него.");
    expect(passkeySetupErrorMessage(new Error("other"), false))
      .toBe("Не удалось создать быстрый вход.");
  });
});

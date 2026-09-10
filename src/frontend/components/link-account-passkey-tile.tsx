import { Button } from "primereact/button";
import { Message } from "primereact/message";

import { AuthMethodTile } from "@/frontend/components/auth-method-tile";
import type { LinkAccountPasskeyViewModel } from "@/application/models/link-account";

/**
 * The quick-sign-in method of the account-linking screen: offer to enrol a
 * passkey, and list the ones already stored.
 *
 * Split out of LinkAccountPanel, which coordinated e-mail, Telegram and
 * passkeys in one 650-line body. The panel still owns the single-action lock
 * and the shared banners, because only one of the three may run at a time;
 * each method now owns nothing but its own presentation.
 */
export function LinkAccountPasskeyTile({
  actionLoading,
  description,
  navigateTo,
  onDelete,
  passkeys,
  webAuthnSupported,
}: {
  actionLoading: string | null;
  description: string;
  navigateTo: (path: string) => void;
  onDelete: (id: string) => void;
  passkeys: LinkAccountPasskeyViewModel[];
  webAuthnSupported: boolean | null;
}) {
  const hasPasskey = passkeys.length > 0;

  return (
    <AuthMethodTile
      active={hasPasskey}
      description={description}
      icon="pi pi-lock"
      meta={hasPasskey ? <span>Сохранено ключей: {passkeys.length}</span> : null}
      title="Быстрый вход"
    >
      {webAuthnSupported !== false ? (
        <div className="account-method-action-row">
          <Button
            disabled={actionLoading !== null}
            icon="pi pi-lock"
            label="Настроить"
            onClick={() => navigateTo("/passkey/setup")}
            type="button"
          />
          <Button
            disabled={actionLoading !== null}
            label="Позже"
            onClick={() => navigateTo("/cabinet")}
            outlined
            severity="secondary"
            type="button"
          />
        </div>
      ) : (
        <Message
          severity="info"
          text="На этом устройстве нельзя добавить новый ключ. Сохранённые ключи можно удалить ниже."
        />
      )}

      {hasPasskey ? (
        <div className="passkey-list">
          {passkeys.map((credential) => (
            <div className="passkey-list-item" key={credential.id}>
              <div className="passkey-list-item__body">
                <span className="passkey-list-item__name">{credential.name ?? "Ключ доступа"}</span>
                <span className="passkey-list-item__meta">
                  {credential.lastUsedAt
                    ? `Последний вход: ${new Date(credential.lastUsedAt).toLocaleDateString("ru-RU")}`
                    : "Ещё не использовался"}
                </span>
              </div>
              <Button
                aria-label="Удалить ключ"
                disabled={passkeys.length <= 1 || actionLoading !== null}
                icon="pi pi-trash"
                loading={actionLoading === `passkey-${credential.id}`}
                onClick={() => onDelete(credential.id)}
                outlined
                severity="danger"
                type="button"
              />
            </div>
          ))}
        </div>
      ) : null}
    </AuthMethodTile>
  );
}

"use client";

import { useState, type FormEvent } from "react";

import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";

import { activatePromocodeAction } from "@/app/actions/cabinet";

/**
 * Promocode redemption in the cabinet.
 *
 * Split out of CabinetPanel, which held six unrelated sections in one body.
 * This one owns its whole concern -- the entered code, the message it gets
 * back, and the request -- while the panel keeps only the single-action lock
 * the sections share, since two of them must never run at once.
 */
export function CabinetPromocodeCard({
  beginPendingAction,
  finishPendingAction,
  isPendingBlocked,
  onActivated,
  pendingAction,
}: {
  beginPendingAction: (action: string) => boolean;
  finishPendingAction: (action: string) => void;
  isPendingBlocked: () => boolean;
  onActivated: () => void;
  pendingAction: string | null;
}) {
  const [promocode, setPromocode] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function activatePromocode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isPendingBlocked()) {
      return;
    }

    const code = promocode.trim();

    if (!code) {
      setMessage("Введите промокод.");
      return;
    }

    const action = "promocode";
    if (!beginPendingAction(action)) {
      return;
    }
    setMessage(null);

    try {
      const result = await activatePromocodeAction(code);
      setMessage(result.message);
      if (result.status === "success") {
        setPromocode("");
        onActivated();
      }
    } catch {
      setMessage("Сеть недоступна. Не удалось активировать промокод.");
    } finally {
      finishPendingAction(action);
    }
  }

  return (
    <div className="card">
      <h5>Промокод</h5>
      {message ? <Message severity="info" text={message} /> : null}
      <form className="mt-3 flex w-full flex-column gap-2 md:w-30rem" onSubmit={activatePromocode}>
        <label className="text-sm font-medium text-700" htmlFor="promocode">
          Введите промокод
        </label>
        <div className="p-inputgroup">
          <InputText
            id="promocode"
            onChange={(event) => setPromocode(event.target.value)}
            placeholder="Введите код"
            value={promocode}
          />
          <Button
            disabled={pendingAction !== null}
            label="Активировать"
            loading={pendingAction === "promocode"}
            type="submit"
          />
        </div>
      </form>
    </div>
  );
}

const PAYMENT_REFERENCE_KEY = "cleanPayLastPaymentReference:v1";
const LEGACY_PAYMENT_ID_KEY = "cleanPayLastPaymentId";
const LEGACY_OPERATION_ID_KEY = "cleanPayLastPaymentOperationId";

export type PaymentReturnReference =
  | { paymentId: string; operationId?: never }
  | { operationId: string; paymentId?: never };

function validIdentifier(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.length <= 200;
}

export function storePaymentReturnReference(reference: PaymentReturnReference) {
  try {
    window.localStorage.setItem(
      PAYMENT_REFERENCE_KEY,
      JSON.stringify(reference),
    );
    window.localStorage.removeItem(LEGACY_PAYMENT_ID_KEY);
    window.localStorage.removeItem(LEGACY_OPERATION_ID_KEY);
    return true;
  } catch {
    return false;
  }
}

export function readPaymentReturnReference(): PaymentReturnReference | null {
  try {
    const stored = window.localStorage.getItem(PAYMENT_REFERENCE_KEY);

    if (stored) {
      const parsed = JSON.parse(stored) as Partial<PaymentReturnReference>;

      if (validIdentifier(parsed.operationId) && parsed.paymentId === undefined) {
        return { operationId: parsed.operationId! };
      }
      if (validIdentifier(parsed.paymentId) && parsed.operationId === undefined) {
        return { paymentId: parsed.paymentId! };
      }
    }

    // Migrate old installations deterministically. If both legacy keys exist,
    // the durable operation is newer and safer than an unrelated payment id.
    const legacyOperationId = window.localStorage.getItem(
      LEGACY_OPERATION_ID_KEY,
    );
    if (validIdentifier(legacyOperationId)) {
      return { operationId: legacyOperationId! };
    }

    const legacyPaymentId = window.localStorage.getItem(LEGACY_PAYMENT_ID_KEY);
    if (validIdentifier(legacyPaymentId)) {
      return { paymentId: legacyPaymentId! };
    }
  } catch {
    // Explicit URL identifiers continue to work without browser storage.
  }

  return null;
}

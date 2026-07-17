export const PAYMENT_MANUAL_REQUIRED_CODE = "MANUAL_REQUIRED";

export function isPaymentManualRequired(input: {
  status: string;
  reconciledAt: Date | null;
  reconcileErrorSnapshot: unknown;
}) {
  if (input.status !== "OUTCOME_UNKNOWN" || input.reconciledAt === null) {
    return false;
  }

  const snapshot = input.reconcileErrorSnapshot;

  return (
    typeof snapshot === "object" &&
    snapshot !== null &&
    !Array.isArray(snapshot) &&
    "code" in snapshot &&
    snapshot.code === PAYMENT_MANUAL_REQUIRED_CODE
  );
}

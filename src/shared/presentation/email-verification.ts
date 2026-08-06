export type AccountReadiness =
  | { status: "ready" }
  | { status: "pending"; emailVerified: boolean }
  | { status: "merge-conflict" }
  | { status: "unauthorized" }
  | { status: "unavailable" };

export type EmailVerificationResult =
  | { ok: true; kind: "code-sent"; targetEmail: string }
  | { ok: true; kind: "confirmed"; readiness: AccountReadiness }
  | { ok: false; code: string; message: string };

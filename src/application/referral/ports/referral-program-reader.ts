import type { ReferralProgram } from "@/application/models/referral";

export type ReferralProgramAccessReason =
  | "unauthorized"
  | "provider-session-recovery-required"
  | "email-required"
  | "subscription-required"
  | "disabled"
  | "unavailable";

export class ReferralProgramAccessError extends Error {
  constructor(public readonly reason: ReferralProgramAccessReason) {
    super(reason);
  }
}

export interface ReferralProgramReader {
  loadProgram(): Promise<ReferralProgram>;
}

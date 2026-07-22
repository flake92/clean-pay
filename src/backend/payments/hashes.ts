import { sha256 } from "@/backend/security/crypto";

export function paymentUpstreamOwnerHash(upstreamAccountId: string) {
  return sha256(
    `clean-pay:payment-operation:upstream-owner:v1:${upstreamAccountId}`,
  );
}

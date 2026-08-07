import { getServiceRegistry } from "@/backend/services/registry";

export async function claimWebAuthnChallenge(id: string, now?: Date) {
  const { oneTimeStateStore } = getServiceRegistry();
  return oneTimeStateStore.claimWebAuthnChallenge(id, now);
}

export async function claimTelegramAuthState(id: string, now?: Date) {
  const { oneTimeStateStore } = getServiceRegistry();
  return oneTimeStateStore.claimTelegramAuthState(id, now);
}

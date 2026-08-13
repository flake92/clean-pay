import type { ChatwootIdentityGateway } from "@/application/support/ports/chatwoot-identity";

export type ChatwootIdentityVerification =
  | "confirmed"
  | "pending"
  | "rejected"
  | "refresh_required";

export async function verifyChatwootIdentity(
  gateway: ChatwootIdentityGateway,
  expectedUserId: string,
): Promise<ChatwootIdentityVerification> {
  if (
    typeof expectedUserId !== "string"
    || expectedUserId.length === 0
    || expectedUserId.length > 255
  ) {
    return "rejected";
  }

  const actor = await gateway.loadActor();

  if (actor.status === "refresh_required") {
    return "refresh_required";
  }

  if (actor.status !== "authenticated") {
    return "pending";
  }

  if (actor.userId !== expectedUserId) {
    return "rejected";
  }

  const conversationToken = await gateway.loadConversationToken();

  if (!conversationToken) {
    return "pending";
  }

  const probe = await gateway.probeContactIdentity(conversationToken, actor);

  if (probe.status !== "available") {
    return "pending";
  }

  return probe.identifier === actor.userId ? "confirmed" : "pending";
}

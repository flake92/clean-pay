export type ChatwootContactIdentityProbe =
  | { status: "available"; identifier: string | null }
  | { status: "pending" };

export type ChatwootIdentityActor =
  | { status: "authenticated"; userId: string; sessionId: string }
  | { status: "refresh_required" }
  | { status: "anonymous" };

export interface ChatwootIdentityGateway {
  loadActor(): Promise<ChatwootIdentityActor>;
  loadConversationToken(): Promise<string | null>;
  probeContactIdentity(
    conversationToken: string,
    actor: Extract<ChatwootIdentityActor, { status: "authenticated" }>,
  ): Promise<ChatwootContactIdentityProbe>;
}

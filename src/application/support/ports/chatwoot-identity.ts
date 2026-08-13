export type ChatwootContactIdentityProbe =
  | { status: "available"; identifier: string | null }
  | { status: "pending" };

export interface ChatwootIdentityGateway {
  loadActor(): Promise<{ userId: string } | null>;
  loadConversationToken(): Promise<string | null>;
  probeContactIdentity(
    conversationToken: string,
  ): Promise<ChatwootContactIdentityProbe>;
}

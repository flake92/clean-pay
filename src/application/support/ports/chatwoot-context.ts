export type ChatwootContextSubscription = {
  status: string;
  planName: string;
  expiresAt: string;
  isTrial: boolean;
};

export type ChatwootContextPayment = {
  status: string;
  finalAmount: string;
  currency: string;
  gatewayType: string;
  planName: string | null;
  createdAt: string;
};

export type ChatwootContextPaymentSnapshot = {
  records: ChatwootContextPayment[];
  synchronizedAt: string | null;
};

export interface ChatwootContextGateway {
  loadActor(): Promise<{ userId: string } | null>;
  loadSubscription(userId: string): Promise<ChatwootContextSubscription | null>;
  loadRecentPayments(
    userId: string,
    limit: number,
  ): Promise<ChatwootContextPaymentSnapshot>;
}

export interface PaymentOwnerReader { findUpstreamOwnerId(userId: string): Promise<string | null>; }

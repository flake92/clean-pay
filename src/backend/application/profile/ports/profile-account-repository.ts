export interface ProfileAccountRepository { confirmVerifiedEmail(userId: string): Promise<void>; }

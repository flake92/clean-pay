export interface PasskeyAccountReader { hasCredential(email: string): Promise<boolean>; }

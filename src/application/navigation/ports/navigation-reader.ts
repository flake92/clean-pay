export interface NavigationReader {
  load(): Promise<{ authenticated: boolean; emailVerificationRequired: boolean; hasSubscription: boolean; canRenewSubscription: boolean }>;
}

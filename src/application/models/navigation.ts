export type NavigationViewModel = {
  authenticated: boolean;
  emailVerificationRequired: boolean;
  hasSubscription: boolean;
  canRenewSubscription: boolean;
};

export type SupportWidgetIdentity = {
  userId: string;
  email: string | null;
  emailVerified: boolean;
  telegramId: string | null;
  telegramUsername: string | null;
  fullName: string | null;
  displayName: string | null;
};

export type NavigationShellViewModel = {
  navigation: NavigationViewModel;
  supportIdentity: SupportWidgetIdentity | null;
};

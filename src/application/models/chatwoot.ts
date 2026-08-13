export type ChatwootWidgetUser = {
  identifier: string;
  identifierHash: string;
  name: string;
  email: string | null;
  customAttributes: Record<string, string>;
};

export type ChatwootWidgetConfig = {
  baseUrl: string;
  websiteToken: string;
  user: ChatwootWidgetUser;
};

export type ChatwootManagedLabel = {
  name: "payment_problem" | "subscription_expired";
  enabled: boolean;
};

export type ChatwootSupportContext = {
  customAttributes: Record<string, string>;
  managedLabels: ChatwootManagedLabel[];
};

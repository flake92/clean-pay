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

export type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  accessToken?: string;
  refreshToken?: string;
  idempotencyKey?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  allowNotFound?: boolean;
};

export type AuthResponse = {
  data: {
    expires_at: string;
    refresh_expires_at: string;
  };
  cookies: {
    accessToken: string;
    refreshToken: string;
  };
};

export type RemnashopMe = {
  id: number;
  email: string | null;
  is_email_verified: boolean;
  telegram_id: number | null;
  username: string | null;
  name: string | null;
  pending_email: string | null;
};

export type MergeUsersInput = {
  sourceUserId: string;
  targetUserId: string;
  reason: string;
  dryRun?: boolean;
  emailResolution?: "REJECT" | "KEEP_TARGET";
  telegramResolution?: "REJECT" | "KEEP_SOURCE";
  paymentResolution?: "REJECT" | "REKEY_SOURCE";
};

export type MergeResult = {
  dry_run: boolean;
  source_user_id: number;
  target_user_id: number;
  target: {
    id: number;
    email: string | null;
    telegram_id: number | null;
    is_email_verified: boolean;
    current_subscription_id: number | null;
  };
  moved: Record<string, number>;
  conflicts: string[];
  requires_relogin: boolean;
};

export type TokenPair = {
  data: {
    expires_at: string;
    refresh_expires_at: string;
  };
  cookies: {
    accessToken: string;
    refreshToken: string;
  };
};

export type ChangePasswordInput = {
  current_password: string;
  new_password: string;
};

export interface ExternalGateway {
  // Remnashop auth
  remnashopAuth(path: string, body: unknown): Promise<AuthResponse>;
  getRemnashopMe(accessToken: string): Promise<RemnashopMe>;
  remnashopRefreshTokens(refreshToken: string): Promise<TokenPair>;
  remnashopChangePassword(accessToken: string, body: ChangePasswordInput): Promise<void>;
  remnashopLinkTelegram(accessToken: string, telegramId: number): Promise<RemnashopMe>;
  
  // Remnashop admin
  remnashopMergeUsers(input: MergeUsersInput): Promise<MergeResult>;
  
  // Remnashop generic
  remnashopRequest<T>(path: string, opts: RequestOptions): Promise<T>;
  remnashopAdminRequest<T>(path: string, opts: RequestOptions): Promise<T>;
  
  // Remnawave
  remnawaveRequest<T>(path: string, opts: RequestOptions): Promise<T>;
  
  // Telegram OIDC
  exchangeCodeForIdToken(code: string, codeVerifier: string): Promise<string>;
  
  // Turnstile
  verifyTurnstileToken(token: string, action: string): Promise<void>;
}

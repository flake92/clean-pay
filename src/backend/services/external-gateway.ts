export interface AuthResponse {
  data: {
    access_token: string;
    refresh_token: string;
    token_type: string;
    expires_in: number;
    user: RemnashopMe;
  };
  cookies: { accessToken: string; refreshToken: string };
}

export interface ChangePasswordInput {
  current_password: string;
  new_password: string;
}

export interface MergeResult {
  success: boolean;
  message?: string;
  data?: any;
}

export interface MergeUsersInput {
  sourceUserId: string;
  targetUserId: string;
  reason?: string;
  dryRun?: boolean;
  emailResolution?: string;
  telegramResolution?: string;
  paymentResolution?: string;
}

export interface RemnashopMe {
  id: number;
  email?: string;
  telegram_id?: number;
  username?: string;
  balance?: number;
  subscription_end_date?: string;
  [key: string]: any;
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  accessToken?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface TokenPair {
  data: {
    access_token: string;
    refresh_token: string;
  };
  cookies: { accessToken: string; refreshToken: string };
}

export interface ExternalGateway {
  remnashopAuth(path: string, body: unknown): Promise<AuthResponse>;
  getRemnashopMe(accessToken: string): Promise<RemnashopMe>;
  remnashopRefreshTokens(refreshToken: string): Promise<TokenPair>;
  remnashopChangePassword(accessToken: string, body: ChangePasswordInput): Promise<void>;
  remnashopLinkTelegram(accessToken: string, telegramId: number): Promise<RemnashopMe>;
  remnashopMergeUsers(input: MergeUsersInput): Promise<MergeResult>;
  remnashopRequest<T>(path: string, opts: RequestOptions): Promise<T>;
  remnashopAdminRequest<T>(path: string, opts: RequestOptions): Promise<T>;
  remnawaveRequest<T>(path: string, opts: RequestOptions): Promise<T>;
  exchangeCodeForIdToken(code: string, codeVerifier: string): Promise<string>;
  verifyTurnstileToken(token: string, action: string): Promise<void>;
}

export interface ExternalGateway {
  remnashopAuth(path: string, body: unknown): Promise<any>;
  getRemnashopMe(accessToken: string): Promise<any>;
  remnashopRefreshTokens(refreshToken: string): Promise<any>;
  remnashopChangePassword(accessToken: string, body: any): Promise<void>;
  remnashopLinkTelegram(accessToken: string, telegramId: number): Promise<any>;
  remnashopMergeUsers(input: any): Promise<any>;
  remnashopRequest<T>(path: string, opts: any): Promise<T>;
  remnashopAdminRequest<T>(path: string, opts: any): Promise<T>;
  remnawaveRequest<T>(path: string, opts: any): Promise<T>;
  exchangeCodeForIdToken(code: string, codeVerifier: string): Promise<string>;
  verifyTurnstileToken(token: string, action: string): Promise<void>;
}

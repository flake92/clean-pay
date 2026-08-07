import { getEnv } from "@/backend/config/env";
import type {
  AuthResponse,
  ChangePasswordInput,
  ExternalGateway,
  MergeResult,
  MergeUsersInput,
  RemnashopMe,
  RequestOptions,
  TokenPair,
} from "@/backend/services/external-gateway";

export const httpExternalGateway: ExternalGateway = {
  async remnashopAuth(path: string, body: unknown): Promise<AuthResponse> {
    const env = getEnv();
    const url = `${env.remnashopApiBaseUrl}${path}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "x-remnashop-auth-service-key": env.remnashopAuthServiceKey ?? "",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`Remnashop auth failed: ${response.status}`);
    }
    const data = await response.json() as AuthResponse["data"];
    const cookies = extractCookies(response);
    return { data, cookies };
  },

  async getRemnashopMe(accessToken: string): Promise<RemnashopMe> {
    const env = getEnv();
    const url = `${env.remnashopApiBaseUrl}/auth/me`;
    const response = await fetch(url, {
      headers: {
        "accept": "application/json",
        "cookie": `access_token=${accessToken}`,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`Get me failed: ${response.status}`);
    }
    return response.json() as Promise<RemnashopMe>;
  },

  async remnashopRefreshTokens(refreshToken: string): Promise<TokenPair> {
    const env = getEnv();
    const url = `${env.remnashopApiBaseUrl}/auth/refresh`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "accept": "application/json", "cookie": `refresh_token=${refreshToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Refresh failed: ${response.status}`);
    const data = await response.json() as TokenPair["data"];
    const cookies = extractCookies(response);
    return { data, cookies };
  },

  async remnashopChangePassword(accessToken: string, body: ChangePasswordInput): Promise<void> {
    const env = getEnv();
    const url = `${env.remnashopApiBaseUrl}/auth/change-password`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "accept": "application/json", "content-type": "application/json", "cookie": `access_token=${accessToken}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Change password failed: ${response.status}`);
  },

  async remnashopLinkTelegram(accessToken: string, telegramId: number): Promise<RemnashopMe> {
    const env = getEnv();
    const url = `${env.remnashopApiBaseUrl}/auth/telegram/link`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "accept": "application/json", "content-type": "application/json", "cookie": `access_token=${accessToken}` },
      body: JSON.stringify({ telegram_id: telegramId }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Link telegram failed: ${response.status}`);
    return response.json() as Promise<RemnashopMe>;
  },

  async remnashopMergeUsers(input: MergeUsersInput): Promise<MergeResult> {
    const env = getEnv();
    const url = `${env.remnashopAdminApiBaseUrl}/users/merge?dry_run=${input.dryRun ? "true" : "false"}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "x-api-key": env.remnashopApiKey ?? "",
      },
      body: JSON.stringify({
        source_user_id: Number(input.sourceUserId),
        target_user_id: Number(input.targetUserId),
        reason: input.reason,
        email_resolution: input.emailResolution ?? "REJECT",
        telegram_resolution: input.telegramResolution ?? "REJECT",
        payment_resolution: input.paymentResolution ?? "REJECT",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Merge users failed: ${response.status}`);
    return response.json() as Promise<MergeResult>;
  },

  async remnashopRequest<T>(path: string, opts: RequestOptions): Promise<T> {
    const env = getEnv();
    const url = `${env.remnashopApiBaseUrl}${path}`;
    const headers: Record<string, string> = { "accept": "application/json", ...opts.headers };
    if (opts.accessToken) headers["cookie"] = `access_token=${opts.accessToken}`;
    if (opts.body) headers["content-type"] = "application/json";
    const response = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
    if (!response.ok) throw new Error(`Remnashop request failed: ${response.status}`);
    return response.json() as Promise<T>;
  },

  async remnashopAdminRequest<T>(path: string, opts: RequestOptions): Promise<T> {
    const env = getEnv();
    const url = `${env.remnashopAdminApiBaseUrl}${path}`;
    const headers: Record<string, string> = { "accept": "application/json", "x-api-key": env.remnashopApiKey ?? "", ...opts.headers };
    if (opts.body) headers["content-type"] = "application/json";
    const response = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
    if (!response.ok) throw new Error(`Remnashop admin request failed: ${response.status}`);
    return response.json() as Promise<T>;
  },

  async remnawaveRequest<T>(path: string, opts: RequestOptions): Promise<T> {
    const env = getEnv();
    if (!env.remnawave.apiBaseUrl || !env.remnawave.token) {
      throw new Error("Remnawave not configured");
    }
    const url = `${env.remnawave.apiBaseUrl}/api${path}`;
    const headers: Record<string, string> = {
      "accept": "application/json",
      "authorization": env.remnawave.token.startsWith("Bearer ") ? env.remnawave.token : `Bearer ${env.remnawave.token}`,
      ...opts.headers,
    };
    const response = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
    if (!response.ok) throw new Error(`Remnawave request failed: ${response.status}`);
    return response.json() as Promise<T>;
  },

  async exchangeCodeForIdToken(code: string, codeVerifier: string): Promise<string> {
    const env = getEnv();
    const url = env.telegramOidc.tokenEndpoint;
    const clientId = env.telegramOidc.clientId;
    const clientSecret = env.telegramOidc.clientSecret;
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${env.publicAppUrl}/auth/telegram/callback`,
      code_verifier: codeVerifier,
    });
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "authorization": `Basic ${basicAuth}`,
      },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Telegram token exchange failed: ${response.status}`);
    const data = await response.json() as { id_token: string };
    return data.id_token;
  },

  async verifyTurnstileToken(token: string, action: string): Promise<void> {
    const env = getEnv();
    if (!env.turnstile.enabled) return;
    const body = new URLSearchParams({
      secret: env.turnstile.secretKey ?? "",
      response: token,
      remoteip: "",
      sitekey: env.turnstile.siteKey ?? "",
    });
    const response = await fetch(env.turnstile.verifyUrl, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Turnstile verification failed: ${response.status}`);
    const result = await response.json() as { success: boolean };
    if (!result.success) throw new Error("Turnstile verification failed");
  },
};

function extractCookies(response: Response): { accessToken: string; refreshToken: string } {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const accessToken = extractCookieValue(setCookie, "access_token") ?? "";
  const refreshToken = extractCookieValue(setCookie, "refresh_token") ?? "";
  return { accessToken, refreshToken };
}

function extractCookieValue(header: string, name: string): string | null {
  const prefix = `${name}=`;
  const match = header.split(";").find(c => c.trim().startsWith(prefix));
  return match ? match.trim().slice(prefix.length) : null;
}

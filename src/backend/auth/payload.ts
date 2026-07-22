export type TurnstileContext = {
  token?: string | null;
  remoteIp?: string | null;
};

export type AuthPayload<T> = T & {
  turnstileToken?: string | null;
  "cf-turnstile-response"?: string | null;
};

export function stripTurnstile<T extends Record<string, unknown>>(body: AuthPayload<T>) {
  const { turnstileToken, "cf-turnstile-response": cfTurnstileResponse, ...cleanBody } = body;

  return {
    body: cleanBody as T,
    turnstileToken: turnstileToken ?? cfTurnstileResponse ?? null,
  };
}

export function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

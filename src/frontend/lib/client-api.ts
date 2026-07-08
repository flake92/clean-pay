export type BffErrorBody = {
  error?: {
    code?: string;
    message?: string;
    debug?: unknown;
  };
};

export class BffClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly debug?: unknown,
  ) {
    super(message);
  }
}

function isDevelopment() {
  return process.env.NODE_ENV !== 'production';
}

function formatDebug(debug: unknown) {
  if (!debug || !isDevelopment()) {
    return '';
  }

  const separator = String.fromCharCode(10, 10);

  try {
    return separator + 'Dev details:' + String.fromCharCode(10) + JSON.stringify(debug, null, 2);
  } catch {
    return separator + 'Dev details:' + String.fromCharCode(10) + String(debug);
  }
}

function isAuthPage(pathname: string) {
  return (
    pathname === '/login' ||
    pathname === '/register' ||
    pathname === '/auth/telegram/webapp' ||
    pathname.startsWith('/auth/telegram/')
  );
}

function loginUrl() {
  const redirectTo = `${window.location.pathname}${window.location.search}`;
  const url = new URL('/login', window.location.origin);

  if (!isAuthPage(window.location.pathname)) {
    url.searchParams.set('redirect_to', redirectTo);
  }

  return url.toString();
}

export function redirectToLoginOnUnauthorized(error: unknown) {
  if (
    typeof window === 'undefined' ||
    !(error instanceof BffClientError) ||
    error.status !== 401 ||
    (error.code !== undefined && error.code !== 'UNAUTHORIZED') ||
    isAuthPage(window.location.pathname)
  ) {
    return false;
  }

  window.location.replace(loginUrl());

  return true;
}

export async function readBffError(
  response: Response,
  fallback = 'Не удалось выполнить действие.',
) {
  const body = (await response.json().catch(() => null)) as BffErrorBody | null;
  const error = body?.error;
  const message = error?.message ?? fallback;

  const clientError = new BffClientError(
    message + formatDebug(error?.debug),
    response.status,
    error?.code,
    error?.debug,
  );

  redirectToLoginOnUnauthorized(clientError);

  return clientError;
}

export async function apiFetch<T>(url: string, init?: RequestInit, fallback?: string) {
  const response = await fetch(url, init);

  if (!response.ok) {
    throw await readBffError(response, fallback);
  }

  const body = await response.json().catch(() => null);

  return body?.data as T;
}

export function isUnauthorizedError(error: unknown) {
  return error instanceof BffClientError && error.status === 401;
}

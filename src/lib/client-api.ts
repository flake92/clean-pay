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

export async function readBffError(
  response: Response,
  fallback = 'Не удалось выполнить действие.',
) {
  const body = (await response.json().catch(() => null)) as BffErrorBody | null;
  const error = body?.error;
  const message = error?.message ?? fallback;

  return new BffClientError(
    message + formatDebug(error?.debug),
    response.status,
    error?.code,
    error?.debug,
  );
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

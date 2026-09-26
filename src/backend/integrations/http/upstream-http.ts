export class UpstreamResponseTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Upstream response exceeded ${maxBytes} bytes`);
    this.name = "UpstreamResponseTooLargeError";
  }
}

export class UpstreamInvalidJsonError extends Error {
  constructor(cause?: unknown) {
    super("Upstream response was not valid JSON", { cause });
    this.name = "UpstreamInvalidJsonError";
  }
}

export type CredentialedRequestInit = Omit<RequestInit, "redirect"> & {
  redirect?: never;
};

/**
 * Credential-bearing requests must never replay credentials to a redirect
 * target. The final spread position makes the policy non-overridable at
 * runtime as well as through the TypeScript surface.
 */
export function credentialedFetch(
  input: RequestInfo | URL,
  init: CredentialedRequestInit = {},
) {
  return fetch(input, {
    ...init,
    redirect: "error",
  });
}

export async function cancelUpstreamResponseBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // The caller is already rejecting or intentionally discarding the body.
  }
}

function declaredResponseLength(response: Response) {
  const value = response.headers.get("content-length");

  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);

  return Number.isSafeInteger(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

export async function readBoundedResponseText(
  response: Response,
  { maxBytes }: { maxBytes: number },
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError("maxBytes must be a non-negative safe integer");
  }

  const declaredLength = declaredResponseLength(response);
  if (declaredLength !== null && declaredLength > maxBytes) {
    await cancelUpstreamResponseBody(response);
    throw new UpstreamResponseTooLargeError(maxBytes);
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let receivedBytes = 0;
  let text = "";
  let canceled = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return text + decoder.decode();
      }

      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        canceled = true;
        try {
          await reader.cancel();
        } catch {
          // Size rejection wins even when transport cancellation fails.
        }
        throw new UpstreamResponseTooLargeError(maxBytes);
      }

      text += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    if (!canceled) {
      try {
        await reader.cancel();
      } catch {
        // The original read/decode error remains the fail-closed outcome.
      }
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function readBoundedJsonFromUnknown(
  response: Response,
  options: { maxBytes: number },
): Promise<unknown> {
  const text = await readBoundedResponseText(response, options);

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new UpstreamInvalidJsonError(error);
  }
}

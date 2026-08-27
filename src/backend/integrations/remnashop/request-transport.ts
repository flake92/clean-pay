import { getEnv } from "@/backend/config/env";
import { ServiceError } from "@/backend/errors/service-error";
import {
  cancelUpstreamResponseBody,
  credentialedFetch,
  readBoundedResponseText,
  type CredentialedRequestInit,
} from "@/backend/integrations/http/upstream-http";
import {
  normalizeRemnashopError,
  remnashopInvalidJsonError,
  remnashopUnavailableError,
} from "@/backend/integrations/remnashop/errors";
import { decodeRemnashopEndpointResponse } from "@/backend/integrations/remnashop/response-decoders";
import {
  recordUpstreamRequest,
  upstreamOperation,
} from "@/backend/observability/metrics";
import {
  currentRequestTrace,
  tracedHeaders,
  type RequestTrace,
} from "@/backend/observability/request-trace";

export type RemnashopRequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  accessToken?: string;
  refreshToken?: string;
  idempotencyKey?: string;
  timeoutMs?: number;
  allowNotFound?: boolean;
};

export type RemnashopAuthCookies = {
  accessToken: string;
  refreshToken: string;
};

export type RemnashopResponseDecoder<T> = (
  value: unknown,
  response: Response,
) => T;

export type RemnashopResponseContract<T> = {
  decodeResponse: RemnashopResponseDecoder<T>;
  complete?: (data: T, response: Response) => T | Promise<T>;
};

const responseContracts = new WeakMap<object, RemnashopResponseContract<unknown>>();

/**
 * Associates a response contract with this exact options object without adding
 * a field to the provider request or changing the legacy client call shape.
 * The transport consumes the association once, before issuing the request.
 */
export function bindRemnashopResponseContract<
  Options extends object,
  Result,
>(
  options: Options,
  contract: RemnashopResponseContract<Result>,
) {
  responseContracts.set(
    options,
    contract as RemnashopResponseContract<unknown>,
  );
  return options;
}

function takeRemnashopResponseContract<T>(options: object) {
  const contract = responseContracts.get(options);
  responseContracts.delete(options);
  return contract as RemnashopResponseContract<T> | undefined;
}

type RequestObservation = {
  method: string;
  path: string;
  hasBody: boolean;
  trace: RequestTrace;
};

type ResponseObservation = Omit<RequestObservation, "hasBody"> & {
  status: number;
  ok: boolean;
  durationMs: number;
};

type FailureObservation = Omit<RequestObservation, "hasBody"> & {
  durationMs: number;
  error: unknown;
};

export type RemnashopTransportObserver = {
  requestSent(observation: RequestObservation): void;
  responseReceived(observation: ResponseObservation): void;
  requestFailed(observation: FailureObservation): void;
  adminRequestSent(observation: RequestObservation): void;
  adminResponseReceived(observation: ResponseObservation): void;
  adminRequestFailed(observation: FailureObservation): void;
};

type PendingRemnashopMetric = {
  service: "remnashop" | "remnashop_admin";
  operation: string;
  startedAt: number;
};

const MAX_REMNASHOP_RESPONSE_BYTES = 2 * 1024 * 1024;

export function createRemnashopTransport(
  observer: RemnashopTransportObserver,
) {
  const pendingRemnashopMetrics = new WeakMap<
    Response,
    PendingRemnashopMetric
  >();

  function recordRemnashopResponseOutcome(
    response: Response,
    outcome: "success" | "rejected" | "unavailable",
  ) {
    const metric = pendingRemnashopMetrics.get(response);
    if (!metric) {
      return;
    }

    pendingRemnashopMetrics.delete(response);
    recordUpstreamRequest({
      service: metric.service,
      operation: metric.operation,
      outcome,
      durationMs: Date.now() - metric.startedAt,
    });
  }

  function endpoint(path: string) {
    return `${getEnv().remnashopApiBaseUrl}${path}`;
  }

  function safeRequestPath(path: string) {
    return path.split("?", 1)[0] ?? path;
  }

  function adminEndpoint(path: string) {
    return `${getEnv().remnashopAdminApiBaseUrl}${path}`;
  }

  async function readResponseText(response: Response, path: string) {
    try {
      return await readBoundedResponseText(response, {
        maxBytes: MAX_REMNASHOP_RESPONSE_BYTES,
      });
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw remnashopUnavailableError(path, error);
    }
  }

  async function parseResponse<T>(response: Response, path: string) {
    const text = await readResponseText(response, path);
    let data: unknown = null;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        if (!response.ok) {
          throw normalizeRemnashopError(response.status, text, { path });
        }

        throw remnashopInvalidJsonError(path, text);
      }
    }

    if (!response.ok) {
      // Preserve the complete error object so a stable top-level machine code
      // is not discarded merely because the provider also supplied `detail`.
      throw normalizeRemnashopError(response.status, data, { path });
    }

    return data as T;
  }

  async function consumeRemnashopResponse<T, R = T>(
    response: Response,
    path: string,
    {
      method = "GET",
      validateResponse = false,
      decodeResponse,
      complete = (data) => data as unknown as R,
    }: {
      method?: string;
      validateResponse?: boolean;
      decodeResponse?: RemnashopResponseDecoder<T>;
      complete?: (data: T, response: Response) => R | Promise<R>;
    } = {},
  ) {
    try {
      const parsed = await parseResponse<unknown>(response, path);
      let decoded = parsed;
      if (validateResponse || decodeResponse) {
        try {
          decoded = decodeResponse
            ? decodeResponse(parsed, response)
            : decodeRemnashopEndpointResponse(path, method, parsed);
        } catch (error) {
          throw remnashopUnavailableError(path, error);
        }
      }
      const data = decoded as T;
      const result = await complete(data, response);
      recordRemnashopResponseOutcome(response, "success");
      return result;
    } catch (error) {
      recordRemnashopResponseOutcome(
        response,
        response.ok ? "unavailable" : "rejected",
      );
      throw error;
    }
  }

  async function fetchRemnashop(
    path: string,
    init: CredentialedRequestInit,
  ) {
    const method = init.method ?? "GET";
    const startedAt = Date.now();
    const safePath = safeRequestPath(path);
    const operation = upstreamOperation(safePath);
    const trace = await currentRequestTrace();
    const requestInit = {
      ...init,
      headers: tracedHeaders(init.headers, trace),
    };

    if (safePath.startsWith("/auth/")) {
      const serviceKey = getEnv().remnashopAuthServiceKey;
      if (!serviceKey) {
        throw new ServiceError(
          "INTERNAL_ERROR",
          500,
          "REMNASHOP_AUTH_SERVICE_KEY is required for a Remnashop auth request.",
        );
      }
      requestInit.headers = {
        ...requestInit.headers,
        "x-remnashop-auth-service-key": serviceKey,
      };
    }

    observer.requestSent({
      method,
      path: operation,
      hasBody: Boolean(init.body),
      trace,
    });

    try {
      const response = await credentialedFetch(endpoint(path), requestInit);

      const durationMs = Date.now() - startedAt;
      pendingRemnashopMetrics.set(response, {
        service: "remnashop",
        operation,
        startedAt,
      });
      observer.responseReceived({
        method,
        path: operation,
        status: response.status,
        ok: response.ok,
        durationMs,
        trace,
      });

      return response;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      recordUpstreamRequest({
        service: "remnashop",
        operation,
        outcome: "unavailable",
        durationMs,
      });
      observer.requestFailed({
        method,
        path: operation,
        durationMs,
        error,
        trace,
      });
      throw remnashopUnavailableError(operation, error);
    }
  }

  async function fetchRemnashopAdmin(
    path: string,
    init: CredentialedRequestInit,
  ) {
    const method = init.method ?? "GET";
    const startedAt = Date.now();
    const safePath = safeRequestPath(path);
    const operation = upstreamOperation(safePath);
    const requestUrl = adminEndpoint(path);
    const trace = await currentRequestTrace();
    const requestInit = {
      ...init,
      headers: tracedHeaders(init.headers, trace),
    };

    observer.adminRequestSent({
      method,
      path: operation,
      hasBody: Boolean(init.body),
      trace,
    });

    try {
      const response = await credentialedFetch(requestUrl, requestInit);

      const durationMs = Date.now() - startedAt;
      pendingRemnashopMetrics.set(response, {
        service: "remnashop_admin",
        operation,
        startedAt,
      });
      observer.adminResponseReceived({
        method,
        path: operation,
        status: response.status,
        ok: response.ok,
        durationMs,
        trace,
      });

      return response;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      recordUpstreamRequest({
        service: "remnashop_admin",
        operation,
        outcome: "unavailable",
        durationMs,
      });
      observer.adminRequestFailed({
        method,
        path: operation,
        durationMs,
        error,
        trace,
      });
      throw remnashopUnavailableError(operation, error);
    }
  }

  function getSetCookieHeaders(response: Response) {
    const headers = response.headers as Headers & {
      getSetCookie?: () => string[];
    };

    if (typeof headers.getSetCookie === "function") {
      return headers.getSetCookie();
    }

    const singleHeader = response.headers.get("set-cookie");

    return singleHeader ? [singleHeader] : [];
  }

  function getCookieValue(setCookieHeaders: string[], name: string) {
    const prefix = `${name}=`;
    const header = setCookieHeaders.find((item) =>
      item.trim().startsWith(prefix)
    );

    if (!header) {
      return null;
    }

    return header.slice(prefix.length).split(";")[0] ?? null;
  }

  function extractAuthCookies(response: Response): RemnashopAuthCookies {
    const setCookieHeaders = getSetCookieHeaders(response);
    const accessToken = getCookieValue(setCookieHeaders, "access_token");
    const refreshToken = getCookieValue(setCookieHeaders, "refresh_token");

    if (!accessToken || !refreshToken) {
      throw new ServiceError(
        "UPSTREAM_ERROR",
        502,
        "Auth response did not include auth cookies",
        { upstreamPath: "/auth" },
      );
    }

    return { accessToken, refreshToken };
  }

  async function executeRemnashopRequestResult<T>(
    path: string,
    options: RemnashopRequestOptions,
    validateResponse: boolean,
    decodeResponse?: RemnashopResponseDecoder<T>,
  ) {
    const responseContract = takeRemnashopResponseContract<T>(options);
    const headers: Record<string, string> = {
      accept: "application/json",
    };

    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
    }

    if (options.idempotencyKey) {
      headers["idempotency-key"] = options.idempotencyKey;
    }

    if (options.accessToken || options.refreshToken) {
      const cookieParts = [
        options.accessToken ? `access_token=${options.accessToken}` : null,
        options.refreshToken ? `refresh_token=${options.refreshToken}` : null,
      ].filter(Boolean);

      headers.cookie = cookieParts.join("; ");
    }

    const response = await fetchRemnashop(path, {
      method: options.method ?? "GET",
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });

    if (options.allowNotFound && response.status === 404) {
      await cancelUpstreamResponseBody(response);
      recordRemnashopResponseOutcome(response, "rejected");
      return { status: response.status, data: null as T | null };
    }

    return {
      status: response.status,
      data: await consumeRemnashopResponse<T>(
        response,
        upstreamOperation(safeRequestPath(path)),
        {
          method: options.method ?? "GET",
          validateResponse: validateResponse || Boolean(responseContract),
          ...(responseContract?.decodeResponse || decodeResponse
            ? {
                decodeResponse:
                  responseContract?.decodeResponse ?? decodeResponse,
              }
            : {}),
          ...(responseContract?.complete
            ? { complete: responseContract.complete }
            : {}),
        },
      ),
    };
  }

  async function remnashopRequestResult<T>(
    path: string,
    options: RemnashopRequestOptions = {},
  ) {
    return executeRemnashopRequestResult<T>(path, options, false);
  }

  async function remnashopRequest<T>(
    path: string,
    options: RemnashopRequestOptions = {},
  ) {
    const result = await remnashopRequestResult<T>(path, options);

    return result.data as T;
  }

  async function remnashopValidatedRequest<T>(
    path: string,
    options: RemnashopRequestOptions = {},
    decodeResponse?: RemnashopResponseDecoder<T>,
  ) {
    const result = await executeRemnashopRequestResult<T>(
      path,
      options,
      true,
      decodeResponse,
    );

    return result.data as T;
  }

  async function remnashopAdminRequestResult<T>(
    path: string,
    options: Omit<
      RemnashopRequestOptions,
      "accessToken" | "refreshToken"
    > = {},
  ) {
    const responseContract = takeRemnashopResponseContract<T>(options);
    const apiKey = getEnv().remnashopApiKey;

    if (!apiKey) {
      throw new ServiceError(
        "INTERNAL_ERROR",
        500,
        "REMNASHOP_API_KEY is required for an admin Remnashop request.",
      );
    }

    const headers: Record<string, string> = {
      accept: "application/json",
      "x-api-key": apiKey,
    };

    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
    }

    if (options.idempotencyKey) {
      headers["idempotency-key"] = options.idempotencyKey;
    }

    const response = await fetchRemnashopAdmin(path, {
      method: options.method ?? "GET",
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });

    if (options.allowNotFound && response.status === 404) {
      await cancelUpstreamResponseBody(response);
      recordRemnashopResponseOutcome(response, "rejected");
      return { status: response.status, data: null as T | null };
    }

    return {
      status: response.status,
      data: await consumeRemnashopResponse<T>(
        response,
        safeRequestPath(path),
        {
          method: options.method ?? "GET",
          validateResponse: Boolean(responseContract),
          ...(responseContract?.decodeResponse
            ? { decodeResponse: responseContract.decodeResponse }
            : {}),
          ...(responseContract?.complete
            ? { complete: responseContract.complete }
            : {}),
        },
      ),
    };
  }

  return {
    consumeRemnashopResponse,
    extractAuthCookies,
    fetchRemnashop,
    fetchRemnashopAdmin,
    remnashopAdminRequestResult,
    remnashopRequest,
    remnashopRequestResult,
    remnashopValidatedRequest,
    safeRequestPath,
  };
}

export type RemnashopTransport = ReturnType<typeof createRemnashopTransport>;

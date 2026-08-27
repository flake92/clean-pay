import type {
  Page,
  Request,
  Response,
} from "@playwright/test";

import {
  canonicalizeUrl,
  digestValue,
  sanitizeHeaders,
  shortDigest,
} from "./redaction";
import { TURNSTILE_SCRIPT_URL } from "./turnstile-stub";

type RecordedResponse = {
  status: number;
  statusText: string;
  fromServiceWorker: boolean;
  headers: ReturnType<typeof sanitizeHeaders>;
};

type RecordedFailure = {
  errorText: {
    bytes: number;
    sha256: string;
  };
};

export type NetworkManifestEntry = {
  index: number;
  method: string;
  url: ReturnType<typeof canonicalizeUrl>;
  scope: "application" | "external";
  resourceType: string;
  navigation: boolean;
  serverAction: {
    present: boolean;
    identifier: ReturnType<typeof digestValue> | null;
  };
  requestHeaders: ReturnType<typeof sanitizeHeaders>;
  postData: ReturnType<typeof digestValue> | null;
  redirectedFrom: number | null;
  response: RecordedResponse | null;
  failure: RecordedFailure | null;
  externalTransport: "<redacted>" | null;
};

export type NavigationHop = {
  method: string;
  url: ReturnType<typeof canonicalizeUrl>;
  status: number | null;
};

export function recordNetwork(page: Page, applicationOrigin: string) {
  let requestIndex = 0;
  const requests = new Map<Request, NetworkManifestEntry>();
  const rawUrlByEntry = new WeakMap<NetworkManifestEntry, string>();
  const entries: NetworkManifestEntry[] = [];
  const pending: Promise<void>[] = [];

  const handleRequest = (request: Request) => {
    const previous = request.redirectedFrom();
    const nextAction = request.headers()["next-action"];
    const body = request.postDataBuffer();
    const external = new URL(request.url()).origin !== applicationOrigin;
    const entry: NetworkManifestEntry = {
      index: requestIndex,
      method: request.method(),
      url: canonicalizeUrl(request.url(), applicationOrigin),
      scope: external ? "external" : "application",
      resourceType: request.resourceType(),
      navigation: request.isNavigationRequest(),
      serverAction: {
        present: typeof nextAction === "string",
        identifier: nextAction ? digestValue(nextAction) : null,
      },
      requestHeaders: [],
      postData: body
        ? digestValue(external ? "<external-payload-redacted>" : body)
        : null,
      redirectedFrom: previous ? (requests.get(previous)?.index ?? null) : null,
      response: null,
      failure: null,
      externalTransport: external ? "<redacted>" : null,
    };
    requestIndex += 1;
    requests.set(request, entry);
    rawUrlByEntry.set(entry, request.url());
    entries.push(entry);
    pending.push(captureBoundedHeaders(
      request.allHeaders(),
      (headers) => {
          entry.requestHeaders = sanitizeHeaders(
            headers,
            applicationOrigin,
            request.url(),
          );
      },
      (reason) => {
        entry.requestHeaders = [{
          name: "<header-read-error>",
          value: digestValue(reason),
        }];
      },
    ));
  };

  const handleResponse = (response: Response) => {
    const entry = requests.get(response.request());
    if (!entry) return;
    pending.push(captureBoundedHeaders(
      response.allHeaders(),
      (headers) => {
          entry.response = {
            status: response.status(),
            statusText: response.statusText(),
            fromServiceWorker: response.fromServiceWorker(),
            headers: sanitizeHeaders(
              headers,
              applicationOrigin,
              response.url(),
            ),
          };
      },
      (reason) => {
        entry.response = {
          status: response.status(),
          statusText: response.statusText(),
          fromServiceWorker: response.fromServiceWorker(),
          headers: [{
            name: "<header-read-error>",
            value: digestValue(reason),
          }],
        };
      },
    ));
  };

  const handleRequestFailed = (request: Request) => {
    const entry = requests.get(request);
    const failure = request.failure();
    if (!entry || !failure) return;
    entry.failure = {
      errorText: digestValue(failure.errorText),
    };
  };

  page.on("request", handleRequest);
  page.on("response", handleResponse);
  page.on("requestfailed", handleRequestFailed);

  return {
    async finish() {
      page.off("request", handleRequest);
      page.off("response", handleResponse);
      page.off("requestfailed", handleRequestFailed);
      await Promise.allSettled(pending);
      for (const entry of entries) {
        if (isExactDeterministicTurnstileTransport(
          entry,
          applicationOrigin,
          rawUrlByEntry.get(entry) ?? "",
        )) {
          // The exact script request is fulfilled by the deterministic route
          // installed before navigation. Its request remains in-order in the
          // raw manifest; only route-fulfillment response timing is projected.
          entry.response = null;
          entry.failure = null;
        }
      }
      return entries.sort((left, right) => left.index - right.index);
    },
  };
}

function captureBoundedHeaders<T>(
  operation: Promise<T>,
  success: (value: T) => void,
  failure: (reason: string) => void,
) {
  return new Promise<void>((resolve) => {
    let completed = false;
    const finish = (work: () => void) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      work();
      resolve();
    };
    const timer = setTimeout(() => {
      finish(() => failure("bounded header read timeout"));
    }, 5_000);
    operation.then(
      (value) => finish(() => success(value)),
      (error: unknown) => finish(() => failure(
        error instanceof Error ? error.message : String(error),
      )),
    );
  });
}

export function isExactDeterministicTurnstileTransport(
  entry: NetworkManifestEntry,
  applicationOrigin: string,
  rawUrl: string,
) {
  const expectedUrl = canonicalizeUrl(TURNSTILE_SCRIPT_URL, applicationOrigin);
  return rawUrl === TURNSTILE_SCRIPT_URL
    && entry.scope === "external"
    && entry.method === "GET"
    && entry.resourceType === "script"
    && entry.navigation === false
    && entry.serverAction.present === false
    && entry.serverAction.identifier === null
    && entry.postData === null
    && entry.redirectedFrom === null
    && entry.externalTransport === "<redacted>"
    && JSON.stringify(entry.url) === JSON.stringify(expectedUrl);
}

export async function navigationChain(
  finalResponse: Response | null,
  applicationOrigin: string,
): Promise<NavigationHop[]> {
  if (!finalResponse) return [];

  const requests: Request[] = [];
  let request: Request | null = finalResponse.request();
  while (request) {
    requests.unshift(request);
    request = request.redirectedFrom();
  }

  return Promise.all(requests.map(async (chainRequest) => ({
    method: chainRequest.method(),
    url: canonicalizeUrl(chainRequest.url(), applicationOrigin),
    status: (await chainRequest.response())?.status() ?? null,
  })));
}

export function consoleDiagnostic(options: {
  type: string;
  text: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  applicationOrigin: string;
}) {
  return {
    type: options.type,
    message: digestValue(options.text),
    location: options.url
      ? {
          url: canonicalizeUrl(options.url, options.applicationOrigin),
          lineNumber: options.lineNumber ?? 0,
          columnNumber: options.columnNumber ?? 0,
        }
      : null,
  };
}

export function pageErrorDiagnostic(error: Error) {
  return {
    name: error.name,
    message: digestValue(error.message),
    stack: error.stack
      ? { sha256: shortDigest(error.stack), bytes: Buffer.byteLength(error.stack) }
      : null,
  };
}

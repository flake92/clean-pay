import type {
  Frame,
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

type RequestTerminal = {
  promise: Promise<void>;
  resolve: () => void;
  settled: boolean;
};

export function recordNetwork(
  page: Page,
  applicationOrigin: string,
  options: {
    fontTerminalTimeoutMs?: number;
    serverActionGenerationQuietMs?: number;
    serverActionTerminalTimeoutMs?: number;
    serverActionSupersedingNavigationOrigins?: readonly string[];
  } = {},
) {
  const fontTerminalTimeoutMs = options.fontTerminalTimeoutMs ?? 5_000;
  const serverActionGenerationQuietMs = options.serverActionGenerationQuietMs ?? 0;
  const serverActionTerminalTimeoutMs = options.serverActionTerminalTimeoutMs ?? 5_000;
  assertTerminalTimeout("fontTerminalTimeoutMs", fontTerminalTimeoutMs);
  assertGenerationQuietWindow(serverActionGenerationQuietMs);
  assertTerminalTimeout(
    "serverActionTerminalTimeoutMs",
    serverActionTerminalTimeoutMs,
  );
  const supersedingNavigationOrigins = exactSupersedingNavigationOrigins(
    applicationOrigin,
    options.serverActionSupersedingNavigationOrigins ?? [],
  );
  let requestIndex = 0;
  const requests = new Map<Request, NetworkManifestEntry>();
  const rawUrlByEntry = new WeakMap<NetworkManifestEntry, string>();
  const fontTerminals = new Map<Request, RequestTerminal>();
  const serverActionTerminals = new Map<Request, RequestTerminal>();
  const responseHeaders = new Map<Request, Promise<void>>();
  const entries: NetworkManifestEntry[] = [];
  const pending: Promise<void>[] = [];
  let serverActionGeneration = 0;

  const handleRequest = (request: Request) => {
    if (isExactSupersedingNavigation(
      request,
      page,
      supersedingNavigationOrigins,
    )) {
      // A new top-level document makes the preceding client realm unable to
      // consume any still-pending Server Action bytes. Chromium can retain the
      // superseded fetch without emitting response/requestfailed until context
      // close, even though the browser-visible transition is already final.
      // Keep the null response/failure evidence, but release only this exact
      // causal boundary instead of converting it into a timing-dependent hang.
      for (const terminal of serverActionTerminals.values()) terminal.resolve();
    }
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
    if (isExactApplicationFontRequest(request, applicationOrigin)) {
      fontTerminals.set(request, createRequestTerminal());
    }
    const redirectedServerAction = previous !== null
      && serverActionTerminals.has(previous);
    if (redirectedServerAction) {
      // The descendant request proves the preceding redirect hop reached its
      // terminal transition even when Playwright defers requestfinished until
      // the full redirect chain completes.
      serverActionTerminals.get(previous)?.resolve();
    }
    if (
      isExactStartedApplicationServerAction(request, applicationOrigin)
      || redirectedServerAction
    ) {
      serverActionTerminals.set(request, createRequestTerminal());
      serverActionGeneration += 1;
    }
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
    const headerCapture = captureBoundedHeaders(
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
    );
    responseHeaders.set(response.request(), headerCapture);
    pending.push(headerCapture);
    const serverActionTerminal = serverActionTerminals.get(response.request());
    if (serverActionTerminal) {
      // Chromium can expose a completed response body through Response.finished()
      // without emitting page.requestfinished to a listener that was retained
      // across the Server Action's client navigation. The response promise is
      // still the exact transport terminal: both fulfillment and rejection mean
      // that this request can no longer produce bytes. Keep requestfinished and
      // requestfailed as independent terminal signals, but do not leave a
      // completed action permanently pending when that page event is omitted.
      void response.finished().then(
        serverActionTerminal.resolve,
        serverActionTerminal.resolve,
      );
    }
  };

  const handleRequestFinished = (request: Request) => {
    resolveTerminalAfterResponseHeaders(fontTerminals.get(request), request);
    serverActionTerminals.get(request)?.resolve();
  };

  const resolveTerminalAfterResponseHeaders = (
    terminal: RequestTerminal | undefined,
    request: Request,
  ) => {
    if (!terminal) return;
    const headerCapture = responseHeaders.get(request);
    if (!headerCapture) return;
    void headerCapture.finally(terminal.resolve);
  };

  const handleRequestFailed = (request: Request) => {
    const entry = requests.get(request);
    const failure = request.failure();
    if (!entry || !failure) return;
    entry.failure = {
      errorText: digestValue(failure.errorText),
    };
    fontTerminals.get(request)?.resolve();
    serverActionTerminals.get(request)?.resolve();
  };

  const handleFrameNavigated = (frame: Frame) => {
    if (!isExactSupersedingFrameNavigation(
      frame,
      page,
      supersedingNavigationOrigins,
    )) return;
    // A Next.js Server Action may complete by applying its flight response and
    // committing a same-document application navigation. Chromium can then
    // retain the superseded fetch without a requestfinished/requestfailed event.
    // The exact main-frame transition proves that the old client realm can no
    // longer consume action bytes. External origins release it only when the
    // caller explicitly allowlists the isolated destination.
    for (const terminal of serverActionTerminals.values()) terminal.resolve();
  };

  page.on("request", handleRequest);
  page.on("response", handleResponse);
  page.on("requestfinished", handleRequestFinished);
  page.on("requestfailed", handleRequestFailed);
  page.on("framenavigated", handleFrameNavigated);

  const awaitStartedServerActions = async () => {
    const generation = serverActionGeneration;
    const started = [...serverActionTerminals.values()]
      .filter((terminal) => !terminal.settled);
    await waitForTerminalSnapshot(
      started,
      serverActionTerminalTimeoutMs,
      "application Server Action request(s)",
    );
    return generation;
  };
  const isServerActionGenerationCurrent = (generation: number) => (
    Number.isSafeInteger(generation)
      && generation >= 0
      && generation === serverActionGeneration
  );
  const captureStableServerActionCheckpoint = async <T>(
    capture: () => Promise<T>,
  ) => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const generation = await awaitStartedServerActions();
      if (serverActionGenerationQuietMs > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, serverActionGenerationQuietMs);
        });
        if (!isServerActionGenerationCurrent(generation)) continue;
      }
      const captured = await capture();
      if (isServerActionGenerationCurrent(generation)) return captured;
    }
    throw new Error(
      "Journey checkpoint observed a changing Server Action generation during "
      + "three bounded capture attempts.",
    );
  };

  return {
    awaitStartedServerActions,
    captureStableServerActionCheckpoint,
    isServerActionGenerationCurrent,
    async finish() {
      let terminalError: unknown;
      try {
        await waitForFontTerminals(fontTerminals, fontTerminalTimeoutMs);
        await waitForObservedTerminals(
          serverActionTerminals,
          serverActionTerminalTimeoutMs,
          "application Server Action request(s)",
        );
      } catch (error) {
        terminalError = error;
      } finally {
        page.off("request", handleRequest);
        page.off("response", handleResponse);
        page.off("requestfinished", handleRequestFinished);
        page.off("requestfailed", handleRequestFailed);
        page.off("framenavigated", handleFrameNavigated);
      }
      await Promise.allSettled(pending);
      if (terminalError) throw terminalError;
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

function assertGenerationQuietWindow(quietMs: number) {
  if (
    !Number.isSafeInteger(quietMs)
    || quietMs < 0
    || quietMs > 5_000
  ) {
    throw new Error("serverActionGenerationQuietMs must be an integer from 0 to 5000.");
  }
}

function assertTerminalTimeout(name: string, timeoutMs: number) {
  if (
    !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > 30_000
  ) {
    throw new Error(`${name} must be an integer from 1 to 30000.`);
  }
}

function createRequestTerminal(): RequestTerminal {
  let complete!: () => void;
  const terminal: RequestTerminal = {
    promise: new Promise<void>((resolve) => { complete = resolve; }),
    resolve: () => {},
    settled: false,
  };
  terminal.resolve = () => {
    if (terminal.settled) return;
    terminal.settled = true;
    complete();
  };
  return terminal;
}

async function waitForFontTerminals(
  terminals: Map<Request, RequestTerminal>,
  timeoutMs: number,
) {
  await waitForObservedTerminals(
    terminals,
    timeoutMs,
    "application font request(s)",
  );
}

async function waitForObservedTerminals(
  terminals: Map<Request, RequestTerminal>,
  timeoutMs: number,
  description: string,
) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const pendingTerminals = [...terminals.values()]
      .filter((terminal) => !terminal.settled);
    if (pendingTerminals.length === 0) return;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw terminalTimeoutError(pendingTerminals.length, description);
    }
    await waitForTerminalSnapshot(pendingTerminals, remainingMs, description);
  }
}

async function waitForTerminalSnapshot(
  pendingTerminals: RequestTerminal[],
  timeoutMs: number,
  description: string,
) {
  if (pendingTerminals.length === 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(
      terminalTimeoutError(pendingTerminals.length, description),
    ), timeoutMs);
    void Promise.all(pendingTerminals.map((terminal) => terminal.promise)).then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function terminalTimeoutError(count: number, description: string) {
  return new Error(
    `Network recorder timed out waiting for ${count} ${description} `
    + "to reach a terminal state.",
  );
}

function isExactApplicationFontRequest(
  request: Request,
  applicationOrigin: string,
) {
  let url: URL;
  try {
    url = new URL(request.url());
  } catch {
    return false;
  }
  const headers = request.headers();
  return url.origin === applicationOrigin
    && /^\/_next\/static\/media\/[A-Za-z0-9._-]+\.woff2$/.test(url.pathname)
    && url.search === ""
    && url.hash === ""
    && request.method() === "GET"
    && request.resourceType() === "font"
    && request.isNavigationRequest() === false
    && request.postDataBuffer() === null
    && request.redirectedFrom() === null
    && ![
      "authorization",
      "cookie",
      "next-action",
      "proxy-authorization",
      "rsc",
    ].some((name) => typeof headers[name] === "string");
}

function isExactStartedApplicationServerAction(
  request: Request,
  applicationOrigin: string,
) {
  let url: URL;
  try {
    url = new URL(request.url());
  } catch {
    return false;
  }
  return url.origin === applicationOrigin
    && request.method() === "POST"
    && request.resourceType() === "fetch"
    && request.isNavigationRequest() === false
    && request.redirectedFrom() === null
    && typeof request.headers()["next-action"] === "string";
}

function isExactSupersedingNavigation(
  request: Request,
  page: Page,
  allowedOrigins: ReadonlySet<string>,
) {
  let url: URL;
  try {
    url = new URL(request.url());
  } catch {
    return false;
  }
  return allowedOrigins.has(url.origin)
    && request.method() === "GET"
    && request.resourceType() === "document"
    && request.isNavigationRequest() === true
    && request.redirectedFrom() === null
    && request.postDataBuffer() === null
    && typeof request.headers()["next-action"] !== "string"
    && request.frame() === page.mainFrame();
}

function isExactSupersedingFrameNavigation(
  frame: Frame,
  page: Page,
  allowedOrigins: ReadonlySet<string>,
) {
  if (frame !== page.mainFrame()) return false;
  try {
    return allowedOrigins.has(new URL(frame.url()).origin);
  } catch {
    return false;
  }
}

function exactSupersedingNavigationOrigins(
  applicationOrigin: string,
  configuredOrigins: readonly string[],
) {
  const application = exactHttpOrigin(
    applicationOrigin,
    "applicationOrigin",
  );
  if (!Array.isArray(configuredOrigins)) {
    throw new Error(
      "serverActionSupersedingNavigationOrigins must be an array of exact origins.",
    );
  }
  const origins = new Set([application]);
  for (const [index, value] of configuredOrigins.entries()) {
    const origin = exactHttpOrigin(
      value,
      `serverActionSupersedingNavigationOrigins[${index}]`,
    );
    if (origins.has(origin)) {
      throw new Error(
        "serverActionSupersedingNavigationOrigins must not contain duplicate origins.",
      );
    }
    origins.add(origin);
  }
  return origins;
}

function exactHttpOrigin(value: string, name: string) {
  if (typeof value !== "string" || value !== value.trim()) {
    throw new Error(`${name} must be a canonical credential-free HTTP(S) origin.`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a canonical credential-free HTTP(S) origin.`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:")
    || url.username !== ""
    || url.password !== ""
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== ""
    || url.origin !== value
  ) {
    throw new Error(`${name} must be a canonical credential-free HTTP(S) origin.`);
  }
  return url.origin;
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

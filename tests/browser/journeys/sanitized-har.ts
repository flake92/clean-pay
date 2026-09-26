type JsonRecord = Record<string, unknown>;

export type SanitizedHarSource = {
  source: unknown;
  project: string;
  journey: string;
  navigations: unknown[];
  network: {
    requests: unknown[];
    serverActionCount: number;
    serverActions: unknown[];
  };
  providerEffects: unknown;
};

/** Builds a deterministic HAR 1.2 document from the already-redacted recorder. */
export function createSanitizedHarContract(input: SanitizedHarSource) {
  assertHarSource(input);
  return {
    log: {
      version: "1.2",
      creator: {
        name: "Clean Pay browser characterization",
        version: "journey-v5",
      },
      pages: [{
        startedDateTime: "1970-01-01T00:00:00.000Z",
        id: `${input.project}:${input.journey}`,
        title: input.journey,
        pageTimings: {},
      }],
      entries: input.network.requests.map((request) => harEntry(
        request as JsonRecord,
        `${input.project}:${input.journey}`,
      )),
    },
    _cleanPay: input,
  };
}

export function assertSanitizedHarContract(value: unknown): SanitizedHarSource {
  if (!isRecord(value) || !isRecord(value._cleanPay)) {
    throw new Error("Sanitized HAR must include its redacted _cleanPay source contract.");
  }
  const source = value._cleanPay as SanitizedHarSource;
  assertHarSource(source);
  const expected = createSanitizedHarContract(source);
  if (JSON.stringify(expected) !== JSON.stringify(value)) {
    throw new Error("Sanitized HAR fields do not exactly derive from the redacted network contract.");
  }
  return source;
}

function harEntry(request: JsonRecord, pageId: string) {
  const response = isRecord(request.response) ? request.response : null;
  const requestHeaders = Array.isArray(request.requestHeaders)
    ? request.requestHeaders.map(harHeader)
    : [];
  const responseHeaders = response && Array.isArray(response.headers)
    ? response.headers.map(harHeader)
    : [];
  const postData = isRecord(request.postData)
    ? {
        mimeType: "application/octet-stream",
        text: harString(request.postData),
      }
    : undefined;
  return {
    pageref: pageId,
    startedDateTime: "1970-01-01T00:00:00.000Z",
    time: 0,
    request: {
      method: typeof request.method === "string" ? request.method : "<invalid>",
      url: harUrl(request.url),
      httpVersion: "HTTP/2",
      cookies: [],
      headers: requestHeaders,
      queryString: harQuery(request.url),
      headersSize: -1,
      bodySize: isRecord(request.postData)
        && typeof request.postData.bytes === "number"
        ? request.postData.bytes
        : 0,
      ...(postData ? { postData } : {}),
    },
    response: {
      status: response && typeof response.status === "number" ? response.status : 0,
      statusText: response && typeof response.statusText === "string"
        ? response.statusText
        : "",
      httpVersion: "HTTP/2",
      cookies: [],
      headers: responseHeaders,
      content: {
        size: -1,
        mimeType: responseMimeType(responseHeaders),
      },
      redirectURL: responseRedirect(responseHeaders),
      headersSize: -1,
      bodySize: -1,
      _failure: request.failure ?? null,
    },
    cache: {},
    timings: { send: 0, wait: 0, receive: 0 },
    serverIPAddress: "<redacted>",
    connection: "<redacted>",
    _cleanPayRequestIndex: request.index,
  };
}

function harHeader(value: unknown) {
  if (!isRecord(value)) return { name: "<invalid>", value: "<invalid>" };
  return {
    name: typeof value.name === "string" ? value.name : "<invalid>",
    value: harString(value.value),
  };
}

function harUrl(value: unknown) {
  if (!isRecord(value)) return "https://redacted.invalid/<invalid>";
  const origin = value.origin === "<app-origin>"
    ? "https://app.invalid"
    : `https://external.invalid/${encodeURIComponent(harString(value.origin))}`;
  const pathname = typeof value.pathname === "string" && value.pathname.startsWith("/")
    ? value.pathname
    : "/<invalid>";
  const query = harQuery(value);
  const search = query.length
    ? `?${query.map(({ name, value: queryValue }) => (
        `${encodeURIComponent(name)}=${encodeURIComponent(queryValue)}`
      )).join("&")}`
    : "";
  const fragment = value.fragment === null || value.fragment === undefined
    ? ""
    : `#${encodeURIComponent(harString(value.fragment))}`;
  return `${origin}${pathname}${search}${fragment}`;
}

function harQuery(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.query)) return [];
  return value.query.map((entry) => isRecord(entry)
    ? {
        name: typeof entry.key === "string" ? entry.key : "<invalid>",
        value: harString(entry.value),
      }
    : { name: "<invalid>", value: "<invalid>" });
}

function responseMimeType(headers: Array<{ name: string; value: string }>) {
  return headers.find((header) => header.name === "content-type")?.value
    ?? "application/octet-stream";
}

function responseRedirect(headers: Array<{ name: string; value: string }>) {
  return headers.find((header) => header.name === "location")?.value ?? "";
}

function harString(value: unknown) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return JSON.stringify(value);
}

function assertHarSource(value: unknown): asserts value is SanitizedHarSource {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "journey",
      "navigations",
      "network",
      "project",
      "providerEffects",
      "source",
    ])
    || typeof value.project !== "string"
    || typeof value.journey !== "string"
    || !Array.isArray(value.navigations)
    || !isRecord(value.network)
    || !hasExactKeys(value.network, ["requests", "serverActionCount", "serverActions"])
    || !Array.isArray(value.network.requests)
    || !Number.isSafeInteger(value.network.serverActionCount)
    || !Array.isArray(value.network.serverActions)
    || !("source" in value)
    || !("providerEffects" in value)
  ) {
    throw new Error("Sanitized HAR source contract is malformed.");
  }
}

function hasExactKeys(value: JsonRecord, expected: string[]) {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  return actual.length === keys.length
    && actual.every((key, index) => key === keys[index]);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

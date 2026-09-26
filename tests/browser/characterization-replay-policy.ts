import type {
  BrowserContext,
  Page,
  Request as PlaywrightRequest,
} from "@playwright/test";

import { TURNSTILE_SCRIPT_URL } from "./turnstile-stub";

export type CharacterizationRequestPolicyInput = {
  applicationOrigin: string;
  headers: Readonly<Record<string, string | undefined>>;
  method: string;
  resourceType: string;
  url: string;
};

export type CharacterizationReplayGuardEvidence = {
  schemaVersion: 1;
  phase: "capturing" | "draining" | "sealed" | "closed";
  requestCount: number;
  serviceWorkerRequestCount: number;
  serviceWorkerCount: number;
  extraPageCount: number;
  websocketCount: number;
  blockedRequestCount: number;
  activeRequestCount: number;
  violations: Array<{
    kind:
      | "drain-timeout"
      | "extra-page"
      | "extra-page-close-failure"
      | "http-policy"
      | "sealed-request"
      | "service-worker"
      | "service-worker-request"
      | "websocket";
    external?: boolean;
    method?: string;
    nextAction?: boolean;
    resourceType?: string;
  }>;
};

export type CharacterizationReplayGuard = {
  assertNoViolations: () => void;
  bindPrimaryPage: (page: Page) => void;
  detach: () => void;
  drain: (options?: { quietMs?: number; timeoutMs?: number }) => Promise<void>;
  evidence: () => CharacterizationReplayGuardEvidence;
  markContextClosed: () => void;
  seal: () => void;
};

/** Allows only same-origin GETs and the exact credential-free stubbed script. */
export function permitsCharacterizationReplayRequest(
  request: CharacterizationRequestPolicyInput,
) {
  if (
    request.method !== "GET"
    || typeof request.headers["next-action"] === "string"
  ) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(request.url);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  if (parsed.origin === request.applicationOrigin) return true;
  return request.url === TURNSTILE_SCRIPT_URL
    && request.resourceType === "script"
    && ![
      "authorization",
      "cookie",
      "proxy-authorization",
      "set-cookie",
      "x-api-key",
      "x-auth-token",
      "x-csrf-token",
    ].some(
      (name) => typeof request.headers[name] === "string",
    );
}

/**
 * Installs the anonymous characterization transport guard before a page exists.
 * Service Worker activity is always a violation in this suite; PWA behavior is
 * characterized by the isolated journey harness instead.
 */
export async function installCharacterizationReplayGuard(options: {
  applicationOrigin: string;
  context: BrowserContext;
}): Promise<CharacterizationReplayGuard> {
  const { applicationOrigin, context } = options;
  let phase: CharacterizationReplayGuardEvidence["phase"] = "capturing";
  let primaryPage: Page | null = null;
  let requestCount = 0;
  let serviceWorkerRequestCount = 0;
  let serviceWorkerCount = 0;
  let extraPageCount = 0;
  let websocketCount = 0;
  let blockedRequestCount = 0;
  let activityGeneration = 0;
  let pageListenerAttached = false;
  let detached = false;
  const activeRequests = new Set<PlaywrightRequest>();
  const violationKindsByRequest = new WeakMap<PlaywrightRequest, Set<string>>();
  const violations: CharacterizationReplayGuardEvidence["violations"] = [];

  const recordRequestViolation = (
    request: PlaywrightRequest,
    violation: CharacterizationReplayGuardEvidence["violations"][number],
  ) => {
    const seen = violationKindsByRequest.get(request) ?? new Set<string>();
    if (seen.has(violation.kind)) return;
    seen.add(violation.kind);
    violationKindsByRequest.set(request, seen);
    violations.push(violation);
  };
  const onRequest = (request: PlaywrightRequest) => {
    requestCount += 1;
    activityGeneration += 1;
    activeRequests.add(request);
    if (request.serviceWorker() !== null) {
      serviceWorkerRequestCount += 1;
      recordRequestViolation(request, requestViolation(
        "service-worker-request",
        request,
        applicationOrigin,
      ));
    }
    if (phase === "sealed" || phase === "closed") {
      recordRequestViolation(request, requestViolation(
        "sealed-request",
        request,
        applicationOrigin,
      ));
    }
  };
  const onRequestTerminal = (request: PlaywrightRequest) => {
    activityGeneration += 1;
    activeRequests.delete(request);
  };
  const onServiceWorker = () => {
    serviceWorkerCount += 1;
    violations.push({ kind: "service-worker" });
  };
  const onAdditionalPage = (page: Page) => {
    if (page === primaryPage) return;
    extraPageCount += 1;
    violations.push({ kind: "extra-page" });
    void page.close({ reason: "Anonymous characterization forbids additional pages." })
      .catch(() => violations.push({ kind: "extra-page-close-failure" }));
  };

  context.on("request", onRequest);
  context.on("requestfinished", onRequestTerminal);
  context.on("requestfailed", onRequestTerminal);
  context.on("serviceworker", onServiceWorker);

  await context.routeWebSocket(/.*/, async (websocket) => {
    websocketCount += 1;
    violations.push({ kind: "websocket" });
    await websocket.close({
      code: 1008,
      reason: "Anonymous characterization forbids WebSockets.",
    });
  });
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (phase === "sealed" || phase === "closed") {
      blockedRequestCount += 1;
      recordRequestViolation(request, requestViolation(
        "sealed-request",
        request,
        applicationOrigin,
      ));
      await route.abort("blockedbyclient");
      return;
    }
    const permitted = request.serviceWorker() === null
      && requestBelongsToPrimaryPage(request, primaryPage)
      && permitsCharacterizationReplayRequest({
        applicationOrigin,
        headers: request.headers(),
        method: request.method(),
        resourceType: request.resourceType(),
        url: request.url(),
      });
    if (permitted) {
      await route.fallback();
      return;
    }
    blockedRequestCount += 1;
    recordRequestViolation(request, requestViolation(
      request.serviceWorker() === null ? "http-policy" : "service-worker-request",
      request,
      applicationOrigin,
    ));
    await route.abort("blockedbyclient");
  });

  return {
    assertNoViolations() {
      if (violations.length === 0) return;
      const kinds = [...new Set(violations.map((violation) => violation.kind))]
        .sort()
        .join(", ");
      throw new Error(
        `Anonymous characterization replay observed ${violations.length} `
        + `transport violation(s): ${kinds}.`,
      );
    },
    bindPrimaryPage(page) {
      if (primaryPage !== null || page.context() !== context) {
        throw new Error("Characterization replay may bind exactly one page from its context.");
      }
      primaryPage = page;
      context.on("page", onAdditionalPage);
      pageListenerAttached = true;
    },
    detach() {
      if (detached) return;
      detached = true;
      context.off("request", onRequest);
      context.off("requestfinished", onRequestTerminal);
      context.off("requestfailed", onRequestTerminal);
      context.off("serviceworker", onServiceWorker);
      if (pageListenerAttached) context.off("page", onAdditionalPage);
    },
    async drain(drainOptions = {}) {
      if (phase !== "capturing") {
        throw new Error("Characterization replay may drain exactly once after capture.");
      }
      const quietMs = drainOptions.quietMs ?? 100;
      const timeoutMs = drainOptions.timeoutMs ?? 3_000;
      assertDuration("quietMs", quietMs, 10, 1_000);
      assertDuration("timeoutMs", timeoutMs, quietMs, 10_000);
      phase = "draining";
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const observedGeneration = activityGeneration;
        if (activeRequests.size === 0) {
          await delay(quietMs);
          if (
            activeRequests.size === 0
            && activityGeneration === observedGeneration
          ) {
            return;
          }
          continue;
        }
        await delay(Math.min(25, Math.max(1, deadline - Date.now())));
      }
      violations.push({ kind: "drain-timeout" });
      throw new Error(
        `Anonymous characterization replay did not drain within ${timeoutMs}ms.`,
      );
    },
    evidence() {
      return {
        schemaVersion: 1,
        phase,
        requestCount,
        serviceWorkerRequestCount,
        serviceWorkerCount,
        extraPageCount,
        websocketCount,
        blockedRequestCount,
        activeRequestCount: activeRequests.size,
        violations: structuredClone(violations),
      };
    },
    markContextClosed() {
      phase = "closed";
      if (activeRequests.size !== 0) {
        violations.push({ kind: "drain-timeout" });
      }
    },
    seal() {
      if (phase !== "capturing" && phase !== "draining") {
        throw new Error("Characterization replay may be sealed exactly once.");
      }
      phase = "sealed";
    },
  };
}

function requestBelongsToPrimaryPage(
  request: PlaywrightRequest,
  primaryPage: Page | null,
) {
  if (primaryPage === null) return false;
  try {
    return request.frame().page() === primaryPage;
  } catch {
    return false;
  }
}

function requestViolation(
  kind: "http-policy" | "sealed-request" | "service-worker-request",
  request: PlaywrightRequest,
  applicationOrigin: string,
): CharacterizationReplayGuardEvidence["violations"][number] {
  return {
    kind,
    external: requestOrigin(request.url()) !== applicationOrigin,
    method: request.method(),
    nextAction: typeof request.headers()["next-action"] === "string",
    resourceType: request.resourceType(),
  };
}

function requestOrigin(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return "<invalid-origin>";
  }
}

function assertDuration(
  name: string,
  value: number,
  minimum: number,
  maximum: number,
) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

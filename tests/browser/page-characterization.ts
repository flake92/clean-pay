import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import type {
  Page,
  TestInfo,
} from "@playwright/test";

import {
  BEHAVIORAL_BASELINE_COMMIT,
  browserBaselineRoot,
  reconcileBaselineArtifact,
  reconcileProjectedJsonBaselineArtifact,
  sha256,
} from "./baseline-policy";
import {
  projectCharacterizationManifestBytesForComparison,
  projectCharacterizationManifestPairBytesForComparison,
} from "./comparison-projection";
import { reconcileBrowserBaselineProvenance } from "./baseline-provenance";
import {
  navigationChain,
  recordNetwork,
} from "./network-recorder";
import {
  canonicalizeUrl,
  digestValue,
  requireBrowserBaseUrl,
  sanitizeStorageKey,
  shortDigest,
} from "./redaction";
import {
  assertStaticCspSidecarContract,
  consoleBaselineEvidence,
  registerBaselineReconciliation,
  staticCspConsoleSidecarEvidence,
} from "./console-policy";
import { installDeterministicTurnstileStub } from "./turnstile-stub";
import { captureByteIdenticalScreenshotMajority } from "./screenshot-majority";

export type CharacterizationRoute = {
  id: string;
  requestPath: string;
  kind: "public" | "protected-redirect";
};

type CanonicalDomNode = {
  type: "element" | "text";
  tag?: string;
  attributes?: Array<{ name: string; value: string }>;
  children?: CanonicalDomNode[];
  value?: string;
};

type ComputedStyleEntry = {
  path: string;
  tag: string;
  visible: boolean;
  box: { x: number; y: number; width: number; height: number };
  style: Record<string, string>;
};

type InteractiveEntry = {
  path: string;
  tag: string;
  role: string | null;
  text: string;
  ariaLabel: string | null;
  href: string | null;
  visible: boolean;
  disabled: boolean;
  loading: boolean;
};

type RawBrowserStorage = {
  local: Array<{ key: string; value: string }>;
  session: Array<{ key: string; value: string }>;
  cacheNames: string[];
  serviceWorkerScopes: string[];
};

export async function captureCharacterization(options: {
  page: Page;
  route: CharacterizationRoute;
  testInfo: TestInfo;
  validateNavigation?: (finalUrl: URL) => void;
}) {
  const { page, route, testInfo, validateNavigation } = options;
  const baseUrl = requireBrowserBaseUrl();
  const applicationOrigin = baseUrl.origin;
  await installDeterministicTurnstileStub(page);
  const networkRecorder = recordNetwork(page, applicationOrigin);

  const finalResponse = await page.goto(route.requestPath, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForLoadState("load");
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
  await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);

  const screenshot = await captureByteIdenticalScreenshotMajority(page);

  const [
    dom,
    computedStyles,
    interactiveElements,
    ariaSnapshot,
    storage,
    redirects,
  ] = await Promise.all([
    canonicalDom(page),
    selectedComputedStyles(page),
    interactiveState(page),
    page.locator("body").ariaSnapshot(),
    browserStorage(page),
    navigationChain(finalResponse, applicationOrigin),
  ]);
  const network = await networkRecorder.finish();
  const finalUrl = page.url();
  const viewport = page.viewportSize();
  const imageDimensions = pngDimensions(screenshot);

  const cookies = await page.context().cookies();
  const capturedAtEpochSeconds = Math.floor(Date.now() / 1_000);
  const sanitizedCookies = cookies
    .map((cookie) => ({
      name: /^[A-Za-z0-9_.-]{1,80}$/.test(cookie.name)
        ? cookie.name
        : `<sha256:${shortDigest(cookie.name)}>`,
      value: digestValue(cookie.value),
      domain: normalizeCookieDomain(cookie.domain, baseUrl.hostname),
      path: cookie.path,
      expiresInSeconds: cookie.expires === -1
        ? null
        : Math.round((cookie.expires - capturedAtEpochSeconds) / 60) * 60,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
    }))
    .sort((left, right) => `${left.domain}:${left.path}:${left.name}`
      .localeCompare(`${right.domain}:${right.path}:${right.name}`));

  const sanitizedStorage = {
    local: sanitizeStorageEntries(storage.local),
    session: sanitizeStorageEntries(storage.session),
    cacheNames: storage.cacheNames.map(sanitizeStorageKey).sort(),
    serviceWorkerScopes: storage.serviceWorkerScopes
      .map((scope) => canonicalizeUrl(scope, applicationOrigin)),
  };
  const sanitizedAriaSnapshot = sanitizeAriaUrls(ariaSnapshot, applicationOrigin);
  const serverActions = network
    .filter((entry) => entry.serverAction.present)
    .map((entry, order) => ({
      order,
      requestIndex: entry.index,
      method: entry.method,
      url: entry.url,
      identifier: entry.serverAction.identifier,
      payload: entry.postData,
      status: entry.response?.status ?? null,
    }));

  const manifest = {
    schemaVersion: 1,
    baselineCommit: BEHAVIORAL_BASELINE_COMMIT,
    project: testInfo.project.name,
    route: {
      id: route.id,
      kind: route.kind,
      requested: canonicalizeUrl(
        new URL(route.requestPath, applicationOrigin).href,
        applicationOrigin,
      ),
      final: canonicalizeUrl(finalUrl, applicationOrigin),
      redirects,
      finalStatus: finalResponse?.status() ?? null,
    },
    viewport,
    screenshot: {
      width: imageDimensions.width,
      height: imageDimensions.height,
      sha256: sha256(screenshot),
    },
    dom,
    computedStyles,
    ariaSnapshot: sanitizedAriaSnapshot,
    interactiveElements,
    consolePolicy: consoleBaselineEvidence(page),
    browserState: {
      cookies: sanitizedCookies,
      storage: sanitizedStorage,
    },
    network: {
      requests: network,
      serverActionCount: serverActions.length,
      serverActions,
    },
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const actualManifestPath = testInfo.outputPath("characterization.actual.json");
  const actualScreenshotPath = testInfo.outputPath("viewport.actual.png");
  await mkdir(path.dirname(actualManifestPath), { recursive: true });
  await Promise.all([
    writeFile(actualManifestPath, manifestBytes),
    writeFile(actualScreenshotPath, screenshot),
  ]);

  await Promise.all([
    testInfo.attach("characterization.json", {
      path: actualManifestPath,
      contentType: "application/json",
    }),
    testInfo.attach("viewport.png", {
      path: actualScreenshotPath,
      contentType: "image/png",
    }),
  ]);

  validateNavigation?.(new URL(finalUrl));

  registerBaselineReconciliation(page, async () => {
    const normalizedStaticCspViolations = staticCspConsoleSidecarEvidence(page);
    assertStaticCspSidecarContract(
      new URL(route.requestPath, applicationOrigin).pathname,
      normalizedStaticCspViolations,
    );
    const consoleSidecar = Buffer.from(`${JSON.stringify({
      schemaVersion: 1,
      baselineCommit: BEHAVIORAL_BASELINE_COMMIT,
      project: testInfo.project.name,
      route: { id: route.id, kind: route.kind },
      normalizedStaticCspViolations,
    }, null, 2)}\n`);
    const actualConsolePath = testInfo.outputPath("console.actual.json");
    await writeFile(actualConsolePath, consoleSidecar);
    await testInfo.attach("console.json", {
      path: actualConsolePath,
      contentType: "application/json",
    });

    const baselineDirectory = path.join(
      browserBaselineRoot,
      testInfo.project.name,
      route.id,
    );
    const primaryReconciliations = await Promise.allSettled([
      reconcileProjectedJsonBaselineArtifact({
        baselineFile: path.join(baselineDirectory, "characterization.json"),
        actual: manifestBytes,
        project: projectCharacterizationManifestBytesForComparison,
        projectPair: projectCharacterizationManifestPairBytesForComparison,
      }),
      reconcileBaselineArtifact({
        baselineFile: path.join(baselineDirectory, "viewport.png"),
        actual: screenshot,
      }),
    ]);
    const primaryFailures = primaryReconciliations
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (primaryFailures.length) {
      throw new AggregateError(
        primaryFailures,
        `Browser characterization did not match for ${testInfo.project.name}/${route.id}.`,
      );
    }

    // Never publish a new sidecar next to a primary artifact that failed its
    // immutable comparison. This keeps a partial retry distinguishable from
    // an accepted three-part baseline.
    await reconcileBaselineArtifact({
      baselineFile: path.join(baselineDirectory, "console.json"),
      actual: consoleSidecar,
    });
    // Provenance includes the aggregate raw-artifact digest. Reconcile it
    // only after the current route's three immutable artifacts exist so the
    // final route can publish a complete inventory on first capture.
    await reconcileBrowserBaselineProvenance(page);
  });

  return {
    finalUrl: new URL(finalUrl),
    manifest,
  };
}

export async function canonicalDom(page: Page): Promise<CanonicalDomNode | null> {
  return page.evaluate(() => {
    const skippedTags = new Set(["script", "style", "noscript"]);
    const urlAttributeNames = new Set([
      "action",
      "formaction",
      "href",
      "poster",
      "src",
    ]);

    function normalizedText(value: string) {
      return value.replace(/\s+/g, " ").trim();
    }

    function safeUrl(value: string) {
      if (/^(?:data|blob|javascript):/i.test(value)) return "<inline-url>";
      try {
        const parsed = new URL(value, window.location.origin);
        if (parsed.origin !== window.location.origin) return "<external-url>";
        const query = Array.from(parsed.searchParams.keys())
          .map((key) => `${encodeURIComponent(key)}=<value>`)
          .join("&");
        return `${parsed.pathname}${query ? `?${query}` : ""}${parsed.hash ? "#<fragment>" : ""}`;
      } catch {
        return "<invalid-url>";
      }
    }

    function safeAttribute(element: Element, attribute: Attr) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;
      if (/(?:credential|nonce|secret|signature|sitekey|token)/i.test(name)) {
        return "<redacted>";
      }
      if (name === "value") {
        return value ? `<present:${value.length}>` : "";
      }
      if (urlAttributeNames.has(name)) return safeUrl(value);
      if (
        name.startsWith("data-")
        && !/^data-(?:pc|pr)-/.test(name)
      ) {
        return value ? "<present>" : "";
      }
      if (
        name === "id"
        && (/^cf-chl-widget-[a-z0-9]+_response$/i.test(value) || value.length > 80)
      ) {
        return "<opaque-id>";
      }
      if (value.length > 500) return `<long-value:${value.length}>`;
      if (name === "style") return normalizedText(value);
      if (element instanceof HTMLInputElement && name === "autocomplete") {
        return value.toLowerCase();
      }
      return value;
    }

    function visit(node: Node): CanonicalDomNode | null {
      if (node.nodeType === Node.TEXT_NODE) {
        const value = normalizedText(node.textContent ?? "");
        return value ? { type: "text", value } : null;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return null;

      const element = node as Element;
      const tag = element.tagName.toLowerCase();
      if (skippedTags.has(tag)) return null;
      const attributes = Array.from(element.attributes)
        .map((attribute) => ({
          name: attribute.name.toLowerCase(),
          value: safeAttribute(element, attribute),
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
      const children = Array.from(element.childNodes)
        .map(visit)
        .filter((child): child is CanonicalDomNode => child !== null);
      return { type: "element", tag, attributes, children };
    }

    return visit(document.documentElement);
  });
}

export async function selectedComputedStyles(page: Page): Promise<ComputedStyleEntry[]> {
  return page.evaluate(() => {
    function roundValue(value: number) {
      return Math.round(value * 100) / 100;
    }

    function elementIsVisible(element: Element) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity) !== 0
        && rect.width > 0
        && rect.height > 0;
    }

    function elementPath(element: Element) {
      const segments: string[] = [];
      let current: Element | null = element;
      while (current) {
        const tagName = current.tagName;
        const tag = tagName.toLowerCase();
        const siblings = current.parentElement
          ? Array.from(current.parentElement.children).filter(
              (sibling) => sibling.tagName === tagName,
            )
          : [];
        const position = siblings.length > 1
          ? `:nth-of-type(${siblings.indexOf(current) + 1})`
          : "";
        segments.unshift(`${tag}${position}`);
        if (tag === "html") break;
        current = current.parentElement;
      }
      return segments.join(" > ");
    }

    const selector = [
      "body",
      "header",
      "main",
      "nav",
      "footer",
      "section",
      "form",
      "h1",
      "h2",
      "h3",
      "label",
      "input",
      "button",
      "a",
      "[role]",
    ].join(",");
    const properties = [
      "align-items",
      "background-color",
      "border-bottom-color",
      "border-bottom-left-radius",
      "border-bottom-right-radius",
      "border-bottom-style",
      "border-bottom-width",
      "border-left-color",
      "border-left-style",
      "border-left-width",
      "border-right-color",
      "border-right-style",
      "border-right-width",
      "border-top-color",
      "border-top-left-radius",
      "border-top-right-radius",
      "border-top-style",
      "border-top-width",
      "box-shadow",
      "color",
      "display",
      "flex-direction",
      "font-family",
      "font-size",
      "font-weight",
      "gap",
      "justify-content",
      "line-height",
      "margin-bottom",
      "margin-left",
      "margin-right",
      "margin-top",
      "max-width",
      "min-height",
      "opacity",
      "overflow",
      "padding-bottom",
      "padding-left",
      "padding-right",
      "padding-top",
      "position",
      "text-align",
      "visibility",
      "white-space",
      "z-index",
    ];

    return Array.from(document.querySelectorAll<HTMLElement>(selector))
      .slice(0, 250)
      .map((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          path: elementPath(element),
          tag: element.tagName.toLowerCase(),
          visible: elementIsVisible(element),
          box: {
            x: roundValue(rect.x),
            y: roundValue(rect.y),
            width: roundValue(rect.width),
            height: roundValue(rect.height),
          },
          style: Object.fromEntries(
            properties.map((property) => [property, style.getPropertyValue(property)]),
          ),
        };
      });
  });
}

export async function interactiveState(page: Page): Promise<InteractiveEntry[]> {
  return page.evaluate(() => {
    function elementIsVisible(element: Element) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity) !== 0
        && rect.width > 0
        && rect.height > 0;
    }

    function elementPath(element: Element) {
      const segments: string[] = [];
      let current: Element | null = element;
      while (current) {
        const tagName = current.tagName;
        const tag = tagName.toLowerCase();
        const siblings = current.parentElement
          ? Array.from(current.parentElement.children).filter(
              (sibling) => sibling.tagName === tagName,
            )
          : [];
        const position = siblings.length > 1
          ? `:nth-of-type(${siblings.indexOf(current) + 1})`
          : "";
        segments.unshift(`${tag}${position}`);
        if (tag === "html") break;
        current = current.parentElement;
      }
      return segments.join(" > ");
    }

    function sanitizedHref(value: string) {
      try {
        const url = new URL(value, window.location.origin);
        if (url.origin !== window.location.origin) return "<external-url>";
        const query = Array.from(url.searchParams.keys())
          .map((key) => `${encodeURIComponent(key)}=<value>`)
          .join("&");
        return `${url.pathname}${query ? `?${query}` : ""}${url.hash ? "#<fragment>" : ""}`;
      } catch {
        return "<invalid-url>";
      }
    }

    const selector = [
      "button",
      "a",
      "input[type=button]",
      "input[type=submit]",
      "[role=button]",
      "[role=link]",
    ].join(",");

    return Array.from(document.querySelectorAll<HTMLElement>(selector)).map((element) => {
      const disabledProperty = "disabled" in element
        && Boolean((element as HTMLButtonElement | HTMLInputElement).disabled);
      const className = typeof element.className === "string" ? element.className : "";
      const href = element instanceof HTMLAnchorElement
        ? sanitizedHref(element.href)
        : null;
      return {
        path: elementPath(element),
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role"),
        text: (element.textContent ?? "").replace(/\s+/g, " ").trim(),
        ariaLabel: element.getAttribute("aria-label"),
        href,
        visible: elementIsVisible(element),
        disabled: disabledProperty || element.getAttribute("aria-disabled") === "true",
        loading: element.getAttribute("aria-busy") === "true"
          || /(?:^|\s)(?:loading|p-button-loading)(?:\s|$)/i.test(className)
          || Boolean(element.querySelector(
            ".p-button-loading-icon,[data-pc-section=loadingicon],[role=progressbar]",
          )),
      };
    });
  });
}

export async function browserStorage(page: Page): Promise<RawBrowserStorage> {
  return page.evaluate(async () => {
    const readStorage = (storage: Storage) => Array.from(
      { length: storage.length },
      (_, index) => storage.key(index),
    )
      .filter((key): key is string => key !== null)
      .sort()
      .map((key) => ({ key, value: storage.getItem(key) ?? "" }));
    const cacheNames = "caches" in window ? await caches.keys() : [];
    const serviceWorkerScopes = "serviceWorker" in navigator
      ? (await navigator.serviceWorker.getRegistrations()).map((registration) => registration.scope)
      : [];
    return {
      local: readStorage(localStorage),
      session: readStorage(sessionStorage),
      cacheNames,
      serviceWorkerScopes,
    };
  });
}

function sanitizeStorageEntries(entries: Array<{ key: string; value: string }>) {
  return entries
    .map(({ key, value }) => ({
      key: sanitizeStorageKey(key),
      value: digestValue(value),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function normalizeCookieDomain(domain: string, applicationHostname: string) {
  if (domain.replace(/^\./, "") === applicationHostname) return "<app-host>";
  return `<external-domain:${shortDigest(domain)}>`;
}

export function sanitizeAriaUrls(snapshot: string, applicationOrigin: string) {
  return snapshot.replace(
    /^(\s*-\s*\/url:\s*)(.+)$/gm,
    (_line, prefix: string, rawUrl: string) => `${prefix}${JSON.stringify(
      canonicalizeUrl(rawUrl.trim(), applicationOrigin),
    )}`,
  );
}

function pngDimensions(png: Uint8Array) {
  const buffer = Buffer.from(png);
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a" || buffer.length < 24) {
    throw new Error("Playwright returned an invalid PNG screenshot.");
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

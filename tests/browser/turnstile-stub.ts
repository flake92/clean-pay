import type { BrowserContext, Page } from "@playwright/test";

import { sha256 } from "./baseline-policy";

export const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export const TURNSTILE_STUB_CONTRACT = {
  version: 1,
  interceptedUrl: TURNSTILE_SCRIPT_URL,
  request: "GET script only; every near-miss continues to the network",
  api: ["render", "reset", "remove"],
  state: "challenge-pending",
  callbacks: "never invoked",
  token: "never created",
} as const;

export const TURNSTILE_STUB_SOURCE = `(() => {
  "use strict";
  const widgets = new Map();
  let sequence = 0;
  window.turnstile = Object.freeze({
    render(container) {
      sequence += 1;
      const widgetId = "cf-chl-widget-characterization-" + sequence;
      const shell = document.createElement("div");
      const challenge = document.createElement("div");
      const response = document.createElement("input");
      response.id = widgetId + "_response";
      response.name = "cf-turnstile-response";
      response.type = "hidden";
      response.setAttribute("value", "");
      response.style.setProperty("caret-color", "transparent", "important");
      shell.append(challenge, response);
      container.append(shell);
      widgets.set(widgetId, { shell, response });
      return widgetId;
    },
    reset(widgetId) {
      const widget = widgets.get(widgetId);
      if (!widget) return;
      widget.response.value = "";
      widget.response.setAttribute("value", "");
    },
    remove(widgetId) {
      const widget = widgets.get(widgetId);
      if (!widget) return;
      widget.shell.remove();
      widgets.delete(widgetId);
    },
  });
})();
`;

export const TURNSTILE_STUB_SHA256 = sha256(TURNSTILE_STUB_SOURCE);

export async function installDeterministicTurnstileStub(
  target: BrowserContext | Page,
) {
  await target.route(TURNSTILE_SCRIPT_URL, async (route) => {
    const request = route.request();
    if (
      request.url() !== TURNSTILE_SCRIPT_URL
      || request.method() !== "GET"
      || request.resourceType() !== "script"
    ) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/javascript; charset=utf-8",
      headers: {
        "cache-control": "no-store",
        "x-clean-pay-characterization-stub": "turnstile-v1",
      },
      body: TURNSTILE_STUB_SOURCE,
    });
  });
}

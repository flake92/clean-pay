export function assertSyntheticCaddyRouteOrder(source: string) {
  const turnstile = hostBlock(
    source,
    "https://challenges.cloudflare.com {",
    "https://chatwoot.browser.clean-pay.dev {",
  );
  assertOccurrenceCount(turnstile, "    respond 404", 1);
  assertOrderedSingletons(turnstile, [
    "  route {",
    "    reverse_proxy @verify browser-provider-mock:3100",
    "    header @widgetScript Content-Type application/javascript",
    "    respond @widgetScript `(() => {",
    "    })();` 200",
    "    respond 404\n  }\n}",
  ]);

  const chatwoot = source.slice(source.indexOf("https://chatwoot.browser.clean-pay.dev {"));
  if (!chatwoot.startsWith("https://chatwoot.browser.clean-pay.dev {")) {
    throw new Error("Synthetic Chatwoot Caddy host block is missing.");
  }
  assertOccurrenceCount(chatwoot, "    respond 404", 1);
  assertOrderedSingletons(chatwoot, [
    "  route {",
    "    reverse_proxy @contact browser-provider-mock:3100",
    "    header @widget Content-Type text/html",
    "    respond @widget `<!doctype html>",
    "    </script></body></html>` 200",
    "    header @sdk Content-Type application/javascript",
    "    respond @sdk `(() => {",
    "    })();` 200",
    "    respond 404\n  }\n}",
  ]);
  assertOccurrenceCount(chatwoot, "<\\/script>", 0);
  assertOccurrenceCount(chatwoot, "</script>", 1);
  assertOccurrenceCount(chatwoot, "frame.addEventListener(\"load\"", 0);
  assertOccurrenceCount(chatwoot, "        document.body.appendChild(frame);", 1);
  assertOccurrenceCount(chatwoot, "fixture.frame-loaded", 0);
  assertOccurrenceCount(
    chatwoot,
    "        const restoredOwnershipRequiresFrame = document.cookie\n"
      + "          .split(\";\")\n"
      + "          .some((entry) => entry.trim().startsWith(\"cw_conversation=\"))\n"
      + "          && localStorage.getItem(\"clean-pay:chatwoot-ownership:v1\") !== null\n"
      + "          && localStorage.getItem(\"clean-pay:chatwoot-identity:v1\") === null;",
    1,
  );
  assertOccurrenceCount(
    chatwoot,
    "        queueMicrotask(() => window.dispatchEvent(new CustomEvent(\"chatwoot:ready\")));",
    1,
  );
  assertOccurrenceCount(
    chatwoot,
    "          target.postMessage({ method: \"identify\", deliveryId: delivery.deliveryId }, config.baseUrl);",
    1,
  );
  assertOccurrenceCount(chatwoot, "deliverIdentity();", 2);
  assertOccurrenceCount(
    chatwoot,
    "              const observeAfterIdentityRetry = window.cleanPayChatwootPendingIdentity?.phase === \"waiting_for_frame\";\n"
      + "              deliverIdentity();\n"
      + "              const announceFrameLoaded = () => {\n"
      + "                if (announcedFrameWindow !== target && currentFrameWindow() === target) {\n"
      + "                  calls.push({ method: \"frame.loaded\" });\n"
      + "                  announcedFrameWindow = target;\n"
      + "                }\n"
      + "              };\n"
      + "              if (observeAfterIdentityRetry) queueMicrotask(announceFrameLoaded);\n"
      + "              else announceFrameLoaded();\n"
      + "              if (restoredOwnershipRequiresFrame && becameReady) {\n"
      + "                api.hasLoaded = true;\n"
      + "                window.dispatchEvent(new CustomEvent(\"chatwoot:ready\"));\n"
      + "              }",
    1,
  );
  assertOccurrenceCount(chatwoot, "          pendingIdentity = null;", 2);
  assertOccurrenceCount(chatwoot, "          inFlightIdentity = null;", 2);
  assertOccurrenceCount(
    chatwoot,
    "            pendingIdentity = { deliveryId: ++nextDeliveryId, identifier };\n"
      + "            document.cookie = \"cw_conversation=\" + encodeURIComponent(String(identifier)) + \"; Path=/; SameSite=Lax; Secure\";\n"
      + "            document.cookie = \"cw_user_\" + encodeURIComponent(config.websiteToken) + \"=synthetic-chatwoot-user; Path=/; SameSite=Lax; Secure\";\n"
      + "            deliverIdentity();",
    1,
  );
  assertOrderedSingletons(chatwoot, [
    "      const deliveryId = event.data?.deliveryId;",
    "        || !Number.isSafeInteger(deliveryId) || deliveryId < 1) return;",
    "        data: { deliveryId, widgetAuthToken: \"synthetic-widget-auth\" },",
    "    send({ event: \"loaded\" });",
    "        const restoredOwnershipRequiresFrame = document.cookie",
    "          && localStorage.getItem(\"clean-pay:chatwoot-ownership:v1\") !== null",
    "          && localStorage.getItem(\"clean-pay:chatwoot-identity:v1\") === null;",
    "        let readyFrameWindow = null;",
    "        let announcedFrameWindow = null;",
    "        let pendingIdentity = null;",
    "        let inFlightIdentity = null;",
    "        let nextDeliveryId = 0;",
    "        const currentFrameWindow = () => {\n          const current = document.getElementById(\"chatwoot_live_chat_widget\");\n          return current instanceof HTMLIFrameElement ? current.contentWindow : null;\n        };",
    "        const deliverIdentity = () => {\n          const target = currentFrameWindow();",
    "          if (!pendingIdentity || !target || readyFrameWindow !== target) return;",
    "          const delivery = pendingIdentity;\n          pendingIdentity = null;",
    "          inFlightIdentity = { deliveryId: delivery.deliveryId, frameWindow: target };",
    "          target.postMessage({ method: \"identify\", deliveryId: delivery.deliveryId }, config.baseUrl);",
    "        addEventListener(\"message\", (event) => {\n          const target = currentFrameWindow();",
    "          if (event.origin !== config.baseUrl || !target || event.source !== target || typeof event.data !== \"string\") return;",
    "            if (message.event === \"loaded\") {\n              const becameReady = readyFrameWindow !== target;\n              readyFrameWindow = target;",
    "              readyFrameWindow = target;\n              if (inFlightIdentity?.frameWindow !== target) inFlightIdentity = null;\n              const observeAfterIdentityRetry = window.cleanPayChatwootPendingIdentity?.phase === \"waiting_for_frame\";\n              deliverIdentity();",
    "              const announceFrameLoaded = () => {\n                if (announcedFrameWindow !== target && currentFrameWindow() === target) {\n                  calls.push({ method: \"frame.loaded\" });\n                  announcedFrameWindow = target;",
    "              if (observeAfterIdentityRetry) queueMicrotask(announceFrameLoaded);\n              else announceFrameLoaded();",
    "              if (restoredOwnershipRequiresFrame && becameReady) {\n                api.hasLoaded = true;\n                window.dispatchEvent(new CustomEvent(\"chatwoot:ready\"));",
    "              && message.data?.deliveryId === inFlightIdentity.deliveryId) {\n              inFlightIdentity = null;\n              calls.push({ method: \"identity.confirmed\" });",
    "        document.body.appendChild(frame);",
    "        const api = {",
    "          hasLoaded: !restoredOwnershipRequiresFrame,",
    "          setUser(identifier, attributes) {",
    "            pendingIdentity = { deliveryId: ++nextDeliveryId, identifier };",
    "          reset() {\n            calls.push({ method: \"reset\" });\n            pendingIdentity = null;\n            inFlightIdentity = null;\n            api.resetTriggered = true;",
    "        window.$chatwoot = api;\n        if (!restoredOwnershipRequiresFrame) {\n          queueMicrotask(() => window.dispatchEvent(new CustomEvent(\"chatwoot:ready\")));",
  ]);

  return {
    chatwootIdentityDelivery: {
      aboutBlankLoadDeliveryBlocked: true,
      boundaryObservation: "retry-aware-trusted-loaded",
      confirmation: "matching-current-frame-delivery",
      identityDeliverySignal: "trusted-widget-loaded-message",
      readinessSignal: "restored-ownership-frame-gated",
      source: "current-configured-iframe-content-window",
      targetOrigin: "https://chatwoot.browser.clean-pay.dev",
    },
  } as const;
}

export function syntheticChatwootSdkSource(source: string) {
  const chatwoot = source.slice(source.indexOf("https://chatwoot.browser.clean-pay.dev {"));
  const prefix = "    respond @sdk `";
  const start = chatwoot.indexOf(prefix);
  const end = chatwoot.indexOf("` 200", start + prefix.length);
  if (start < 0 || end <= start) {
    throw new Error("Synthetic Chatwoot SDK response body is missing.");
  }
  const sdk = chatwoot.slice(start + prefix.length, end);
  if (!sdk.startsWith("(() => {") || !sdk.endsWith("    })();")) {
    throw new Error("Synthetic Chatwoot SDK response body framing is invalid.");
  }
  return sdk;
}

function assertOccurrenceCount(source: string, marker: string, expected: number) {
  let count = 0;
  let offset = 0;
  while ((offset = source.indexOf(marker, offset)) !== -1) {
    count += 1;
    offset += marker.length;
  }
  if (count !== expected) {
    throw new Error(`Synthetic Caddy route marker count is invalid: ${marker}.`);
  }
}

function hostBlock(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  if (start < 0 || end <= start) throw new Error(`Synthetic Caddy host block ${startMarker} is missing.`);
  return source.slice(start, end);
}

function assertOrderedSingletons(source: string, markers: string[]) {
  let previous = -1;
  for (const marker of markers) {
    const index = source.indexOf(marker);
    if (index <= previous || index < 0 || source.indexOf(marker, index + marker.length) !== -1) {
      throw new Error(`Synthetic Caddy route marker is missing, duplicated, or reordered: ${marker}.`);
    }
    previous = index;
  }
}

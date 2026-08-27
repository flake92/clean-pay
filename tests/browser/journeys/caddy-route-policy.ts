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
  assertOccurrenceCount(
    chatwoot,
    "          frame.contentWindow.postMessage({ method: \"identify\" }, config.baseUrl);",
    1,
  );
  assertOccurrenceCount(chatwoot, "deliverIdentity();", 2);
  assertOccurrenceCount(
    chatwoot,
    "            pendingIdentity = { identifier };\n"
      + "            document.cookie = \"cw_conversation=\" + encodeURIComponent(String(identifier)) + \"; Path=/; SameSite=Lax; Secure\";\n"
      + "            document.cookie = \"cw_user_\" + encodeURIComponent(config.websiteToken) + \"=synthetic-chatwoot-user; Path=/; SameSite=Lax; Secure\";\n"
      + "            deliverIdentity();",
    1,
  );
  assertOrderedSingletons(chatwoot, [
    "        let pendingIdentity = null;",
    "        let frameLoadedAtBaseUrl = false;",
    "          if (!pendingIdentity || !frameLoadedAtBaseUrl || !frame.contentWindow) return;",
    "        addEventListener(\"message\", (event) => {",
    "          if (event.origin !== config.baseUrl || event.source !== frame.contentWindow || typeof event.data !== \"string\") return;",
    "            if (message.event === \"loaded\") {\n              calls.push({ method: \"frame.loaded\" });\n              frameLoadedAtBaseUrl = true;\n              deliverIdentity();\n            }",
    "        document.body.appendChild(frame);",
    "        const api = {",
    "          setUser(identifier, attributes) {",
    "            pendingIdentity = { identifier };",
  ]);

  return {
    chatwootIdentityDelivery: {
      aboutBlankLoadDeliveryBlocked: true,
      readinessSignal: "trusted-widget-loaded-message",
      source: "configured-iframe-content-window",
      targetOrigin: "https://chatwoot.browser.clean-pay.dev",
    },
  } as const;
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

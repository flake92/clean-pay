import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("Chatwoot integration boundaries", () => {
  it("keeps HMAC generation on the server and sends only the derived signature", () => {
    const server = source("src/backend/integrations/support/chatwoot-widget.ts");
    const client = [
      source("src/frontend/lib/chatwoot.ts"),
      source("src/frontend/components/chatwoot-widget.tsx"),
    ].join("\n");

    expect(server).toContain('createHmac("sha256", chatwoot.hmacToken)');
    expect(server).toContain('.digest("hex")');
    expect(client).not.toContain("CHATWOOT_HMAC_TOKEN");
    expect(client).not.toContain("hmacToken");
    expect(client).toContain("identifier_hash: config.user.identifierHash");
  });

  it("mounts the widget only through the authenticated shell and clears guest pages", () => {
    const appShell = source("src/app/_components/app-shell.tsx");
    const authShell = source("src/frontend/components/auth-shell.tsx");

    expect(appShell).toContain("createChatwootWidgetConfig(shell.supportIdentity)");
    expect(appShell).toContain("<ChatwootWidget config={chatwoot} />");
    expect(appShell).toContain("<ChatwootGuestBoundary />");
    expect(authShell).toContain("<ChatwootGuestBoundary />");
    expect(authShell).not.toContain('"use client"');
  });

  it("resets the third-party session before every explicit Clean Pay session exit", () => {
    for (const [path, exitCall] of [
      ["src/frontend/layout/useCleanPayMenu.ts", "logoutAction()"],
      ["src/frontend/components/cabinet-panel.tsx", "logoutAction()"],
      ["src/frontend/components/register-email-confirm-form.tsx", "clearSessionAction()"],
    ] as const) {
      const file = source(path);
      const resetIndex = file.indexOf("resetChatwootSession()");
      const exitIndex = file.indexOf(exitCall);

      expect(resetIndex, path).toBeGreaterThan(-1);
      expect(exitIndex, path).toBeGreaterThan(resetIndex);
    }
  });

  it("opens CSP only when the complete server configuration is present", () => {
    const proxy = [
      source("src/proxy.ts"),
      source("src/shared/edge/proxy-security-policy.ts"),
    ].join("\n");

    expect(proxy).toContain("process.env.CHATWOOT_BASE_URL?.trim()");
    expect(proxy).toContain("process.env.CHATWOOT_WEBSITE_TOKEN?.trim()");
    expect(proxy).toContain("process.env.CHATWOOT_HMAC_TOKEN?.trim()");
    expect(proxy).toContain("buildContentSecurityPolicy");
  });

  it("loads extra support context through an authenticated server action", () => {
    const component = source("src/frontend/components/chatwoot-widget.tsx");
    const action = source("src/app/actions/chatwoot.ts");
    const adapter = source("src/backend/integrations/support/chatwoot-context-gateway.ts");

    expect(component).toContain("loadChatwootSupportContextCached(");
    expect(component).toContain(
      "loadChatwootSupportContextAction(config.user.identifier)",
    );
    expect(component).not.toMatch(/\bfetch\s*\(/);
    expect(action).toContain("loadChatwootSupportContext(");
    expect(action).toContain("productionChatwootContextGateway,");
    expect(action).toContain("expectedUserId,");
    expect(adapter).toContain('where: { userId }');
    expect(adapter).not.toContain("paymentUrl");
    expect(adapter).not.toContain("subscription.url");
  });

  it("keeps the Chatwoot state machine inside the enforced frontend coverage gate", () => {
    const coverage = source("config/vitest/frontend.mts");

    for (const path of [
      "tests/unit/frontend/chatwoot-client.test.ts",
      "tests/unit/frontend/chatwoot-widget.test.ts",
      "src/frontend/components/chatwoot-widget.tsx",
      "src/frontend/lib/chatwoot.ts",
    ]) {
      expect(coverage, path).toContain(`\"${path}\"`);
    }

    expect(coverage).toContain(
      '\"src/frontend/components/chatwoot-widget.tsx\": {',
    );
    expect(coverage).toContain('\"src/frontend/lib/chatwoot.ts\": {');
  });

  it("keeps extracted Chatwoot modules inside equivalent coverage gates", () => {
    const coverage = source("config/vitest/frontend.mts");
    const componentModules = [
      "src/frontend/components/chatwoot-widget-controller.ts",
      "src/frontend/components/chatwoot-widget-state.ts",
    ];
    const clientModules = [
      "src/frontend/lib/chatwoot-context-cache.ts",
      "src/frontend/lib/chatwoot-contract.ts",
      "src/frontend/lib/chatwoot-storage.ts",
      "src/frontend/lib/chatwoot-transitions.ts",
      "src/frontend/lib/chatwoot-transport.ts",
    ];

    for (const path of [...componentModules, ...clientModules]) {
      expect(existsSync(path), path).toBe(true);
      expect(coverage, path).toContain(`\"${path}\"`);
      expect(coverage, `${path} threshold`).toContain(`\"${path}\": {`);
    }

    for (const path of componentModules) {
      const threshold = coverage.slice(coverage.indexOf(`\"${path}\": {`));
      expect(threshold).toContain("statements: 83");
      expect(threshold).toContain("branches: 80");
      expect(threshold).toContain("functions: 85");
      expect(threshold).toContain("lines: 83");
    }
    for (const path of clientModules) {
      const threshold = coverage.slice(coverage.indexOf(`\"${path}\": {`));
      expect(threshold).toContain("statements: 85");
      expect(threshold).toContain("branches: 78");
      expect(threshold).toContain("functions: 96");
      expect(threshold).toContain("lines: 85");
    }
  });

  it("keeps transport, storage, and pure Chatwoot transitions separated", () => {
    const component = source("src/frontend/components/chatwoot-widget.tsx");
    const controller = source(
      "src/frontend/components/chatwoot-widget-controller.ts",
    );
    const transitions = source("src/frontend/lib/chatwoot-transitions.ts");
    const transport = source("src/frontend/lib/chatwoot-transport.ts");
    const storage = source("src/frontend/lib/chatwoot-storage.ts");

    expect(component).toContain("useChatwootWidgetController(config");
    expect(component).not.toContain("setInterval(");
    expect(component).not.toContain("addEventListener(");
    expect(controller).toContain('window.addEventListener("message"');
    expect(transitions).not.toMatch(/\b(?:window|document|localStorage)\b/);
    expect(transport).toContain('document.createElement("script")');
    expect(storage).toContain("window.localStorage");
  });

  it("uses only the official Chatwoot launcher", () => {
    const component = source("src/frontend/components/chatwoot-widget.tsx");
    const layout = source("src/frontend/styles/layout/layout.scss");

    expect(component).not.toContain("clean-pay-chatwoot-launcher");
    expect(component).not.toContain("clean-pay:chatwoot-open");
    expect(component).toContain("return null;");
    expect(layout).not.toContain('@use "./chatwoot"');
    expect(existsSync("src/frontend/styles/layout/_chatwoot.scss")).toBe(false);
  });
});

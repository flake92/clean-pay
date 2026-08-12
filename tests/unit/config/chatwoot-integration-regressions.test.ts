import { readFileSync } from "node:fs";

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
    const authShell = source("src/frontend/components/layout/auth-shell.tsx");

    expect(appShell).toContain("createChatwootWidgetConfig(shell.supportIdentity)");
    expect(appShell).toContain("<ChatwootWidget config={chatwoot} />");
    expect(appShell).toContain("<ChatwootGuestBoundary />");
    expect(authShell).toContain("<ChatwootGuestBoundary />");
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
    const proxy = source("src/proxy.ts");

    expect(proxy).toContain("process.env.CHATWOOT_BASE_URL?.trim()");
    expect(proxy).toContain("process.env.CHATWOOT_WEBSITE_TOKEN?.trim()");
    expect(proxy).toContain("process.env.CHATWOOT_HMAC_TOKEN?.trim()");
    expect(proxy).toContain("buildContentSecurityPolicy");
  });
});

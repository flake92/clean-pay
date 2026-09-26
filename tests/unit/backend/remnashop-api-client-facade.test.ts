import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as apiClient from "@/backend/integrations/remnashop/api-client";
import * as compatibilityClient from "@/backend/integrations/remnashop/client";

const expectedExports = [
  "getJwtExpiresAt",
  "getRemnashopMe",
  "getRemnashopNotificationPreferences",
  "getRemnashopUserIdFromAccessToken",
  "protectRemnashopToken",
  "remnashopAdminRequestResult",
  "remnashopAuth",
  "remnashopAuthTelegramIdentity",
  "remnashopChangePassword",
  "remnashopCreateServiceSession",
  "remnashopIdentifyEmail",
  "remnashopLinkTelegram",
  "remnashopMergeUsers",
  "remnashopRefreshTokens",
  "remnashopRequest",
  "remnashopRequestPasswordReset",
  "remnashopRequestResult",
  "revealRemnashopToken",
  "updateRemnashopNotificationPreferences",
] as const;

const expectedCompatibilityExports = [
  "getAuthorizedRemnashopTokens",
  ...expectedExports,
  "recoverRemnashopTelegramSession",
].sort();

describe("Remnashop API client facade", () => {
  it("preserves every runtime export through both supported import paths", () => {
    expect(Object.keys(apiClient).sort()).toEqual(expectedExports);
    expect(Object.keys(compatibilityClient).sort()).toEqual(
      expectedCompatibilityExports,
    );
    for (const name of expectedExports) {
      expect(apiClient[name], name).toBeTypeOf("function");
      expect(compatibilityClient[name], name).toBe(apiClient[name]);
    }
  });

  it("keeps request mechanics and endpoint implementations behind the facade", () => {
    const facade = readFileSync(
      "src/backend/integrations/remnashop/api-client.ts",
      "utf8",
    );
    const transport = readFileSync(
      "src/backend/integrations/remnashop/request-transport.ts",
      "utf8",
    );
    const runtime = readFileSync(
      "src/backend/integrations/remnashop/api-client-runtime.ts",
      "utf8",
    );

    expect(runtime).toContain("createRemnashopTransport");
    expect(facade).toContain("remnashopTransport");
    expect(facade).toContain("createRemnashopEndpointOperations");
    expect(facade).not.toMatch(
      /credentialedFetch|readBoundedResponseText|decodeRemnashopEndpointResponse/,
    );
    expect(transport).not.toContain("endpoint-operations");
  });
});

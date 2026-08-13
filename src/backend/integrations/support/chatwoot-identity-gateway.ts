import { cookies } from "next/headers";

import type { ChatwootIdentityGateway } from "@/application/support/ports/chatwoot-identity";
import { getEnv } from "@/backend/config/env";
import { getCurrentSessionReadOnly } from "@/backend/integrations/sessions/web-session-service";

const conversationCookieName = "cw_conversation";
const contactProbeTimeoutMs = 3_000;
const maxContactResponseBytes = 4_096;

function validConversationToken(value: string | undefined) {
  const token = value?.trim();

  if (
    !token
    || token.length > 2_048
    || !/^[A-Za-z0-9._-]+$/.test(token)
  ) {
    return null;
  }

  return token;
}

async function readBoundedResponseText(response: Response) {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let body = "";

  try {
    while (true) {
      const chunk = await reader.read();

      if (chunk.done) {
        body += decoder.decode();
        return body;
      }

      bytesRead += chunk.value.byteLength;
      if (bytesRead > maxContactResponseBytes) {
        await reader.cancel();
        return null;
      }

      body += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

async function readContactIdentifier(response: Response) {
  const body = await readBoundedResponseText(response);

  if (body === null) {
    return { status: "pending" } as const;
  }

  try {
    const parsed = JSON.parse(body) as { identifier?: unknown };

    if (parsed.identifier === null || typeof parsed.identifier === "undefined") {
      return { status: "available", identifier: null } as const;
    }

    return typeof parsed.identifier === "string"
      ? { status: "available", identifier: parsed.identifier } as const
      : { status: "pending" } as const;
  } catch {
    return { status: "pending" } as const;
  }
}

export const productionChatwootIdentityGateway: ChatwootIdentityGateway = {
  async loadActor() {
    // AppShell mounts the widget only after the same read-only access-session
    // check. Do not rotate a one-time refresh token from a bounded polling
    // action; a navigation refresh route owns that state change.
    const session = await getCurrentSessionReadOnly();

    return session ? { userId: session.userId } : null;
  },

  async loadConversationToken() {
    const cookieStore = await cookies();

    return validConversationToken(
      cookieStore.get(conversationCookieName)?.value,
    );
  },

  async probeContactIdentity(conversationToken) {
    const chatwoot = getEnv().chatwoot;

    if (!chatwoot) {
      return { status: "pending" };
    }

    const endpoint = new URL("/api/v1/widget/contact", chatwoot.baseUrl);
    endpoint.searchParams.set("website_token", chatwoot.websiteToken);

    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Auth-Token": conversationToken,
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(contactProbeTimeoutMs),
      });

      if (!response.ok) {
        await response.body?.cancel();
        return { status: "pending" };
      }

      return readContactIdentifier(response);
    } catch {
      return { status: "pending" };
    }
  },
};

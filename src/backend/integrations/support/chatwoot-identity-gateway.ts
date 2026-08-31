import { cookies } from "next/headers";

import type { ChatwootIdentityGateway } from "@/application/support/ports/chatwoot-identity";
import { getEnv } from "@/backend/config/env";
import {
  getCurrentRefreshSessionCandidateReadOnly,
  getCurrentSessionReadOnly,
} from "@/backend/integrations/sessions/web-session-service";
import type { createChatwootIdentityRequestGuard } from "@/backend/integrations/support/chatwoot-identity-request-guard";
import { logger } from "@/backend/observability/logger";
import { recordUpstreamRequest } from "@/backend/observability/metrics";
import {
  credentialedFetch,
  readBoundedResponseText,
  UpstreamResponseTooLargeError,
} from "@/backend/integrations/http/upstream-http";

const conversationCookieName = "cw_conversation";
const contactProbeTimeoutMs = 3_000;
const maxContactResponseBytes = 4_096;
const contactProbeOperation = "/api/v1/widget/contact";

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

async function readContactIdentifier(response: Response) {
  let body: string;
  try {
    body = await readBoundedResponseText(response, {
      maxBytes: maxContactResponseBytes,
    });
  } catch (error) {
    if (error instanceof UpstreamResponseTooLargeError) {
      return { status: "pending" } as const;
    }
    throw error;
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

type ChatwootIdentityRequestGuard = Pick<
  ReturnType<typeof createChatwootIdentityRequestGuard>,
  "runProbe"
>;

export function createProductionChatwootIdentityGateway(
  requestGuard: ChatwootIdentityRequestGuard,
): ChatwootIdentityGateway {
  return {
  async loadActor() {
    // AppShell mounts the widget only after the same read-only access-session
    // check. Do not rotate a one-time refresh token from a bounded polling
    // action; a navigation refresh route owns that state change.
    const session = await getCurrentSessionReadOnly();

    if (session) {
      return {
        status: "authenticated",
        userId: session.userId,
        sessionId: session.id,
      };
    }

    const refreshCandidate = await getCurrentRefreshSessionCandidateReadOnly();

    return refreshCandidate
      ? { status: "refresh_required" }
      : { status: "anonymous" };
  },

  async loadConversationToken() {
    const cookieStore = await cookies();

    return validConversationToken(
      cookieStore.get(conversationCookieName)?.value,
    );
  },

  async probeContactIdentity(conversationToken, actor) {
    const chatwoot = getEnv().chatwoot;

    if (!chatwoot) {
      return { status: "pending" };
    }

    const endpoint = new URL("/api/v1/widget/contact", chatwoot.baseUrl);
    endpoint.searchParams.set("website_token", chatwoot.websiteToken);

    try {
      return await requestGuard.runProbe({
        sessionId: actor.sessionId,
        conversationToken,
        work: async () => {
          const startedAt = Date.now();

          try {
            const response = await credentialedFetch(endpoint, {
              method: "GET",
              headers: {
                Accept: "application/json",
                "X-Auth-Token": conversationToken,
              },
              cache: "no-store",
              signal: AbortSignal.timeout(contactProbeTimeoutMs),
            });

            if (!response.ok) {
              const durationMs = Date.now() - startedAt;
              recordUpstreamRequest({
                service: "chatwoot",
                operation: contactProbeOperation,
                outcome: "rejected",
                durationMs,
              });
              logger.warn("chatwoot_identity_probe_rejected", {
                status: response.status,
                durationMs,
              }, {
                category: "upstream",
                source: "chatwoot.identity",
                message: `Chatwoot identity probe rejected: GET ${contactProbeOperation} -> ${response.status}`,
              });
              try {
                await response.body?.cancel();
              } catch {
                // The HTTP rejection is already classified and fail-closed.
                // A broken response stream must not emit a second,
                // contradictory "unavailable" outcome for the same probe.
              }
              return { status: "pending" } as const;
            }

            // Await inside this try so a stream that fails after the response
            // headers is still converted into the same fail-closed state.
            const result = await readContactIdentifier(response);
            const durationMs = Date.now() - startedAt;
            const identityAvailable = result.status === "available";
            recordUpstreamRequest({
              service: "chatwoot",
              operation: contactProbeOperation,
              outcome: identityAvailable ? "success" : "rejected",
              durationMs,
            });
            if (identityAvailable) {
              logger.info("chatwoot_identity_probe_completed", {
                durationMs,
                identityAvailable: true,
                identityMatchesActor: result.identifier === actor.userId,
              }, {
                category: "upstream",
                source: "chatwoot.identity",
                message: `Chatwoot identity probe completed: GET ${contactProbeOperation}`,
              });
            } else {
              logger.warn("chatwoot_identity_probe_response_invalid", {
                durationMs,
              }, {
                category: "upstream",
                source: "chatwoot.identity",
                message: `Chatwoot identity probe returned an invalid response: GET ${contactProbeOperation}`,
              });
            }
            return result;
          } catch (error) {
            const durationMs = Date.now() - startedAt;
            recordUpstreamRequest({
              service: "chatwoot",
              operation: contactProbeOperation,
              outcome: "unavailable",
              durationMs,
            });
            logger.warn("chatwoot_identity_probe_unavailable", {
              durationMs,
              errorName: error instanceof Error ? error.name : "UnknownError",
            }, {
              category: "upstream",
              source: "chatwoot.identity",
              message: `Chatwoot identity probe unavailable: GET ${contactProbeOperation}`,
            });
            return { status: "pending" } as const;
          }
        },
      });
    } catch {
      return { status: "pending" };
    }
    },
  };
}

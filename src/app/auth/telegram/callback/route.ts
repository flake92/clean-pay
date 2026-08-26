import { NextResponse } from "next/server";

import {
  completeResolvedTelegramCallback,
  completeTelegramCallback,
  resolveVerifiedTelegramIdentity,
} from "@/application/auth/complete-telegram-callback";
import {
  TelegramCallbackError,
  type ConsumedTelegramCallback,
  type TelegramCallbackOutcome,
  type VerifiedTelegramCallback,
} from "@/application/auth/ports/telegram-callback";
import { getEnv } from "@/backend/config/env";
import { ServiceError } from "@/backend/errors/service-error";
import {
  productionTelegramCallbackGateway,
} from "@/app/_composition/session-gateways";
import {
  completedTelegramCallbackDestination,
  setTelegramCallbackReceipt,
} from "@/backend/integrations/telegram/callback-receipt";
import {
  checkpointDurableTelegramIdentityResolved,
  checkpointDurableTelegramOutcome,
  checkpointDurableTelegramRecoveryCommitted,
  completeDurableTelegramMerge,
  completeDurableTelegramSession,
  createDurableTelegramCallbackSession,
  failDurableTelegramCallback,
  loadDurableTelegramCallback,
  markDurableTelegramRecoveryDispatching,
  releaseDurableTelegramCallback,
  runWithDurableTelegramCallbackLease,
  type DurableTelegramCallbackCheckpoint,
  type DurableTelegramCallbackOwnership,
  type DurableTelegramCallbackReplay,
} from "@/backend/integrations/telegram/durable-callback";
import { recoverRemnashopTelegramSession } from "@/app/_composition/telegram-session-recovery";
import {
  telegramAccountMergeCookieMaxAgeSeconds,
  telegramAccountMergeCookieName,
} from "@/backend/integrations/auth/telegram-account-merge-store";
import {
  createWebSessionOnResponse,
  getCurrentSession,
  setDurableCallbackReplayCookies,
} from "@/backend/integrations/sessions/web-session-service";
import { revokeWebSessionById } from "@/backend/integrations/sessions/web-session-revocation";
import { readTelegramPopupRequest } from "@/backend/integrations/telegram/popup-request";
import {
  clearTelegramAuthCookiesOnResponse,
  readTelegramCallbackCookieProof,
  resumeTelegramOidcCodeExchange,
  resumeTelegramProviderAuthentication,
  TelegramAuthStateAlreadyConsumedError,
} from "@/backend/integrations/telegram/oidc";
import { validateRequestSource } from "@/backend/security/csrf";
import {
  logTechnicalError,
  logTechnicalInfo,
  logTechnicalWarning,
} from "@/backend/observability/audit";
import { clearReferralAttributionCookieOnResponse } from "@/backend/integrations/referral/referral-attribution";
import { safeRedirectPath } from "@/shared/auth/redirect-policy";

export const runtime = "nodejs";

function noStore<T extends Response>(response: T) {
  response.headers.set("cache-control", "no-store");
  return response;
}

function redirectTo(path: string) {
  return noStore(
    NextResponse.redirect(new URL(path, getEnv().publicAppUrl)),
  );
}

function callbackDestination(path: string) {
  return safeRedirectPath(path) ?? "/cabinet";
}

const durableFailureDestinations = new Set([
  "/login?auth=telegram_failed",
  "/login?auth=telegram_recovery_required",
  "/link-account?auth=telegram_failed",
  "/link-account?auth=telegram_merge_required",
  "/link-account?auth=telegram_merge_subscriptions",
]);

function durableFailureDestination(path: string) {
  return durableFailureDestinations.has(path)
    ? path
    : "/login?auth=telegram_failed";
}

function setMergeConfirmationCookie(response: NextResponse, token: string) {
  const env = getEnv();
  response.cookies.set(telegramAccountMergeCookieName, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/",
    maxAge: telegramAccountMergeCookieMaxAgeSeconds,
  });
}

async function applyCallbackOutcome(
  response: NextResponse,
  outcome: TelegramCallbackOutcome,
) {
  if (outcome.mergeConfirmation) {
    setMergeConfirmationCookie(response, outcome.mergeConfirmation.token);
    return undefined;
  }

  if (!outcome.session) {
    throw new Error("Telegram callback completed without a session result");
  }

  const session = await createWebSessionOnResponse(
    response,
    outcome.session.userId,
    outcome.session.remnashopSession
      ? { remnashopSession: outcome.session.remnashopSession }
      : undefined,
  );

  if (outcome.session.requiresTelegramRecovery) {
    try {
      await recoverRemnashopTelegramSession(session.id, outcome.session.userId);
    } catch (error) {
      try {
        await revokeWebSessionById(session.id, outcome.session.userId);
      } catch (revocationError) {
        logTechnicalError("telegram_callback_session_revocation_failed", revocationError, {
          sessionId: session.id,
          userId: outcome.session.userId,
        });
      }
      throw error;
    }
  }
  return { webSessionId: session.id };
}

async function applyDurableCallbackReplay(
  response: NextResponse,
  replay: DurableTelegramCallbackReplay,
) {
  if (replay.mergeConfirmation) {
    setMergeConfirmationCookie(response, replay.mergeConfirmation.token);
    return;
  }
  if (!replay.session) {
    throw new Error("Durable Telegram callback completed without bootstrap state");
  }
  await setDurableCallbackReplayCookies(
    response,
    replay.session.webSessionId,
    replay.session.userId,
    replay.session.bootstrapRefreshToken,
  );
}

async function telegramFailurePath(error?: unknown) {
  const session = await getCurrentSession().catch(() => null);

  if (!session) return "/login?auth=telegram_failed";

  const reason =
    error instanceof TelegramCallbackError && error.code === "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT"
      ? "telegram_merge_subscriptions"
      : error instanceof TelegramCallbackError && error.code === "ACCOUNT_MERGE_REQUIRED"
        ? "telegram_merge_required"
        : "telegram_failed";

  return `/link-account?auth=${reason}`;
}

async function redirectAfterTelegramFailure(error?: unknown) {
  return redirectTo(await telegramFailurePath(error));
}

async function redirectAfterConsumedTelegramState() {
  const session = await getCurrentSession().catch(() => null);
  const status = "telegram_processing";
  return session
    ? redirectTo(`/link-account?auth=${status}`)
    : redirectTo(`/login?auth=${status}`);
}

function terminalDurableCallbackFailure(error: unknown) {
  if (error instanceof TelegramCallbackError) {
    return [
      "ACCOUNT_MERGE_REQUIRED",
      "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT",
    ].includes(error.code);
  }
  return error instanceof ServiceError && [
    "UNAUTHORIZED",
    "FORBIDDEN",
    "VALIDATION_ERROR",
    "ACCOUNT_MERGE_REQUIRED",
    "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT",
  ].includes(error.code);
}

function durableCallbackFailureCode(error: unknown) {
  if (error instanceof TelegramCallbackError || error instanceof ServiceError) {
    return error.code;
  }
  return "INTERNAL_ERROR";
}

type DurableResume = {
  ownership: DurableTelegramCallbackOwnership;
  checkpoint: DurableTelegramCallbackCheckpoint;
};

function durableLinkTargetUserId(
  checkpoint: DurableTelegramCallbackCheckpoint,
) {
  switch (checkpoint.phase) {
    case "PROVIDER_READY":
      return checkpoint.authState.targetUserId;
    case "IDENTITY_VERIFIED":
    case "PROVIDER_AUTHENTICATED":
      return checkpoint.verified.authState.targetUserId;
    case "IDENTITY_RESOLVED":
      return checkpoint.consumed.linked
        ? checkpoint.consumed.user.id
        : null;
    case "OUTCOME_READY":
    case "SESSION_CREATED":
      return null;
  }
}

async function assertDurableTelegramLinkSession(
  checkpoint: DurableTelegramCallbackCheckpoint,
) {
  const targetUserId = durableLinkTargetUserId(checkpoint);
  if (!targetUserId) return;

  const session = await getCurrentSession();
  if (session?.userId !== targetUserId) {
    throw new ServiceError(
      "UNAUTHORIZED",
      401,
      "Telegram account linking session is no longer active",
    );
  }
}

async function continueDurableTelegramCallback(
  state: string,
  code: string,
  resume?: DurableResume,
): Promise<
  | {
      status: "completed";
      replay: DurableTelegramCallbackReplay;
    }
  | { status: "failed"; redirectTo: string }
> {
  let ownership: DurableTelegramCallbackOwnership | undefined = resume?.ownership;
  let checkpoint: DurableTelegramCallbackCheckpoint | undefined = resume?.checkpoint;

  try {
    if (!checkpoint) {
      const verified = await productionTelegramCallbackGateway.consume({
        kind: "oidc",
        code,
        state,
      });
      if (!verified.durable) {
        throw new Error("OIDC callback did not return durable ownership");
      }
      ownership = verified.durable;
      checkpoint = {
        phase: "PROVIDER_AUTHENTICATED",
        verified: { ...verified, durable: undefined },
      };
    }

    for (;;) {
      if (!ownership) {
        throw new Error("Durable Telegram callback has no ownership token");
      }
      await assertDurableTelegramLinkSession(checkpoint);
      switch (checkpoint.phase) {
        case "PROVIDER_READY": {
          const verified = await resumeTelegramOidcCodeExchange(
            code,
            state,
            checkpoint.authState,
            ownership,
          );
          checkpoint = {
            phase: "PROVIDER_AUTHENTICATED",
            verified: { ...verified, durable: undefined },
          };
          break;
        }
        case "IDENTITY_VERIFIED": {
          const verified = await resumeTelegramProviderAuthentication(
            checkpoint.verified,
            ownership,
          );
          checkpoint = {
            phase: "PROVIDER_AUTHENTICATED",
            verified: { ...verified, durable: undefined },
          };
          break;
        }
        case "PROVIDER_AUTHENTICATED": {
          const verified: VerifiedTelegramCallback = checkpoint.verified;
          const consumed: ConsumedTelegramCallback =
            await runWithDurableTelegramCallbackLease(
            ownership,
            "PROVIDER_AUTHENTICATED",
            () => resolveVerifiedTelegramIdentity(
              productionTelegramCallbackGateway,
              verified,
              { preserveTemporaryAuth: true },
            ),
          );
          await checkpointDurableTelegramIdentityResolved(
            ownership,
            consumed,
          );
          checkpoint = { phase: "IDENTITY_RESOLVED", consumed };
          break;
        }
        case "IDENTITY_RESOLVED": {
          const consumed: ConsumedTelegramCallback = checkpoint.consumed;
          const outcome: TelegramCallbackOutcome =
            await runWithDurableTelegramCallbackLease(
            ownership,
            "IDENTITY_RESOLVED",
            () => completeResolvedTelegramCallback(
              productionTelegramCallbackGateway,
              consumed,
            ),
          );
          await checkpointDurableTelegramOutcome(ownership, outcome);
          checkpoint = { phase: "OUTCOME_READY", outcome };
          break;
        }
        case "OUTCOME_READY": {
          if (checkpoint.outcome.mergeConfirmation) {
            const replay = await completeDurableTelegramMerge(
              ownership,
              checkpoint.outcome,
            );
            return { status: "completed", replay };
          }
          const created = await createDurableTelegramCallbackSession(
            ownership,
            checkpoint.outcome,
          );
          checkpoint = { phase: "SESSION_CREATED", replay: created.replay };
          break;
        }
        case "SESSION_CREATED": {
          if (!checkpoint.replay.session) {
            throw new Error("SESSION_CREATED checkpoint has no exact session");
          }
          let committedReplay = checkpoint.replay;
          if (checkpoint.replay.session.requiresTelegramRecovery) {
            const replaySession = checkpoint.replay.session;
            await markDurableTelegramRecoveryDispatching(
              ownership,
              checkpoint.replay,
            );
            try {
              await runWithDurableTelegramCallbackLease(
                ownership,
                "RECOVERY_DISPATCHING",
                () => recoverRemnashopTelegramSession(
                  replaySession.webSessionId,
                  replaySession.userId,
                ),
              );
              committedReplay = await checkpointDurableTelegramRecoveryCommitted(
                ownership,
                checkpoint.replay,
              );
            } catch {
              const redirectTo = "/login?auth=telegram_recovery_required";
              await failDurableTelegramCallback(
                ownership,
                "RECOVERY_DISPATCHING",
                "REMNASHOP_RECOVERY_AMBIGUOUS",
                redirectTo,
                checkpoint.replay,
              );
              return { status: "failed", redirectTo };
            }
          }
          await completeDurableTelegramSession(ownership, committedReplay);
          return {
            status: "completed",
            replay: committedReplay,
          };
        }
      }
    }
  } catch (error) {
    if (ownership && checkpoint) {
      if (terminalDurableCallbackFailure(error)) {
        const redirectTo = await telegramFailurePath(error);
        await failDurableTelegramCallback(
          ownership,
          checkpoint.phase,
          durableCallbackFailureCode(error),
          redirectTo,
          checkpoint.phase === "SESSION_CREATED"
            ? checkpoint.replay
            : undefined,
        );
        return { status: "failed", redirectTo };
      }
      await releaseDurableTelegramCallback(
        ownership,
        checkpoint.phase,
      ).catch((releaseError) => {
        logTechnicalError(
          "telegram_callback_lease_release_failed",
          releaseError,
          { phase: checkpoint?.phase },
        );
      });
    }
    throw error;
  }
}

function callbackRequestMetadata(request: Request, url: URL) {
  return {
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
    forwardedPort: request.headers.get("x-forwarded-port"),
    realIpPresent: Boolean(request.headers.get("x-real-ip")),
    forwardedForPresent: Boolean(request.headers.get("x-forwarded-for")),
    referer: request.headers.get("referer"),
    authParamPresent: url.searchParams.has("code"),
    stateParamPresent: url.searchParams.has("state"),
    error: url.searchParams.get("error"),
    errorDescription: url.searchParams.get("error_description"),
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const metadata = callbackRequestMetadata(request, url);

  logTechnicalInfo("telegram_callback_received", metadata);

  if (!code || !state) {
    logTechnicalWarning("telegram_callback_missing_params", metadata);
    return redirectAfterTelegramFailure();
  }

  const completedDestination = completedTelegramCallbackDestination(
    request,
    state,
    code,
  );
  if (completedDestination) {
    logTechnicalInfo("telegram_callback_duplicate_completed", {
      redirectTo: completedDestination,
    });
    return redirectTo(completedDestination);
  }

  try {
    // A URL containing state+code is not sufficient authority to recover a
    // completed login. The original browser must still prove possession of
    // all three short-lived OIDC cookies before any checkpoint is disclosed
    // or any session credential is issued.
    const proof = await readTelegramCallbackCookieProof(state);
    const durable = await loadDurableTelegramCallback(state, code, proof);
    if (durable.status === "processing") {
      logTechnicalInfo("telegram_callback_duplicate_processing", {});
      return redirectAfterConsumedTelegramState();
    }
    if (durable.status === "completed") {
      const destination = callbackDestination(durable.outcome.redirectTo);
      const response = redirectTo(destination);
      await applyDurableCallbackReplay(response, durable.outcome);
      clearTelegramAuthCookiesOnResponse(response);
      setTelegramCallbackReceipt(response, state, code, destination);
      if (!durable.outcome.mergeConfirmation) {
        clearReferralAttributionCookieOnResponse(response);
      }
      logTechnicalInfo("telegram_callback_duplicate_durable_completed", {
        redirectTo: destination,
      });
      return response;
    }
    if (durable.status === "failed") {
      logTechnicalInfo("telegram_callback_duplicate_failed", {
        redirectTo: durable.redirectTo,
      });
      const response = redirectTo(
        durableFailureDestination(durable.redirectTo),
      );
      clearTelegramAuthCookiesOnResponse(response);
      return response;
    }

    const completed = await continueDurableTelegramCallback(
      state,
      code,
      durable.status === "resume"
        ? {
            ownership: durable.ownership,
            checkpoint: durable.checkpoint,
          }
        : undefined,
    );
    if (completed.status === "failed") {
      const response = redirectTo(
        durableFailureDestination(completed.redirectTo),
      );
      clearTelegramAuthCookiesOnResponse(response);
      return response;
    }

    const destination = callbackDestination(completed.replay.redirectTo);
    const response = redirectTo(destination);
    if (completed.replay.mergeConfirmation) {
      setMergeConfirmationCookie(
        response,
        completed.replay.mergeConfirmation.token,
      );
    } else {
      // Both the first response and every replay reload the exact committed
      // session. Recovery may update user claims after session creation, so a
      // cached pre-recovery snapshot must never sign the first response.
      await applyDurableCallbackReplay(response, completed.replay);
    }
    clearTelegramAuthCookiesOnResponse(response);
    setTelegramCallbackReceipt(response, state, code, destination);
    if (completed.replay.mergeConfirmation) return response;
    clearReferralAttributionCookieOnResponse(response);

    logTechnicalInfo("telegram_callback_success", {
      ...metadata,
      ...completed.replay.audit,
      redirectTo: destination,
    });

    return response;
  } catch (error) {
    logTechnicalError("telegram_callback_failed", error, metadata);
    if (error instanceof TelegramAuthStateAlreadyConsumedError) {
      return redirectAfterConsumedTelegramState();
    }
    return redirectAfterTelegramFailure(error);
  }
}

export async function POST(request: Request) {
  const source = validateRequestSource({
    headers: request.headers,
    trustedAppUrl: getEnv().publicAppUrl,
  });
  if (!source.ok) {
    return NextResponse.json(
      { error: "forbidden" },
      { status: source.status, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const popupRequest = await readTelegramPopupRequest(request);
    const outcome = await completeTelegramCallback(
      productionTelegramCallbackGateway,
      popupRequest.method === "oidc"
        ? { kind: "popup-oidc", idToken: popupRequest.idToken }
        : { kind: "login-widget", authData: popupRequest.authData },
    );
    const destination = callbackDestination(outcome.redirectTo);
    const response = noStore(NextResponse.json({ redirectTo: destination }));
    await applyCallbackOutcome(response, outcome);
    if (outcome.mergeConfirmation) return response;
    clearReferralAttributionCookieOnResponse(response);

    logTechnicalInfo("telegram_popup_callback_success", {
      ...outcome.audit,
      redirectTo: destination,
    });

    return response;
  } catch (error) {
    logTechnicalError("telegram_popup_callback_failed", error, {});
    if (error instanceof ServiceError && error.status === 413) {
      return noStore(
        NextResponse.json(
          { error: "payload_too_large" },
          { status: error.status },
        ),
      );
    }
    if (error instanceof ServiceError && error.status === 415) {
      return noStore(
        NextResponse.json(
          { error: "unsupported_media_type" },
          { status: error.status },
        ),
      );
    }
    if (error instanceof TelegramAuthStateAlreadyConsumedError) {
      const session = await getCurrentSession().catch(() => null);
      if (session) {
        return noStore(
          NextResponse.json({
            redirectTo: "/link-account?auth=telegram_processing",
          }),
        );
      }
    }
    return noStore(
      NextResponse.json({ error: "telegram_failed" }, { status: 400 }),
    );
  }
}

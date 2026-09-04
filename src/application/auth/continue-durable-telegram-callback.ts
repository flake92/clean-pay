import type {
  ConsumedTelegramCallback,
  TelegramCallbackDurableOwnership,
  TelegramCallbackOutcome,
  VerifiedTelegramCallback,
} from "@/application/auth/ports/telegram-callback";

export type DurableTelegramCallbackReplay = {
  redirectTo: string;
  session?: {
    webSessionId: string;
    userId: string;
    bootstrapRefreshToken: string;
    requiresTelegramRecovery: boolean;
  };
  mergeConfirmation?: { token: string };
  audit: { userId: string; remnashopLinked: boolean };
};

export type DurableTelegramCallbackCheckpoint =
  | {
      phase: "PROVIDER_READY";
      authState: {
        id: string;
        targetUserId: string | null;
        redirectTo: string | null;
      };
    }
  | { phase: "IDENTITY_VERIFIED"; verified: VerifiedTelegramCallback }
  | { phase: "PROVIDER_AUTHENTICATED"; verified: VerifiedTelegramCallback }
  | { phase: "IDENTITY_RESOLVED"; consumed: ConsumedTelegramCallback }
  | { phase: "OUTCOME_READY"; outcome: TelegramCallbackOutcome }
  | { phase: "SESSION_CREATED"; replay: DurableTelegramCallbackReplay };

type DurableTelegramCallbackPhase = DurableTelegramCallbackCheckpoint["phase"];
type DurableTelegramCallbackLeasePhase =
  | DurableTelegramCallbackPhase
  | "RECOVERY_DISPATCHING";

export type DurableTelegramCallbackResume = {
  ownership: TelegramCallbackDurableOwnership;
  checkpoint: DurableTelegramCallbackCheckpoint;
};

export function durableTelegramLinkTargetUserId(
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

export type ContinueDurableTelegramCallbackDependencies = {
  consume(input: {
    kind: "oidc";
    code: string;
    state: string;
  }): Promise<VerifiedTelegramCallback>;
  assertLinkSession(
    checkpoint: DurableTelegramCallbackCheckpoint,
  ): Promise<void>;
  resumeOidcCodeExchange(
    code: string,
    state: string,
    authState: Extract<
      DurableTelegramCallbackCheckpoint,
      { phase: "PROVIDER_READY" }
    >["authState"],
    ownership: TelegramCallbackDurableOwnership,
  ): Promise<VerifiedTelegramCallback>;
  resumeProviderAuthentication(
    verified: VerifiedTelegramCallback,
    ownership: TelegramCallbackDurableOwnership,
  ): Promise<VerifiedTelegramCallback>;
  runWithLease<T>(
    ownership: TelegramCallbackDurableOwnership,
    phase: DurableTelegramCallbackLeasePhase,
    work: () => Promise<T>,
  ): Promise<T>;
  resolveIdentity(
    verified: VerifiedTelegramCallback,
  ): Promise<ConsumedTelegramCallback>;
  checkpointIdentityResolved(
    ownership: TelegramCallbackDurableOwnership,
    consumed: ConsumedTelegramCallback,
  ): Promise<unknown>;
  completeResolved(
    consumed: ConsumedTelegramCallback,
  ): Promise<TelegramCallbackOutcome>;
  checkpointOutcome(
    ownership: TelegramCallbackDurableOwnership,
    outcome: TelegramCallbackOutcome,
  ): Promise<unknown>;
  completeMerge(
    ownership: TelegramCallbackDurableOwnership,
    outcome: TelegramCallbackOutcome,
  ): Promise<DurableTelegramCallbackReplay>;
  createSession(
    ownership: TelegramCallbackDurableOwnership,
    outcome: TelegramCallbackOutcome,
  ): Promise<{ replay: DurableTelegramCallbackReplay }>;
  markRecoveryDispatching(
    ownership: TelegramCallbackDurableOwnership,
    replay: DurableTelegramCallbackReplay,
  ): Promise<unknown>;
  recoverSession(webSessionId: string, userId: string): Promise<unknown>;
  checkpointRecoveryCommitted(
    ownership: TelegramCallbackDurableOwnership,
    replay: DurableTelegramCallbackReplay,
  ): Promise<DurableTelegramCallbackReplay>;
  fail(
    ownership: TelegramCallbackDurableOwnership,
    phase: DurableTelegramCallbackLeasePhase,
    code: string,
    redirectTo: string,
    replay?: DurableTelegramCallbackReplay,
  ): Promise<unknown>;
  completeSession(
    ownership: TelegramCallbackDurableOwnership,
    replay: DurableTelegramCallbackReplay,
  ): Promise<unknown>;
  isTerminalFailure(error: unknown): boolean;
  failureCode(error: unknown): string;
  failureRedirect(error: unknown): Promise<string>;
  release(
    ownership: TelegramCallbackDurableOwnership,
    phase: DurableTelegramCallbackPhase,
  ): Promise<unknown>;
  reportReleaseFailure(
    error: unknown,
    phase: DurableTelegramCallbackPhase,
  ): void;
};

export async function continueDurableTelegramCallback(
  input: {
    state: string;
    code: string;
    resume?: DurableTelegramCallbackResume;
  },
  dependencies: ContinueDurableTelegramCallbackDependencies,
): Promise<
  | { status: "completed"; replay: DurableTelegramCallbackReplay }
  | { status: "failed"; redirectTo: string }
> {
  let ownership = input.resume?.ownership;
  let checkpoint = input.resume?.checkpoint;

  try {
    if (!checkpoint) {
      const verified = await dependencies.consume({
        kind: "oidc",
        code: input.code,
        state: input.state,
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
      await dependencies.assertLinkSession(checkpoint);

      switch (checkpoint.phase) {
        case "PROVIDER_READY": {
          const verified = await dependencies.resumeOidcCodeExchange(
            input.code,
            input.state,
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
          const verified = await dependencies.resumeProviderAuthentication(
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
            await dependencies.runWithLease<ConsumedTelegramCallback>(
            ownership,
            "PROVIDER_AUTHENTICATED",
            () => dependencies.resolveIdentity(verified),
          );
          await dependencies.checkpointIdentityResolved(ownership, consumed);
          checkpoint = { phase: "IDENTITY_RESOLVED", consumed };
          break;
        }
        case "IDENTITY_RESOLVED": {
          const consumed: ConsumedTelegramCallback = checkpoint.consumed;
          const outcome: TelegramCallbackOutcome =
            await dependencies.runWithLease<TelegramCallbackOutcome>(
            ownership,
            "IDENTITY_RESOLVED",
            () => dependencies.completeResolved(consumed),
          );
          await dependencies.checkpointOutcome(ownership, outcome);
          checkpoint = { phase: "OUTCOME_READY", outcome };
          break;
        }
        case "OUTCOME_READY": {
          if (checkpoint.outcome.mergeConfirmation) {
            const replay = await dependencies.completeMerge(
              ownership,
              checkpoint.outcome,
            );
            return { status: "completed", replay };
          }
          const created = await dependencies.createSession(
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
            await dependencies.markRecoveryDispatching(
              ownership,
              checkpoint.replay,
            );
            try {
              await dependencies.runWithLease(
                ownership,
                "RECOVERY_DISPATCHING",
                () => dependencies.recoverSession(
                  replaySession.webSessionId,
                  replaySession.userId,
                ),
              );
              committedReplay = await dependencies.checkpointRecoveryCommitted(
                ownership,
                checkpoint.replay,
              );
            } catch {
              const redirectTo = "/login?auth=telegram_recovery_required";
              await dependencies.fail(
                ownership,
                "RECOVERY_DISPATCHING",
                "REMNASHOP_RECOVERY_AMBIGUOUS",
                redirectTo,
                checkpoint.replay,
              );
              return { status: "failed", redirectTo };
            }
          }
          await dependencies.completeSession(ownership, committedReplay);
          return { status: "completed", replay: committedReplay };
        }
      }
    }
  } catch (error) {
    if (ownership && checkpoint) {
      if (dependencies.isTerminalFailure(error)) {
        const redirectTo = await dependencies.failureRedirect(error);
        await dependencies.fail(
          ownership,
          checkpoint.phase,
          dependencies.failureCode(error),
          redirectTo,
          checkpoint.phase === "SESSION_CREATED"
            ? checkpoint.replay
            : undefined,
        );
        return { status: "failed", redirectTo };
      }
      const releasePhase = checkpoint.phase;
      await dependencies.release(ownership, releasePhase).catch(
        (releaseError: unknown) => {
          dependencies.reportReleaseFailure(releaseError, releasePhase);
        },
      );
    }
    throw error;
  }
}

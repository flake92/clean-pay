import { AsyncLocalStorage } from "node:async_hooks";

type DeferredWebSessionCookieEffect = () => Promise<void>;

const deferredWebSessionCookieEffects = new AsyncLocalStorage<
  DeferredWebSessionCookieEffect[]
>();

export function webSessionCookieEffectsAreDeferred() {
  return deferredWebSessionCookieEffects.getStore() !== undefined;
}

export async function applyOrDeferWebSessionCookieEffect(
  effect: DeferredWebSessionCookieEffect,
) {
  const deferredEffects = deferredWebSessionCookieEffects.getStore();
  if (deferredEffects) {
    deferredEffects.push(effect);
    return;
  }

  await effect();
}

/**
 * Defers cookie writes scheduled by web-session creation until `operation`
 * resolves. Prisma resolves an interactive transaction only after commit, so
 * callers can place the complete `$transaction` inside this scope without
 * exposing response cookies for data that later rolls back.
 */
export async function runWithPostCommitWebSessionCookieEffects<T>(
  operation: () => Promise<T>,
) {
  if (webSessionCookieEffectsAreDeferred()) {
    return operation();
  }

  const effects: DeferredWebSessionCookieEffect[] = [];
  const result = await deferredWebSessionCookieEffects.run(effects, operation);

  for (const effect of effects) {
    await effect();
  }

  return result;
}

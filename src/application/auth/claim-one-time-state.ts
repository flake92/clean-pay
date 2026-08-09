import type { OneTimeStateKind, OneTimeStateRepository } from "@/application/auth/ports/one-time-state";

export function claimOneTimeState(
  repository: OneTimeStateRepository,
  kind: OneTimeStateKind,
  id: string,
  consumedAt = new Date(),
) {
  return repository.claim({ kind, id, consumedAt });
}

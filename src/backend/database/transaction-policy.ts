/**
 * How long an interactive transaction may wait for a connection, and how long
 * it may hold one.
 *
 * These bounds were previously stated five different ways: three named
 * constants in three files that happened to carry identical values, five
 * literal objects, and twenty-five calls that passed nothing at all and so ran
 * on whatever Prisma's defaults were that release. Tuning one copy left the
 * others behind, and the silent ones could change under a dependency upgrade
 * without a line of this repository being touched.
 *
 * Every interactive transaction picks one of these by name, so the choice is
 * visible at the call site and changing a policy changes every transaction
 * that claims it.
 */

/**
 * Prisma's own defaults, stated explicitly. Use for short single-row writes
 * that were already running on them, so a dependency upgrade cannot move them.
 */
export const defaultTransaction = { maxWait: 2_000, timeout: 5_000 } as const;

/** A few statements against rows this request already located. */
export const standardTransaction = { maxWait: 5_000, timeout: 10_000 } as const;

/** Fenced or multi-row work: session issue, callback settlement, passkeys. */
export const extendedTransaction = { maxWait: 5_000, timeout: 15_000 } as const;

/**
 * Payment idempotency claim. Longest because it serializes concurrent attempts
 * on one operation, and losing the race here means a duplicate charge rather
 * than a retry.
 */
export const idempotencyTransaction = { maxWait: 5_000, timeout: 30_000 } as const;

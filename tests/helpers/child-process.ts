/**
 * Upper bound for a short-lived Node child process in tests (a script run with
 * `spawnSync`/`execFileSync`).  Starting Node under a fully parallel suite can
 * take several seconds, so the former 5 s limits produced ETIMEDOUT failures that
 * had nothing to do with the code under test.  Keep it below vitest's default
 * 15 s `testTimeout` so a genuine hang still reports the child's own error.
 */
export const NODE_CHILD_TIMEOUT = 12_000;

const WORKER_SIGNALS = ["SIGTERM", "SIGINT"];

/**
 * @typedef {object} WorkerSignalSource
 * @property {(signal: string, listener: () => void) => unknown} on
 * @property {(signal: string, listener: () => void) => unknown} off
 */

/**
 * @param {{
 *   onSignal?: (signal: string) => void,
 *   signalSource?: WorkerSignalSource,
 * }} [options]
 */
export function createWorkerShutdownController({
  onSignal = () => {},
  signalSource = process,
} = {}) {
  const abortController = new AbortController();
  const handlers = new Map();
  let requestedSignal = null;

  const requestShutdown = (signal) => {
    if (requestedSignal !== null) return;

    requestedSignal = signal;
    const reason = new Error(`Worker shutdown requested by ${signal}`);
    reason.name = "WorkerShutdownSignal";
    abortController.abort(reason);
    onSignal(signal);
  };

  for (const signal of WORKER_SIGNALS) {
    const handler = () => requestShutdown(signal);
    handlers.set(signal, handler);
    signalSource.on(signal, handler);
  }

  return {
    get requested() {
      return requestedSignal !== null;
    },
    get requestedSignal() {
      return requestedSignal;
    },
    signal: abortController.signal,
    async sleep(milliseconds) {
      if (abortController.signal.aborted) return false;

      return await new Promise((resolve) => {
        let settled = false;
        const finish = (elapsed) => {
          if (settled) return;

          settled = true;
          clearTimeout(timer);
          abortController.signal.removeEventListener("abort", onAbort);
          resolve(elapsed);
        };
        const onAbort = () => finish(false);
        const timer = setTimeout(() => finish(true), milliseconds);

        abortController.signal.addEventListener("abort", onAbort, { once: true });
        if (abortController.signal.aborted) onAbort();
      });
    },
    dispose() {
      for (const [signal, handler] of handlers) {
        signalSource.off(signal, handler);
      }
      handlers.clear();
    },
  };
}

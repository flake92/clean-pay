import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:http";

import { describe, expect, it } from "vitest";

import { createWorkerShutdownController } from "../../../deploy/prod/worker-shutdown.mjs";

const reconcileLoop = "deploy/prod/reconcile-loop.mjs";

async function within<T>(promise: Promise<T>, milliseconds: number, message: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

describe("production worker shutdown", () => {
  it.each(["SIGTERM", "SIGINT"] as const)(
    "records %s as the first signal and interrupts a pending sleep",
    async (signal) => {
      const signalSource = new EventEmitter();
      const observedSignals: string[] = [];
      const shutdown = createWorkerShutdownController({
        signalSource,
        onSignal(signal: string) {
          observedSignals.push(signal);
        },
      });

      const sleeping = shutdown.sleep(60_000);
      signalSource.emit(signal);
      signalSource.emit(signal === "SIGTERM" ? "SIGINT" : "SIGTERM");

      await expect(sleeping).resolves.toBe(false);
      expect(shutdown.requested).toBe(true);
      expect(shutdown.requestedSignal).toBe(signal);
      expect(shutdown.signal.aborted).toBe(true);
      expect(observedSignals).toEqual([signal]);

      shutdown.dispose();
      expect(signalSource.listenerCount("SIGTERM")).toBe(0);
      expect(signalSource.listenerCount("SIGINT")).toBe(0);
    },
  );

  it.skipIf(process.platform === "win32")(
    "aborts an in-flight reconciliation fetch and exits cleanly on SIGTERM",
    async () => {
      let requestStarted = () => {};
      const requestReceived = new Promise<void>((resolve) => {
        requestStarted = resolve;
      });
      const server = createServer((request) => {
        request.resume();
        requestStarted();
        // Keep the response open so the worker is stopped during its bounded fetch.
      });
      let child: ReturnType<typeof spawn> | undefined;

      try {
        server.listen(0, "127.0.0.1");
        await within(
          once(server, "listening").then(() => undefined),
          5_000,
          "test reconciliation endpoint did not start",
        );
        const address = server.address();

        if (address === null || typeof address === "string") {
          throw new Error("test reconciliation endpoint has no TCP address");
        }

        child = spawn(process.execPath, [reconcileLoop], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            PAYMENT_RECONCILIATION_ENABLED: "true",
            PAYMENT_RECONCILIATION_INTERVAL_SECONDS: "30",
            PAYMENT_RECONCILIATION_INTERNAL_URL:
              `http://127.0.0.1:${address.port}/reconcile`,
            PAYMENT_RECONCILIATION_SECRET: "s".repeat(32),
          },
          stdio: ["ignore", "pipe", "pipe"],
        });

        let output = "";
        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => {
          output += chunk;
        });
        child.stderr?.on("data", (chunk: string) => {
          output += chunk;
        });
        const closed = new Promise<{
          code: number | null;
          signal: NodeJS.Signals | null;
        }>((resolve, reject) => {
          child?.once("error", reject);
          child?.once("close", (code, signal) => resolve({ code, signal }));
        });

        await within(
          requestReceived,
          5_000,
          "reconciliation worker did not begin its fetch",
        );
        expect(child.kill("SIGTERM")).toBe(true);

        const result = await within(
          closed,
          5_000,
          "reconciliation worker did not stop after SIGTERM",
        );

        expect(result).toEqual({ code: 0, signal: null });
        expect(output).toContain("event=reconciliation_worker_shutdown_requested");
        expect(output).toContain("event=reconciliation_batch_shutdown_interrupted");
        expect(output).toContain("event=reconciliation_worker_stopped");
        expect(output).not.toContain("event=reconciliation_batch_failed");
        expect(output).not.toContain("event=reconciliation_worker_failure_limit_reached");
      } finally {
        if (child?.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
        server.closeAllConnections();
        if (server.listening) {
          await new Promise<void>((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
          });
        }
      }
    },
  );
});

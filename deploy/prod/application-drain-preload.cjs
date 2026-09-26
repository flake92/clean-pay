"use strict";

const fs = process.getBuiltinModule("node:fs");
const http = process.getBuiltinModule("node:http");
const https = process.getBuiltinModule("node:https");

const INSTALLATION_KEY = Symbol.for("clean-pay.application-drain-preload.v1");
const DEFAULT_DRAIN_TIMEOUT_MS = 115_000;
const TEST_DRAIN_TIMEOUT_ENV = "CLEAN_PAY_TEST_APPLICATION_DRAIN_TIMEOUT_MS";
const INHERITED_NODE_OPTIONS_ENV = "CLEAN_PAY_INHERITED_NODE_OPTIONS";

if (!globalThis[INSTALLATION_KEY]) {
  globalThis[INSTALLATION_KEY] = installApplicationDrain();
}

restoreInheritedNodeOptions();
module.exports = globalThis[INSTALLATION_KEY];

function installApplicationDrain() {
  const originalExit = process.exit.bind(process);
  const servers = new Map();
  const activeRequests = new Set();
  const timeoutMs = readDrainTimeoutMs();
  const state = {
    completed: false,
    drainStarted: false,
    duplicateSignals: 0,
    externalCloseRequested: false,
    fallbackReady: false,
    httpDrainCompleted: false,
    rejectedRequests: 0,
    signal: undefined,
    timeout: undefined,
  };

  patchCreateServer(http);
  patchCreateServer(https);
  process.on("SIGINT", () => beginDrain("SIGINT"));
  process.on("SIGTERM", () => beginDrain("SIGTERM"));
  process.once("exit", (code) => {
    if (
      state.drainStarted
      && state.httpDrainCompleted
      && !state.completed
    ) {
      state.completed = true;
      writeLifecycleLog("application_drain_completed", {
        duplicate_signals: state.duplicateSignals,
        exit_code: code,
        rejected_requests: state.rejectedRequests,
        signal: state.signal,
      });
    }
  });

  return Object.freeze({ installed: true });

  function patchCreateServer(module) {
    const originalCreateServer = module.createServer;

    module.createServer = function createDrainAwareServer(...args) {
      const listenerIndex = args.length - 1;
      const listener = args[listenerIndex];

      if (typeof listener === "function") {
        args[listenerIndex] = function drainAwareRequestListener(request, response) {
          if (state.drainStarted) {
            rejectRequest(request, response);
            return undefined;
          }

          const record = {
            handlerSettled: false,
            responseSettled: false,
          };
          activeRequests.add(record);

          const settleResponse = () => {
            if (record.responseSettled) return;
            record.responseSettled = true;
            settleRequest(record);
          };
          response.once("finish", settleResponse);
          response.once("close", settleResponse);

          let result;
          try {
            result = Reflect.apply(listener, this, [request, response]);
          } catch (error) {
            record.handlerSettled = true;
            settleRequest(record);
            throw error;
          }

          void Promise.resolve(result).finally(() => {
            record.handlerSettled = true;
            settleRequest(record);
          });
          return result;
        };
      }

      const server = Reflect.apply(originalCreateServer, this, args);
      registerServer(server);
      return server;
    };
  }

  function registerServer(server) {
    const originalClose = server.close;
    const record = {
      callbacks: [],
      closeFinished: false,
      closeStarted: false,
      originalClose,
      server,
    };
    servers.set(server, record);

    server.close = function drainAwareClose(...args) {
      if (!state.drainStarted) {
        return Reflect.apply(originalClose, this, args);
      }

      if (
        args.length > 1
        || (args.length === 1 && args[0] !== undefined && typeof args[0] !== "function")
      ) {
        return Reflect.apply(originalClose, this, args);
      }

      state.externalCloseRequested = true;
      if (typeof args[0] === "function") {
        record.callbacks.push(args[0]);
      }
      startServerCloseIfReady(record);
      return server;
    };

    server.once("close", () => {
      record.closeFinished = true;
      finishHttpDrainIfPossible();
    });
    server.once("listening", () => startServerCloseIfReady(record));

    startServerCloseIfReady(record);
  }

  function settleRequest(record) {
    if (!record.handlerSettled || !record.responseSettled) return;
    activeRequests.delete(record);

    if (state.drainStarted && activeRequests.size === 0) {
      startServerClosesIfReady();
    }
  }

  function rejectRequest(request, response) {
    state.rejectedRequests += 1;
    response.statusCode = 503;
    response.statusMessage = "Service Unavailable";
    response.shouldKeepAlive = false;
    response.setHeader("Connection", "close");
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.setHeader("Retry-After", "1");
    response.end("Service Unavailable");
    request.resume();
  }

  function beginDrain(signal) {
    if (state.drainStarted) {
      state.duplicateSignals += 1;
      return;
    }

    state.drainStarted = true;
    state.signal = signal;
    state.timeout = setTimeout(forceDrainTimeout, timeoutMs);
    writeLifecycleLog("application_drain_started", {
      active_requests: activeRequests.size,
      server_count: servers.size,
      signal,
      timeout_ms: timeoutMs,
    });

    // Next registers its own signal handler after the HTTP server starts. It
    // calls server.close synchronously before its first await. Waiting one turn
    // lets that handler claim lifecycle ownership while still covering a
    // signal received before Next finished installing the handler.
    setImmediate(() => {
      state.fallbackReady = true;
      startServerClosesIfReady();
    });
  }

  function startServerClosesIfReady() {
    if (
      state.completed
      || !state.drainStarted
      || !state.fallbackReady
      || activeRequests.size !== 0
    ) {
      return;
    }

    for (const record of servers.values()) {
      startServerCloseIfReady(record);
    }
    finishHttpDrainIfPossible();
  }

  function startServerCloseIfReady(record) {
    if (
      state.completed
      || !state.drainStarted
      || !state.fallbackReady
      || activeRequests.size !== 0
      || record.closeStarted
    ) {
      return;
    }

    const { server } = record;
    if (!server.listening) {
      record.closeFinished = true;
      finishHttpDrainIfPossible();
      return;
    }

    record.closeStarted = true;
    try {
      Reflect.apply(record.originalClose, server, [(error) => {
        record.closeFinished = true;
        const callbacks = record.callbacks.splice(0);
        for (const callback of callbacks) {
          callback(error);
        }
        finishHttpDrainIfPossible();
      }]);
      server.closeIdleConnections?.();
    } catch (error) {
      record.closeFinished = !server.listening;
      const callbacks = record.callbacks.splice(0);
      for (const callback of callbacks) {
        callback(error);
      }
      finishHttpDrainIfPossible();
    }
  }

  function finishHttpDrainIfPossible() {
    if (
      state.completed
      || !state.drainStarted
      || !state.fallbackReady
      || state.httpDrainCompleted
      || activeRequests.size !== 0
      || [...servers.values()].some((record) =>
        record.server.listening || !record.closeFinished
      )
    ) {
      return;
    }

    state.httpDrainCompleted = true;
    writeLifecycleLog("application_http_drain_completed", {
      external_close: state.externalCloseRequested,
      rejected_requests: state.rejectedRequests,
      signal: state.signal,
    });

    if (!state.externalCloseRequested) {
      const exitCode = state.signal === "SIGINT" ? 130 : 143;
      state.completed = true;
      clearTimeout(state.timeout);
      writeLifecycleLog("application_drain_completed", {
        duplicate_signals: state.duplicateSignals,
        exit_code: exitCode,
        rejected_requests: state.rejectedRequests,
        signal: state.signal,
      });
      originalExit(exitCode);
    }
  }

  function forceDrainTimeout() {
    if (state.completed) return;
    state.completed = true;

    writeLifecycleLog("application_drain_timeout", {
      active_requests: activeRequests.size,
      duplicate_signals: state.duplicateSignals,
      rejected_requests: state.rejectedRequests,
      server_count: servers.size,
      signal: state.signal,
    });
    for (const { server } of servers.values()) {
      try {
        server.closeAllConnections?.();
      } catch {
        // The bounded process exit below remains the final shutdown guarantee.
      }
    }
    originalExit(1);
  }
}

function restoreInheritedNodeOptions() {
  if (!Object.hasOwn(process.env, INHERITED_NODE_OPTIONS_ENV)) return;

  const inherited = process.env[INHERITED_NODE_OPTIONS_ENV];
  if (inherited) {
    process.env.NODE_OPTIONS = inherited;
  } else {
    delete process.env.NODE_OPTIONS;
  }
  delete process.env[INHERITED_NODE_OPTIONS_ENV];
}

function readDrainTimeoutMs() {
  if (process.env.NODE_ENV !== "test") return DEFAULT_DRAIN_TIMEOUT_MS;

  const raw = process.env[TEST_DRAIN_TIMEOUT_ENV];
  if (!raw || !/^\d{2,5}$/u.test(raw)) return DEFAULT_DRAIN_TIMEOUT_MS;

  const parsed = Number(raw);
  return parsed >= 50 && parsed <= 10_000
    ? parsed
    : DEFAULT_DRAIN_TIMEOUT_MS;
}

function writeLifecycleLog(event, fields) {
  const details = Object.entries(fields)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  const line = `event=${event} ${details}\n`;

  try {
    fs.writeSync(process.stderr.fd, line.slice(0, 512));
  } catch {
    // Logging must never prevent or extend a bounded shutdown.
  }
}

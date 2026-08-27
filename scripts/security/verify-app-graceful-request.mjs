#!/usr/bin/env node

import { spawn } from "node:child_process";
import { connect } from "node:net";

const [baseUrlValue, trustedOriginValue, containerName, graceSecondsValue = "120"] =
  process.argv.slice(2);
const dockerBinary = process.env.CLEAN_PAY_DOCKER_BIN?.trim() || "docker";
const graceSeconds = Number(graceSecondsValue);

function usage() {
  return "usage: verify-app-graceful-request.mjs BASE_URL TRUSTED_HTTPS_ORIGIN CONTAINER_NAME [GRACE_SECONDS]";
}

function parseInputs() {
  let baseUrl;
  let trustedOrigin;
  try {
    baseUrl = new URL(baseUrlValue ?? "");
    trustedOrigin = new URL(trustedOriginValue ?? "");
  } catch {
    throw new Error(usage());
  }

  const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (
    baseUrl.protocol !== "http:"
    || !loopbackHosts.has(baseUrl.hostname)
    || !baseUrl.port
    || Number(baseUrl.port) < 1
    || Number(baseUrl.port) > 65_535
    || baseUrl.username
    || baseUrl.password
    || baseUrl.search
    || baseUrl.hash
    || baseUrl.pathname !== "/"
    || trustedOrigin.protocol !== "https:"
    || trustedOrigin.username
    || trustedOrigin.password
    || trustedOrigin.pathname !== "/"
    || trustedOrigin.search
    || trustedOrigin.hash
    || !containerName
    || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(containerName)
    || !Number.isSafeInteger(graceSeconds)
    || graceSeconds < 30
    || graceSeconds > 120
  ) {
    throw new Error(usage());
  }

  return { baseUrl, trustedOrigin: trustedOrigin.origin };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function runDocker(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const output = { stdout: "", stderr: "" };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const child = spawn(dockerBinary, args, {
      shell: false,
      windowsHide: true,
      signal: controller.signal,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const append = (key, chunk) => {
      output[key] += chunk.toString("utf8");
      if (Buffer.byteLength(output[key]) > 64 * 1024) {
        controller.abort();
      }
    };
    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`docker ${args[0]} failed (${code ?? signal ?? "unknown"})`));
        return;
      }
      resolve(output.stdout.trim());
    });
  });
}

function openSlowMutation({ baseUrl, trustedOrigin }) {
  const requestBody = Buffer.from(`probe=${"x".repeat(32 * 1024)}`, "utf8");
  const splitAt = 16;
  const requestHead = Buffer.from([
    "POST /login HTTP/1.1",
    `Host: ${baseUrl.host}`,
    `Origin: ${trustedOrigin}`,
    "Content-Type: application/x-www-form-urlencoded",
    `Content-Length: ${requestBody.byteLength}`,
    "Connection: close",
    "",
    "",
  ].join("\r\n"), "utf8");

  let responseBytes = 0;
  const responseChunks = [];
  let settled = false;
  let finish;
  let fail;
  const response = new Promise((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const socket = connect({
    host: baseUrl.hostname.replace(/^\[(.*)\]$/, "$1"),
    port: Number(baseUrl.port),
  });
  socket.setTimeout(20_000);
  socket.once("connect", () => {
    socket.write(requestHead);
    socket.write(requestBody.subarray(0, splitAt));
  });
  socket.on("data", (chunk) => {
    responseBytes += chunk.byteLength;
    if (responseBytes > 2 * 1024 * 1024) {
      socket.destroy(new Error("graceful response exceeded 2 MiB"));
      return;
    }
    responseChunks.push(chunk);
  });
  socket.once("timeout", () => socket.destroy(new Error("graceful request timed out")));
  socket.once("error", (error) => {
    if (!settled) {
      settled = true;
      fail(error);
    }
  });
  socket.once("close", (hadError) => {
    if (settled || hadError) return;
    settled = true;
    finish(Buffer.concat(responseChunks).toString("utf8"));
  });

  return {
    response,
    hasResponse: () => responseBytes > 0,
    finishRequest: () => {
      if (socket.destroyed) throw new Error("request socket closed before its body completed");
      socket.end(requestBody.subarray(splitAt));
    },
  };
}

const inputs = parseInputs();
const startedAt = Date.now();
const request = openSlowMutation(inputs);

// Give Next.js enough time to admit the request and block on its bounded body
// reader. Receiving any response here would mean this is not an in-flight probe.
await wait(1_500);
if (request.hasResponse()) {
  throw new Error("server responded before the admitted request body was complete");
}

const stop = runDocker(
  ["stop", "--time", String(graceSeconds), containerName],
  (graceSeconds + 10) * 1_000,
);

// The body completes only after Docker has begun graceful termination. A server
// that tears down admitted sockets on SIGTERM will fail before producing a full
// response; Next's graceful close must instead drain it.
await wait(1_500);
request.finishRequest();
const [rawResponse] = await Promise.all([request.response, stop]);

const statusMatch = /^HTTP\/1\.[01] (\d{3})\b/.exec(rawResponse);
if (!statusMatch) throw new Error("graceful request did not receive a complete HTTP response");
const status = Number(statusMatch[1]);
if (status === 403 || status === 413) {
  throw new Error(`admitted graceful request was rejected by the boundary (${status})`);
}

const state = await runDocker(
  ["inspect", "--format", "{{.State.Running}}|{{.State.ExitCode}}", containerName],
  10_000,
);
const stateMatch = /^(true|false)\|(\d+)$/.exec(state);
if (!stateMatch || stateMatch[1] !== "false" || Number(stateMatch[2]) === 137) {
  throw new Error("application did not finish within its graceful-stop budget");
}

process.stdout.write(
  `In-flight application request drained after SIGTERM: status=${status} exit=${stateMatch[2]} durationMs=${Date.now() - startedAt}.\n`,
);

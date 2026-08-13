import net from "node:net";
import tls from "node:tls";

import { ServiceError } from "@/backend/errors/service-error";

type RedisValue = string | number | null;
type RedisSocket = net.Socket | tls.TLSSocket;

type QueuedCommand = {
  parts: RedisValue[];
  deadlineAt: number;
  resolve(value: unknown): void;
  reject(error: ServiceError): void;
};

const REDIS_CONNECT_TIMEOUT_MS = 2_000;
const REDIS_COMMAND_DEADLINE_MS = 3_000;
const REDIS_MAX_RESPONSE_BYTES = 1024 * 1024;
const REDIS_MAX_QUEUED_COMMANDS = 128;
const REDIS_RECONNECT_BASE_DELAY_MS = 25;
const REDIS_RECONNECT_MAX_DELAY_MS = 500;
const REDIS_RECONNECT_JITTER_MS = 25;

class RedisAdapterError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RedisAdapterError";
  }
}

class RedisCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedisCommandError";
  }
}

function getRedisUrl() {
  const value = process.env.REDIS_URL;

  if (!value) {
    throw new ServiceError(
      "UPSTREAM_UNAVAILABLE",
      503,
      "REDIS_URL is required for rate limiting",
      { message: "REDIS_URL is required" },
    );
  }

  return value;
}

function parsedRedisUrl(value: string) {
  let url: URL;

  try {
    url = new URL(value);
  } catch (error) {
    throw new RedisAdapterError("REDIS_URL is invalid", { cause: error });
  }

  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new RedisAdapterError("REDIS_URL must use redis: or rediss:");
  }

  return url;
}

function encodeCommand(parts: RedisValue[]) {
  const chunks = parts.map((part) => {
    const value = part === null ? "" : String(part);

    return `$${Buffer.byteLength(value)}\r\n${value}\r\n`;
  });

  return `*${parts.length}\r\n${chunks.join("")}`;
}

function parseBulk(buffer: Buffer, offset: number) {
  const end = buffer.indexOf("\r\n", offset);

  if (end < 0) {
    throw new RangeError("Incomplete Redis bulk length");
  }

  const length = Number(buffer.subarray(offset, end).toString("utf8"));

  if (!Number.isInteger(length)) {
    throw new RedisAdapterError("Invalid Redis bulk length");
  }

  if (length < 0) {
    return { value: null, offset: end + 2 };
  }

  const start = end + 2;
  const nextOffset = start + length + 2;

  if (buffer.length < nextOffset) {
    throw new RangeError("Incomplete Redis bulk value");
  }

  if (buffer[start + length] !== 13 || buffer[start + length + 1] !== 10) {
    throw new RedisAdapterError("Invalid Redis bulk terminator");
  }

  const value = buffer.subarray(start, start + length).toString("utf8");

  return { value, offset: nextOffset };
}

function parseArray(buffer: Buffer, offset: number) {
  const end = buffer.indexOf("\r\n", offset);

  if (end < 0) {
    throw new RangeError("Incomplete Redis array length");
  }

  const length = Number(buffer.subarray(offset, end).toString("utf8"));

  if (!Number.isInteger(length)) {
    throw new RedisAdapterError("Invalid Redis array length");
  }

  if (length < 0) {
    return { value: null, offset: end + 2 };
  }

  const values: unknown[] = [];
  let cursor = end + 2;

  for (let index = 0; index < length; index += 1) {
    const parsed = parseRedisResponse(buffer, cursor);
    if (parsed.value instanceof RedisCommandError) {
      throw parsed.value;
    }
    values.push(parsed.value);
    cursor = parsed.offset;
  }

  return { value: values, offset: cursor };
}

function parseRedisResponse(
  buffer: Buffer,
  offset = 0,
): { value: unknown; offset: number } {
  if (offset >= buffer.length) {
    throw new RangeError("Incomplete Redis response");
  }

  const type = String.fromCharCode(buffer[offset]);
  const start = offset + 1;
  const end = buffer.indexOf("\r\n", start);

  if (end < 0 && type !== "$" && type !== "*") {
    throw new RangeError("Incomplete Redis response");
  }

  if (type === "+") {
    return {
      value: buffer.subarray(start, end).toString("utf8"),
      offset: end + 2,
    };
  }

  if (type === "-") {
    return {
      value: new RedisCommandError(
        buffer.subarray(start, end).toString("utf8"),
      ),
      offset: end + 2,
    };
  }

  if (type === ":") {
    return {
      value: Number(buffer.subarray(start, end).toString("utf8")),
      offset: end + 2,
    };
  }

  if (type === "$") {
    return parseBulk(buffer, start);
  }

  if (type === "*") {
    return parseArray(buffer, start);
  }

  throw new RedisAdapterError("Unsupported Redis response");
}

function connectRedis(url: URL) {
  const port = Number(url.port || (url.protocol === "rediss:" ? 6380 : 6379));
  const host = url.hostname;

  return url.protocol === "rediss:"
    ? tls.connect({ host, port, servername: host })
    : net.connect({ host, port });
}

function remainingMs(deadlineAt: number) {
  return Math.max(0, deadlineAt - Date.now());
}

function destroySocket(socket: RedisSocket, error?: Error) {
  // destroy(error) emits an asynchronous error event. Keep a one-shot sink so
  // timeout cleanup can never surface an uncaught process-level error.
  if (error && socket.listenerCount("error") === 0) {
    socket.once("error", () => undefined);
  }
  socket.destroy(error);
}

async function waitForConnection(
  socket: RedisSocket,
  event: "connect" | "secureConnect",
  deadlineAt: number,
) {
  const timeoutMs = Math.min(
    REDIS_CONNECT_TIMEOUT_MS,
    remainingMs(deadlineAt),
  );

  if (timeoutMs <= 0) {
    throw new RedisAdapterError("Redis connection deadline exceeded");
  }

  await new Promise<void>((resolve, reject) => {
    function cleanup() {
      clearTimeout(timer);
      socket.off(event, onConnect);
      socket.off("error", onError);
      socket.off("close", onClose);
    }

    function finish(error?: Error) {
      cleanup();
      if (error) reject(error);
      else resolve();
    }

    function onConnect() {
      finish();
    }

    function onError(error: Error) {
      finish(error);
    }

    function onClose() {
      finish(
        new RedisAdapterError("Redis connection closed before it was ready"),
      );
    }

    socket.once(event, onConnect);
    socket.once("error", onError);
    socket.once("close", onClose);
    const timer = setTimeout(
      () => finish(
        new RedisAdapterError(
          `Redis connection timed out after ${timeoutMs}ms`,
        ),
      ),
      timeoutMs,
    );
  });
}

function unavailable(error: unknown) {
  if (error instanceof ServiceError) {
    return error;
  }

  return new ServiceError(
    "UPSTREAM_UNAVAILABLE",
    503,
    "Redis is unavailable",
    {
      message: error instanceof Error ? error.message : String(error),
      cause: error,
    },
  );
}

class PersistentRedisTransport {
  readonly urlString: string;
  private readonly url: URL;
  private socket: RedisSocket | null = null;
  private connectingSocket: RedisSocket | null = null;
  private responseBuffer = Buffer.alloc(0);
  private queue: QueuedCommand[] = [];
  private draining = false;
  private closed = false;
  private consecutiveFailures = 0;
  private reconnectNotBefore = 0;

  constructor(urlString: string) {
    this.urlString = urlString;
    this.url = parsedRedisUrl(urlString);
  }

  command(parts: RedisValue[]) {
    if (this.closed) {
      return Promise.reject(unavailable(
        new RedisAdapterError("Redis transport is closed"),
      ));
    }

    if (this.queue.length >= REDIS_MAX_QUEUED_COMMANDS) {
      return Promise.reject(unavailable(
        new RedisAdapterError(
          `Redis command queue exceeded ${REDIS_MAX_QUEUED_COMMANDS} entries`,
        ),
      ));
    }

    return new Promise<unknown>((resolve, reject) => {
      this.queue.push({
        parts,
        deadlineAt: Date.now() + REDIS_COMMAND_DEADLINE_MS,
        resolve,
        reject,
      });
      void this.drain();
    });
  }

  close() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    const error = unavailable(new RedisAdapterError("Redis transport closed"));
    for (const command of this.queue.splice(0)) {
      command.reject(error);
    }

    const socket = this.socket;
    this.socket = null;
    const connectingSocket = this.connectingSocket;
    this.connectingSocket = null;
    this.responseBuffer = Buffer.alloc(0);
    if (socket && !socket.destroyed) {
      destroySocket(socket);
    }
    if (connectingSocket && !connectingSocket.destroyed) {
      destroySocket(connectingSocket);
    }
  }

  private async drain() {
    if (this.draining || this.closed) {
      return;
    }

    this.draining = true;

    try {
      while (!this.closed) {
        const command = this.queue.shift();

        if (!command) {
          break;
        }

        if (remainingMs(command.deadlineAt) <= 0) {
          command.reject(unavailable(
            new RedisAdapterError("Redis command deadline exceeded in queue"),
          ));
          continue;
        }

        try {
          const value = await this.execute(command.parts, command.deadlineAt);
          command.resolve(value);
        } catch (error) {
          command.reject(unavailable(error));
        }
      }
    } finally {
      this.draining = false;
      if (!this.closed && this.queue.length > 0) {
        void this.drain();
      }
    }
  }

  private async execute(parts: RedisValue[], deadlineAt: number) {
    const socket = await this.ensureConnected(deadlineAt);

    try {
      const value = await this.sendCommand(socket, parts, deadlineAt);
      this.consecutiveFailures = 0;
      this.reconnectNotBefore = 0;
      return value;
    } catch (error) {
      if (!(error instanceof RedisCommandError)) {
        this.invalidateSocket(socket, error);
      }
      throw error;
    }
  }

  private async ensureConnected(deadlineAt: number) {
    if (this.closed) {
      throw new RedisAdapterError("Redis transport is closed");
    }

    if (this.socket && !this.socket.destroyed) {
      return this.socket;
    }

    await this.waitForReconnect(deadlineAt);
    if (this.closed) {
      throw new RedisAdapterError("Redis transport is closed");
    }
    const socket = connectRedis(this.url);
    this.connectingSocket = socket;

    try {
      await waitForConnection(
        socket,
        this.url.protocol === "rediss:" ? "secureConnect" : "connect",
        deadlineAt,
      );
    } catch (error) {
      if (this.connectingSocket === socket) {
        this.connectingSocket = null;
      }
      if (!socket.destroyed) {
        destroySocket(socket, error instanceof Error ? error : undefined);
      }
      this.recordFailure();
      throw error;
    }

    if (this.connectingSocket === socket) {
      this.connectingSocket = null;
    }
    if (this.closed || socket.destroyed) {
      if (!socket.destroyed) {
        destroySocket(socket);
      }
      this.recordFailure();
      throw new RedisAdapterError(
        this.closed
          ? "Redis transport is closed"
          : "Redis connection closed before initialization",
      );
    }

    this.socket = socket;
    this.responseBuffer = Buffer.alloc(0);
    socket.on("error", (error) => {
      // Let the currently active command listener observe the original socket
      // error before the shared idle-connection cleanup emits `close`.
      queueMicrotask(() => {
        if (this.socket === socket) {
          this.invalidateSocket(socket, error);
        }
      });
    });
    socket.on("close", () => {
      if (this.socket === socket) {
        this.socket = null;
        this.responseBuffer = Buffer.alloc(0);
        this.recordFailure();
      }
    });

    try {
      if (this.url.username || this.url.password) {
        if (this.url.username) {
          await this.sendCommand(socket, [
            "AUTH",
            decodeURIComponent(this.url.username),
            decodeURIComponent(this.url.password),
          ], deadlineAt);
        } else {
          await this.sendCommand(socket, [
            "AUTH",
            decodeURIComponent(this.url.password),
          ], deadlineAt);
        }
      }

      const db = this.url.pathname.replace(/^\//, "");
      if (db) {
        await this.sendCommand(socket, ["SELECT", db], deadlineAt);
      }
      return socket;
    } catch (error) {
      this.invalidateSocket(socket, error);
      throw error;
    }
  }

  private async waitForReconnect(deadlineAt: number) {
    const delayMs = Math.max(0, this.reconnectNotBefore - Date.now());

    if (delayMs === 0) {
      return;
    }

    if (delayMs >= remainingMs(deadlineAt)) {
      throw new RedisAdapterError("Redis reconnect deadline exceeded");
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  private recordFailure() {
    this.consecutiveFailures += 1;
    const exponentialDelay = Math.min(
      REDIS_RECONNECT_MAX_DELAY_MS,
      REDIS_RECONNECT_BASE_DELAY_MS
        * (2 ** Math.min(this.consecutiveFailures - 1, 5)),
    );
    const jitter = Math.floor(Math.random() * REDIS_RECONNECT_JITTER_MS);
    this.reconnectNotBefore = Date.now() + exponentialDelay + jitter;
  }

  private invalidateSocket(socket: RedisSocket, error: unknown) {
    if (this.socket === socket) {
      this.socket = null;
      this.responseBuffer = Buffer.alloc(0);
      this.recordFailure();
    }

    if (!socket.destroyed) {
      destroySocket(
        socket,
        error instanceof Error ? error : new RedisAdapterError(String(error)),
      );
    }
  }

  private sendCommand(
    socket: RedisSocket,
    parts: RedisValue[],
    deadlineAt: number,
  ) {
    const response = this.readResponse(socket, deadlineAt);

    try {
      socket.write(encodeCommand(parts));
    } catch (error) {
      void response.catch(() => undefined);
      throw error;
    }

    return response;
  }

  private readResponse(socket: RedisSocket, deadlineAt: number) {
    const timeoutMs = remainingMs(deadlineAt);

    if (timeoutMs <= 0) {
      return Promise.reject(
        new RedisAdapterError("Redis command deadline exceeded"),
      );
    }

    return new Promise<unknown>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        clearTimeout(timer);
        socket.off("data", onData);
        socket.off("error", onError);
        socket.off("close", onClose);
      };
      const finish = (error?: unknown, value?: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve(value);
      };
      const parseBufferedResponse = () => {
        if (this.responseBuffer.length > REDIS_MAX_RESPONSE_BYTES) {
          finish(new RedisAdapterError(
            `Redis response exceeded ${REDIS_MAX_RESPONSE_BYTES} bytes`,
          ));
          return;
        }

        try {
          const parsed = parseRedisResponse(this.responseBuffer);
          if (parsed.offset !== this.responseBuffer.length) {
            finish(new RedisAdapterError(
              "Redis returned an unexpected extra response",
            ));
            return;
          }
          this.responseBuffer = this.responseBuffer.subarray(parsed.offset);
          if (parsed.value instanceof RedisCommandError) {
            finish(parsed.value);
          } else {
            finish(undefined, parsed.value);
          }
        } catch (error) {
          if (!(error instanceof RangeError)) {
            finish(error);
          }
        }
      };
      const onData = (chunk: Buffer) => {
        this.responseBuffer = Buffer.concat([this.responseBuffer, chunk]);
        parseBufferedResponse();
      };
      const onError = (error: Error) => finish(error);
      const onClose = () => finish(
        new RedisAdapterError("Redis connection closed"),
      );

      socket.on("data", onData);
      socket.on("error", onError);
      socket.on("close", onClose);
      const timer = setTimeout(
        () => finish(
          new RedisAdapterError(`Redis command timed out after ${timeoutMs}ms`),
        ),
        timeoutMs,
      );
      parseBufferedResponse();
    });
  }
}

type RedisTransportGlobal = typeof globalThis & {
  __cleanPayRedisTransportV1?: PersistentRedisTransport;
};

const redisGlobal = globalThis as RedisTransportGlobal;
let productionTransport: PersistentRedisTransport | undefined;

function currentTransport(urlString: string) {
  const developmentCache = process.env.NODE_ENV !== "production";
  const cached = developmentCache
    ? redisGlobal.__cleanPayRedisTransportV1
    : productionTransport;

  if (cached?.urlString === urlString) {
    return cached;
  }

  cached?.close();
  const transport = new PersistentRedisTransport(urlString);
  if (developmentCache) {
    redisGlobal.__cleanPayRedisTransportV1 = transport;
  } else {
    productionTransport = transport;
  }
  return transport;
}

export async function redisCommand(parts: RedisValue[]) {
  try {
    return await currentTransport(getRedisUrl()).command(parts);
  } catch (error) {
    throw unavailable(error);
  }
}

export async function resetRedisTransportForTests() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Redis test transport reset is disabled in production");
  }

  const transports = new Set([
    redisGlobal.__cleanPayRedisTransportV1,
    productionTransport,
  ]);
  for (const transport of transports) {
    transport?.close();
  }
  redisGlobal.__cleanPayRedisTransportV1 = undefined;
  productionTransport = undefined;
  await Promise.resolve();
}

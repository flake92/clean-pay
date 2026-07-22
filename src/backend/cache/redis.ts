import net from 'node:net';
import tls from 'node:tls';

import { BffError } from '@/backend/integrations/remnashop/errors';

type RedisValue = string | number | null;

export const REDIS_CONNECT_TIMEOUT_MS = 2_000;
export const REDIS_COMMAND_DEADLINE_MS = 3_000;
export const REDIS_MAX_RESPONSE_BYTES = 1024 * 1024;

class RedisAdapterError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RedisAdapterError';
  }
}

function getRedisUrl() {
  const value = process.env.REDIS_URL;

  if (!value) {
    throw new BffError('UPSTREAM_UNAVAILABLE', 503, 'REDIS_URL is required for rate limiting', {
      message: 'REDIS_URL is required',
    });
  }

  return value;
}

function encodeCommand(parts: RedisValue[]) {
  const chunks = parts.map((part) => {
    const value = part === null ? '' : String(part);

    return `$${Buffer.byteLength(value)}\r\n${value}\r\n`;
  });

  return `*${parts.length}\r\n${chunks.join('')}`;
}

function parseBulk(buffer: Buffer, offset: number) {
  const end = buffer.indexOf('\r\n', offset);

  if (end < 0) {
    throw new RangeError('Incomplete Redis bulk length');
  }

  const length = Number(buffer.subarray(offset, end).toString('utf8'));

  if (length < 0) {
    return { value: null, offset: end + 2 };
  }

  const start = end + 2;
  const nextOffset = start + length + 2;

  if (buffer.length < nextOffset) {
    throw new RangeError('Incomplete Redis bulk value');
  }

  const value = buffer.subarray(start, start + length).toString('utf8');

  return { value, offset: nextOffset };
}

function parseArray(buffer: Buffer, offset: number) {
  const end = buffer.indexOf('\r\n', offset);

  if (end < 0) {
    throw new RangeError('Incomplete Redis array length');
  }

  const length = Number(buffer.subarray(offset, end).toString('utf8'));
  const values: unknown[] = [];
  let cursor = end + 2;

  for (let index = 0; index < length; index += 1) {
    const parsed = parseRedisResponse(buffer, cursor);
    values.push(parsed.value);
    cursor = parsed.offset;
  }

  return { value: values, offset: cursor };
}

function parseRedisResponse(buffer: Buffer, offset = 0): { value: unknown; offset: number } {
  const type = String.fromCharCode(buffer[offset]);
  const start = offset + 1;
  const end = buffer.indexOf('\r\n', start);

  if (end < 0 && type !== '$' && type !== '*') {
    throw new RangeError('Incomplete Redis response');
  }

  if (type === '+') {
    return { value: buffer.subarray(start, end).toString('utf8'), offset: end + 2 };
  }

  if (type === '-') {
    throw new Error(buffer.subarray(start, end).toString('utf8'));
  }

  if (type === ':') {
    return { value: Number(buffer.subarray(start, end).toString('utf8')), offset: end + 2 };
  }

  if (type === '$') {
    return parseBulk(buffer, start);
  }

  if (type === '*') {
    return parseArray(buffer, start);
  }

  throw new Error('Unsupported Redis response');
}

function connectRedis(url: URL) {
  const port = Number(url.port || (url.protocol === 'rediss:' ? 6380 : 6379));
  const host = url.hostname;

  return url.protocol === 'rediss:'
    ? tls.connect({ host, port, servername: host })
    : net.connect({ host, port });
}

function remainingMs(deadlineAt: number) {
  return Math.max(0, deadlineAt - Date.now());
}

function destroySocket(socket: net.Socket | tls.TLSSocket, error: Error) {
  // destroy(error) emits an asynchronous error event. Keep a one-shot sink
  // after operation listeners are removed so timeout cleanup cannot surface an
  // uncaught process-level error.
  if (socket.listenerCount('error') === 0) {
    socket.once('error', () => undefined);
  }
  socket.destroy(error);
}

async function waitForConnection(
  socket: net.Socket | tls.TLSSocket,
  event: 'connect' | 'secureConnect',
  deadlineAt: number,
) {
  const timeoutMs = Math.min(REDIS_CONNECT_TIMEOUT_MS, remainingMs(deadlineAt));

  if (timeoutMs <= 0) {
    throw new RedisAdapterError('Redis connection deadline exceeded');
  }

  await new Promise<void>((resolve, reject) => {
    function cleanup() {
      clearTimeout(timer);
      socket.off(event, onConnect);
      socket.off('error', onError);
      socket.off('close', onClose);
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
      finish(new RedisAdapterError('Redis connection closed before it was ready'));
    }

    socket.once(event, onConnect);
    socket.once('error', onError);
    socket.once('close', onClose);
    const timer = setTimeout(
      () => finish(new RedisAdapterError(`Redis connection timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
}

async function readResponse(socket: net.Socket | tls.TLSSocket, deadlineAt: number) {
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  const timeoutMs = remainingMs(deadlineAt);

  if (timeoutMs <= 0) {
    throw new RedisAdapterError('Redis command deadline exceeded');
  }

  return new Promise<unknown>((resolve, reject) => {
    function cleanup() {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    }

    function onError(error: Error) {
      cleanup();
      reject(error);
    }

    function onClose() {
      cleanup();
      reject(new Error('Redis connection closed'));
    }

    function onData(chunk: Buffer) {
      receivedBytes += chunk.length;

      if (receivedBytes > REDIS_MAX_RESPONSE_BYTES) {
        cleanup();
        reject(new RedisAdapterError(`Redis response exceeded ${REDIS_MAX_RESPONSE_BYTES} bytes`));
        return;
      }

      chunks.push(chunk);

      try {
        const parsed = parseRedisResponse(Buffer.concat(chunks));
        cleanup();
        resolve(parsed.value);
      } catch (error) {
        if (error instanceof RangeError) {
          return;
        }

        cleanup();
        reject(error);
      }
    }

    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
    const timer = setTimeout(
      () => {
        cleanup();
        reject(new RedisAdapterError(`Redis command timed out after ${timeoutMs}ms`));
      },
      timeoutMs,
    );
  });
}

async function sendCommand(
  socket: net.Socket | tls.TLSSocket,
  parts: RedisValue[],
  deadlineAt: number,
) {
  socket.write(encodeCommand(parts));

  return readResponse(socket, deadlineAt);
}

export async function redisCommand(parts: RedisValue[]) {
  let socket: net.Socket | tls.TLSSocket | undefined;

  try {
    const url = new URL(getRedisUrl());
    const deadlineAt = Date.now() + REDIS_COMMAND_DEADLINE_MS;
    socket = connectRedis(url);
    await waitForConnection(
      socket,
      url.protocol === 'rediss:' ? 'secureConnect' : 'connect',
      deadlineAt,
    );

    if (url.username || url.password) {
      if (url.username) {
        await sendCommand(socket, ['AUTH', decodeURIComponent(url.username), decodeURIComponent(url.password)], deadlineAt);
      } else {
        await sendCommand(socket, ['AUTH', decodeURIComponent(url.password)], deadlineAt);
      }
    }

    const db = url.pathname.replace(/^\//, '');

    if (db) {
      await sendCommand(socket, ['SELECT', db], deadlineAt);
    }

    return await sendCommand(socket, parts, deadlineAt);
  } catch (error) {
    if (socket && !socket.destroyed) {
      destroySocket(socket, error instanceof Error ? error : new RedisAdapterError(String(error)));
    }

    if (error instanceof BffError) {
      throw error;
    }

    throw new BffError('UPSTREAM_UNAVAILABLE', 503, 'Redis is unavailable', {
      message: error instanceof Error ? error.message : String(error),
      cause: error,
    });
  } finally {
    if (socket && !socket.destroyed) socket.end();
  }
}

import net from 'node:net';
import tls from 'node:tls';

import { BffError } from '@/backend/integrations/remnashop/errors';

type RedisValue = string | number | null;

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

async function readResponse(socket: net.Socket | tls.TLSSocket) {
  const chunks: Buffer[] = [];

  return new Promise<unknown>((resolve, reject) => {
    function cleanup() {
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
  });
}

async function sendCommand(socket: net.Socket | tls.TLSSocket, parts: RedisValue[]) {
  socket.write(encodeCommand(parts));

  return readResponse(socket);
}

export async function redisCommand(parts: RedisValue[]) {
  const url = new URL(getRedisUrl());
  const socket = connectRedis(url);

  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });

  try {
    if (url.username || url.password) {
      if (url.username) {
        await sendCommand(socket, ['AUTH', decodeURIComponent(url.username), decodeURIComponent(url.password)]);
      } else {
        await sendCommand(socket, ['AUTH', decodeURIComponent(url.password)]);
      }
    }

    const db = url.pathname.replace(/^\//, '');

    if (db) {
      await sendCommand(socket, ['SELECT', db]);
    }

    return await sendCommand(socket, parts);
  } finally {
    socket.end();
  }
}

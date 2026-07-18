import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

class FakeSocket extends EventEmitter {
  writes: string[] = [];
  responses: Buffer[] = [];

  write(chunk: string) {
    this.writes.push(chunk);
    const response = this.responses.shift();

    if (response) {
      queueMicrotask(() => this.emit("data", response));
    }
  }

  end() {
    this.emit("end");
  }
}

const state = vi.hoisted(() => ({
  tcpSocket: null as FakeSocket | null,
  tlsSocket: null as FakeSocket | null,
}));

vi.mock("node:net", () => ({
  default: {
    connect: vi.fn(() => {
      state.tcpSocket = new FakeSocket();
      queueMicrotask(() => state.tcpSocket?.emit("connect"));
      return state.tcpSocket;
    }),
  },
}));

vi.mock("node:tls", () => ({
  default: {
    connect: vi.fn(() => {
      state.tlsSocket = new FakeSocket();
      queueMicrotask(() => state.tlsSocket?.emit("connect"));
      return state.tlsSocket;
    }),
  },
}));

import { redisCommand } from "@/backend/cache/redis";

describe("raw Redis command adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.tcpSocket = null;
    state.tlsSocket = null;
    process.env.REDIS_URL = "redis://localhost:6379/0";
  });

  it("requires REDIS_URL", async () => {
    delete process.env.REDIS_URL;

    await expect(redisCommand(["PING"])).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      status: 503,
    });
  });

  it("encodes a command and parses simple string responses", async () => {
    const promise = redisCommand(["PING"]);
    await vi.waitFor(() => expect(state.tcpSocket).toBeTruthy());
    state.tcpSocket?.responses.push(Buffer.from("+OK\r\n"), Buffer.from("+PONG\r\n"));

    await expect(promise).resolves.toBe("PONG");
    expect(state.tcpSocket?.writes[0]).toBe("*2\r\n$6\r\nSELECT\r\n$1\r\n0\r\n");
    expect(state.tcpSocket?.writes[1]).toBe("*1\r\n$4\r\nPING\r\n");
  });

  it("authenticates, selects db and parses integer, bulk, null and array responses", async () => {
    process.env.REDIS_URL = "redis://user:pass@localhost:6379/2";
    const promise = redisCommand(["MGET", "a", "b"]);
    await vi.waitFor(() => expect(state.tcpSocket).toBeTruthy());
    state.tcpSocket?.responses.push(
      Buffer.from("+OK\r\n"),
      Buffer.from("+OK\r\n"),
      Buffer.from("*4\r\n:1\r\n$5\r\nhello\r\n$-1\r\n+OK\r\n"),
    );

    await expect(promise).resolves.toEqual([1, "hello", null, "OK"]);
    expect(state.tcpSocket?.writes[0]).toBe("*3\r\n$4\r\nAUTH\r\n$4\r\nuser\r\n$4\r\npass\r\n");
    expect(state.tcpSocket?.writes[1]).toBe("*2\r\n$6\r\nSELECT\r\n$1\r\n2\r\n");
  });

  it("uses TLS for rediss and supports password-only auth", async () => {
    process.env.REDIS_URL = "rediss://:secret@redis.example.test:6380";
    const promise = redisCommand(["INCR", "key"]);
    await vi.waitFor(() => expect(state.tlsSocket).toBeTruthy());
    state.tlsSocket?.responses.push(Buffer.from("+OK\r\n"), Buffer.from(":2\r\n"));

    await expect(promise).resolves.toBe(2);
    expect(state.tlsSocket?.writes[0]).toBe("*2\r\n$4\r\nAUTH\r\n$6\r\nsecret\r\n");
  });

  it("rejects Redis error and unsupported responses", async () => {
    let promise = redisCommand(["PING"]);
    await vi.waitFor(() => expect(state.tcpSocket).toBeTruthy());
    state.tcpSocket?.responses.push(Buffer.from("-ERR nope\r\n"));
    await expect(promise).rejects.toThrow("ERR nope");

    state.tcpSocket = null;
    promise = redisCommand(["PING"]);
    await vi.waitFor(() => expect(state.tcpSocket).toBeTruthy());
    (state.tcpSocket as FakeSocket | null)?.responses.push(Buffer.from("?wat\r\n"));
    await expect(promise).rejects.toThrow("Unsupported Redis response");
  });
});

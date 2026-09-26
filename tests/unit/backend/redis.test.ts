import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeSocket extends EventEmitter {
  destroyed = false;
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

  destroy(error?: Error) {
    this.destroyed = true;
    if (error) queueMicrotask(() => this.emit("error", error));
    this.emit("close");
    return this;
  }
}

async function respond(
  socket: FakeSocket | null,
  writeCount: number,
  response: string | Buffer,
) {
  await vi.waitFor(() => expect(socket?.writes).toHaveLength(writeCount));
  socket?.emit(
    "data",
    typeof response === "string" ? Buffer.from(response) : response,
  );
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
      queueMicrotask(() => state.tlsSocket?.emit("secureConnect"));
      return state.tlsSocket;
    }),
  },
}));

import {
  redisCommand,
  resetRedisTransportForTests,
} from "@/backend/cache/redis";

describe("persistent Redis command adapter", () => {
  beforeEach(async () => {
    await resetRedisTransportForTests();
    vi.clearAllMocks();
    state.tcpSocket = null;
    state.tlsSocket = null;
    process.env.REDIS_URL = "redis://localhost:6379/0";
  });

  afterEach(async () => {
    await resetRedisTransportForTests();
    vi.useRealTimers();
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
    await respond(state.tcpSocket, 1, "+OK\r\n");
    await respond(state.tcpSocket, 2, "+PONG\r\n");

    await expect(promise).resolves.toBe("PONG");
    expect(state.tcpSocket?.writes[0]).toBe("*2\r\n$6\r\nSELECT\r\n$1\r\n0\r\n");
    expect(state.tcpSocket?.writes[1]).toBe("*1\r\n$4\r\nPING\r\n");
  });

  it("authenticates, selects db and parses integer, bulk, null and array responses", async () => {
    process.env.REDIS_URL = "redis://user:pass@localhost:6379/2";
    const promise = redisCommand(["MGET", "a", "b"]);
    await vi.waitFor(() => expect(state.tcpSocket).toBeTruthy());
    await respond(state.tcpSocket, 1, "+OK\r\n");
    await respond(state.tcpSocket, 2, "+OK\r\n");
    await respond(
      state.tcpSocket,
      3,
      "*4\r\n:1\r\n$5\r\nhello\r\n$-1\r\n+OK\r\n",
    );

    await expect(promise).resolves.toEqual([1, "hello", null, "OK"]);
    expect(state.tcpSocket?.writes[0]).toBe("*3\r\n$4\r\nAUTH\r\n$4\r\nuser\r\n$4\r\npass\r\n");
    expect(state.tcpSocket?.writes[1]).toBe("*2\r\n$6\r\nSELECT\r\n$1\r\n2\r\n");
  });

  it("serializes concurrent commands and reuses one authenticated connection", async () => {
    process.env.REDIS_URL = "redis://user:pass@localhost:6379/2";
    const first = redisCommand(["GET", "first"]);
    const second = redisCommand(["GET", "second"]);
    await vi.waitFor(() => expect(state.tcpSocket).toBeTruthy());

    await respond(state.tcpSocket, 1, "+OK\r\n");
    await respond(state.tcpSocket, 2, "+OK\r\n");
    await respond(state.tcpSocket, 3, "$3\r\none\r\n");
    await respond(state.tcpSocket, 4, "$3\r\ntwo\r\n");
    await expect(Promise.all([first, second])).resolves.toEqual(["one", "two"]);

    const third = redisCommand(["GET", "third"]);
    await respond(state.tcpSocket, 5, "$5\r\nthree\r\n");
    await expect(third).resolves.toBe("three");

    expect(vi.mocked((await import("node:net")).default.connect)).toHaveBeenCalledTimes(1);
    expect(state.tcpSocket?.writes.filter((write) => write.includes("AUTH"))).toHaveLength(1);
    expect(state.tcpSocket?.writes.filter((write) => write.includes("SELECT"))).toHaveLength(1);
  });

  it("uses TLS for rediss and supports password-only auth", async () => {
    process.env.REDIS_URL = "rediss://:secret@redis.example.test:6380/4";
    const promise = redisCommand(["INCR", "key"]);
    await vi.waitFor(() => expect(state.tlsSocket).toBeTruthy());
    await respond(state.tlsSocket, 1, "+OK\r\n");
    await respond(state.tlsSocket, 2, "+OK\r\n");
    await respond(state.tlsSocket, 3, ":2\r\n");

    await expect(promise).resolves.toBe(2);
    expect(state.tlsSocket?.writes[0]).toBe("*2\r\n$4\r\nAUTH\r\n$6\r\nsecret\r\n");
    expect(state.tlsSocket?.writes[1]).toBe("*2\r\n$6\r\nSELECT\r\n$1\r\n4\r\n");
    expect(vi.mocked((await import("node:net")).default.connect)).not.toHaveBeenCalled();
    expect(vi.mocked((await import("node:tls")).default.connect)).toHaveBeenCalledTimes(1);
  });

  it("reconnects after an idle connection closes", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const first = redisCommand(["PING"]);
    await vi.waitFor(() => expect(state.tcpSocket).toBeTruthy());
    await respond(state.tcpSocket, 1, "+PONG\r\n");
    await expect(first).resolves.toBe("PONG");
    const closedSocket = state.tcpSocket;
    closedSocket?.destroy();
    state.tcpSocket = null;

    const second = redisCommand(["PING"]);
    await vi.waitFor(() => expect(state.tcpSocket).toBeTruthy());
    expect(state.tcpSocket).not.toBe(closedSocket);
    await respond(state.tcpSocket, 1, "+PONG\r\n");
    await expect(second).resolves.toBe("PONG");
    expect(vi.mocked((await import("node:net")).default.connect)).toHaveBeenCalledTimes(2);
  });

  it("rejects work beyond the bounded command queue", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const active = redisCommand(["PING"]).catch((error) => error);
    await vi.waitFor(() => expect(state.tcpSocket?.writes).toHaveLength(1));
    const queued = Array.from({ length: 128 }, (_, index) => (
      redisCommand(["GET", `key-${index}`]).catch((error) => error)
    ));

    await expect(redisCommand(["GET", "overflow"])).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      debug: { message: "Redis command queue exceeded 128 entries" },
    });

    await resetRedisTransportForTests();
    await Promise.all([active, ...queued]);
  });

  it("rejects Redis error and unsupported responses", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    let promise = redisCommand(["PING"]);
    await vi.waitFor(() => expect(state.tcpSocket).toBeTruthy());
    await respond(state.tcpSocket, 1, "-ERR nope\r\n");
    await expect(promise).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      status: 503,
      debug: { message: "ERR nope" },
    });

    promise = redisCommand(["PING"]);
    await respond(state.tcpSocket, 2, "?wat\r\n");
    await expect(promise).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      status: 503,
      debug: { message: "Unsupported Redis response" },
    });
  });

  it("bounds connection wait, destroys the socket and returns 503", async () => {
    vi.useFakeTimers();
    vi.mocked((await import("node:net")).default.connect).mockImplementationOnce(() => {
      state.tcpSocket = new FakeSocket();
      return state.tcpSocket as never;
    });

    const promise = redisCommand(["PING"]);
    const rejection = expect(promise).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      status: 503,
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await rejection;
    expect(state.tcpSocket?.destroyed).toBe(true);
    expect(state.tcpSocket?.listenerCount("connect")).toBe(0);
    vi.useRealTimers();
  });

  it("rejects oversized RESP before unbounded buffering", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const promise = redisCommand(["PING"]);
    await vi.waitFor(() => expect(state.tcpSocket).toBeTruthy());
    await respond(state.tcpSocket, 1, Buffer.alloc(1024 * 1024 + 1, 65));

    await expect(promise).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      status: 503,
    });
    expect(state.tcpSocket?.destroyed).toBe(true);
  });

  it("waits for fragmented array and bulk RESP frames", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const promise = redisCommand(["MGET", "a", "b"]);
    await vi.waitFor(() => expect(state.tcpSocket?.writes).toHaveLength(1));

    state.tcpSocket?.emit("data", Buffer.from("*"));
    state.tcpSocket?.emit("data", Buffer.from("2\r\n$5"));
    state.tcpSocket?.emit("data", Buffer.from("\r\nhe"));
    state.tcpSocket?.emit("data", Buffer.from("llo\r\n+OK"));
    state.tcpSocket?.emit("data", Buffer.from("\r\n"));

    await expect(promise).resolves.toEqual(["hello", "OK"]);
  });

  it("handles connection errors and closes before readiness", async () => {
    vi.mocked((await import("node:net")).default.connect)
      .mockImplementationOnce(() => {
        state.tcpSocket = new FakeSocket();
        queueMicrotask(() => state.tcpSocket?.emit("error", new Error("connect failed")));
        return state.tcpSocket as never;
      });
    await expect(redisCommand(["PING"])).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      debug: { message: "connect failed" },
    });

    vi.mocked((await import("node:net")).default.connect)
      .mockImplementationOnce(() => {
        state.tcpSocket = new FakeSocket();
        queueMicrotask(() => state.tcpSocket?.emit("close"));
        return state.tcpSocket as never;
      });
    await expect(redisCommand(["PING"])).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      debug: { message: "Redis connection closed before it was ready" },
    });
  });

  it("rejects socket errors and closes while reading a command", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    let promise = redisCommand(["PING"]);
    await vi.waitFor(() => expect(state.tcpSocket?.writes).toHaveLength(1));
    state.tcpSocket?.emit("error", new Error("read failed"));
    await expect(promise).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      debug: { message: "read failed" },
    });

    state.tcpSocket = null;
    promise = redisCommand(["PING"]);
    await vi.waitFor(() => expect(state.tcpSocket?.writes).toHaveLength(1));
    (state.tcpSocket as FakeSocket | null)?.emit("close");
    await expect(promise).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      debug: { message: "Redis connection closed" },
    });
  });

  it("handles a synchronous socket write failure without leaking the response promise", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    vi.mocked((await import("node:net")).default.connect)
      .mockImplementationOnce(() => {
        state.tcpSocket = new FakeSocket();
        vi.spyOn(state.tcpSocket, "write").mockImplementationOnce(() => {
          throw new Error("write failed");
        });
        queueMicrotask(() => state.tcpSocket?.emit("connect"));
        return state.tcpSocket as never;
      });

    await expect(redisCommand(["PING"])).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      debug: { message: "write failed" },
    });
    expect(state.tcpSocket?.destroyed).toBe(true);
  });

  it("fails immediately when the shared deadline is exhausted", async () => {
    const now = vi.spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValue(4_000);

    await expect(redisCommand(["PING"])).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      debug: { message: "Redis command deadline exceeded in queue" },
    });
    now.mockRestore();
  });

  it("times out a command response and removes its listeners", async () => {
    vi.useFakeTimers();
    process.env.REDIS_URL = "redis://localhost:6379";
    const promise = redisCommand(["PING"]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(state.tcpSocket?.writes).toHaveLength(1));
    const rejection = expect(promise).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      debug: { message: expect.stringContaining("Redis command timed out") },
    });
    await vi.advanceTimersByTimeAsync(3_000);
    await rejection;
    expect(state.tcpSocket?.listenerCount("data")).toBe(0);

    const poisonedSocket = state.tcpSocket;
    state.tcpSocket = null;
    const recovered = redisCommand(["PING"]);
    await vi.advanceTimersByTimeAsync(100);
    expect(state.tcpSocket).toBeTruthy();
    expect(state.tcpSocket).not.toBe(poisonedSocket);
    (state.tcpSocket as FakeSocket | null)?.emit(
      "data",
      Buffer.from("+PONG\r\n"),
    );
    await expect(recovered).resolves.toBe("PONG");
    vi.useRealTimers();
  });
});

import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { redisCommand } from "@/backend/cache/redis";

describe("Redis adapter network deadline", () => {
  const sockets = new Set<net.Socket>();
  let server: net.Server | null = null;
  const originalRedisUrl = process.env.REDIS_URL;

  afterEach(async () => {
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = null;
    }
    if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalRedisUrl;
  });

  it("closes a connection when the peer accepts commands but never responds", async () => {
    server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("data", () => undefined);
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("TCP stub did not expose a port");
    }

    process.env.REDIS_URL = `redis://127.0.0.1:${address.port}`;
    const startedAt = Date.now();

    await expect(redisCommand(["PING"])).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      status: 503,
    });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(2_500);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  }, 10_000);
});

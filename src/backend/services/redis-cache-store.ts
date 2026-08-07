import { redisCommand } from "@/backend/cache/redis";
import type { CacheStore, CacheValue } from "@/backend/ports/cache-store";

export const redisCacheStore: CacheStore = {
  async get(key: string): Promise<string | null> {
    const result = await redisCommand(["GET", key]);
    return typeof result === "string" ? result : null;
  },

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await redisCommand(["SET", key, value, "EX", String(ttlSeconds)]);
    } else {
      await redisCommand(["SET", key, value]);
    }
  },

  async incr(key: string): Promise<number> {
    const result = await redisCommand(["INCR", key]);
    return typeof result === "number" ? result : Number(result);
  },

  async expire(key: string, seconds: number): Promise<void> {
    await redisCommand(["EXPIRE", key, String(seconds)]);
  },

  async ttl(key: string): Promise<number> {
    const result = await redisCommand(["TTL", key]);
    return typeof result === "number" ? result : Number(result);
  },

  async del(key: string): Promise<void> {
    await redisCommand(["DEL", key]);
  },

  async zadd(key: string, score: number, member: string): Promise<void> {
    await redisCommand(["ZADD", key, String(score), member]);
  },

  async zrem(key: string, member: string): Promise<void> {
    await redisCommand(["ZREM", key, member]);
  },

  async zcard(key: string): Promise<number> {
    const result = await redisCommand(["ZCARD", key]);
    return typeof result === "number" ? result : Number(result);
  },

  async zremrangebyscore(key: string, min: string, max: string): Promise<void> {
    await redisCommand(["ZREMRANGEBYSCORE", key, min, max]);
  },

  async eval(script: string, keys: string[], args: CacheValue[]): Promise<unknown> {
    return redisCommand(["EVAL", script, String(keys.length), ...keys, ...args.map(String)]);
  },

  async ping(): Promise<boolean> {
    const result = await redisCommand(["PING"]);
    return result === "PONG";
  },
};

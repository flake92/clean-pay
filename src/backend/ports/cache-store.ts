export type CacheValue = string | number;

export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
  ttl(key: string): Promise<number>;
  del(key: string): Promise<void>;
  zadd(key: string, score: number, member: string): Promise<void>;
  zrem(key: string, member: string): Promise<void>;
  zcard(key: string): Promise<number>;
  zremrangebyscore(key: string, min: string, max: string): Promise<void>;
  eval(script: string, keys: string[], args: CacheValue[]): Promise<unknown>;
  ping(): Promise<boolean>;
}

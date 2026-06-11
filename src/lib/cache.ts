import { createClient } from "redis";

type MemoryEntry = {
  expiresAt: number;
  value: string;
};

const CACHE_PREFIX = process.env.CACHE_PREFIX || "team-ai-gateway";
const CACHE_ENABLED = process.env.CACHE_ENABLED !== "false";
const REDIS_URL = process.env.REDIS_URL?.trim() || "redis://127.0.0.1:6379";
const REDIS_FAILURE_BACKOFF_MS = 60_000;
const memoryCache = new Map<string, MemoryEntry>();
type CacheRedisClient = {
  connect: () => Promise<unknown>;
  del: (keys: string[]) => Promise<unknown>;
  get: (key: string) => Promise<string | null>;
  on: (event: "error", listener: (error: unknown) => void) => void;
  set: (key: string, value: string, options: { EX: number }) => Promise<unknown>;
};

let redisClientPromise: Promise<CacheRedisClient | null> | null = null;
let redisDisabledUntil = 0;

function namespacedKey(key: string) {
  return `${CACHE_PREFIX}:${key}`;
}

function readMemory(key: string) {
  const entry = memoryCache.get(key);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    memoryCache.delete(key);
    return null;
  }

  return entry.value;
}

function writeMemory(key: string, value: string, ttlSeconds: number) {
  memoryCache.set(key, {
    expiresAt: Date.now() + ttlSeconds * 1000,
    value
  });
}

async function getRedisClient() {
  if (!CACHE_ENABLED || !REDIS_URL) {
    return null;
  }

  if (redisDisabledUntil > Date.now()) {
    return null;
  }

  if (!redisClientPromise) {
    redisClientPromise = (async () => {
      const client = createClient({
        RESP: 2,
        socket: {
          connectTimeout: 1_000,
          reconnectStrategy: false
        },
        url: REDIS_URL
      });

      client.on("error", (error) => {
        console.warn(
          "[cache] Redis error:",
          error instanceof Error ? error.message : String(error)
        );
      });

      try {
        await client.connect();
        return client as unknown as CacheRedisClient;
      } catch (error) {
        console.warn(
          "[cache] Redis disabled after connection failure:",
          error instanceof Error ? error.message : String(error)
        );
        redisDisabledUntil = Date.now() + REDIS_FAILURE_BACKOFF_MS;
        redisClientPromise = null;
        return null;
      }
    })();
  }

  return redisClientPromise;
}

export async function cacheGetJson<T>(key: string): Promise<T | null> {
  if (!CACHE_ENABLED) {
    return null;
  }

  const namespaced = namespacedKey(key);
  const memoryValue = readMemory(namespaced);

  if (memoryValue) {
    return JSON.parse(memoryValue) as T;
  }

  const redis = await getRedisClient();
  const redisValue = await redis?.get(namespaced).catch(() => null);

  if (!redisValue) {
    return null;
  }

  return JSON.parse(redisValue) as T;
}

export async function cacheSetJson(key: string, value: unknown, ttlSeconds: number) {
  if (!CACHE_ENABLED || ttlSeconds <= 0) {
    return;
  }

  const namespaced = namespacedKey(key);
  const serialized = JSON.stringify(value);

  writeMemory(namespaced, serialized, ttlSeconds);

  const redis = await getRedisClient();
  await redis?.set(namespaced, serialized, { EX: ttlSeconds }).catch(() => undefined);
}

export async function cacheDelete(keys: string[]) {
  if (!CACHE_ENABLED || keys.length === 0) {
    return;
  }

  const namespacedKeys = keys.map(namespacedKey);

  for (const key of namespacedKeys) {
    memoryCache.delete(key);
  }

  const redis = await getRedisClient();

  if (redis) {
    await redis.del(namespacedKeys).catch(() => undefined);
  }
}

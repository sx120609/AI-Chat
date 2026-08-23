import { createClient } from "redis";

type MemoryEntry = {
  expiresAt: number;
  value: string;
};

const CACHE_PREFIX = process.env.CACHE_PREFIX || "team-ai-gateway";
const CACHE_ENABLED = process.env.CACHE_ENABLED !== "false";
const REDIS_URL = process.env.REDIS_URL?.trim() || "redis://127.0.0.1:6379";
const REDIS_FAILURE_BACKOFF_MS = readPositiveNumber(
  process.env.REDIS_FAILURE_BACKOFF_MS,
  60_000
);
const MEMORY_CACHE_MAX_ENTRIES = readNonNegativeNumber(
  process.env.CACHE_MEMORY_MAX_ENTRIES,
  1_000
);
const MEMORY_CACHE_MAX_TTL_SECONDS = readPositiveNumber(
  process.env.CACHE_MEMORY_MAX_TTL_SECONDS,
  60
);
const MEMORY_CACHE_READ_TTL_SECONDS = readNonNegativeNumber(
  process.env.CACHE_MEMORY_READ_TTL_SECONDS,
  5
);
const MEMORY_CACHE_PRUNE_INTERVAL_MS = 30_000;
const REDIS_WARNING_LOG_INTERVAL_MS = 30_000;
const memoryCache = new Map<string, MemoryEntry>();
const memorySemaphoreLeases = new Map<string, Map<string, number>>();
type CacheRedisClient = {
  connect: () => Promise<unknown>;
  del: (keys: string[]) => Promise<unknown>;
  destroy?: () => void;
  eval?: (
    script: string,
    options: { arguments: string[]; keys: string[] }
  ) => Promise<number | string>;
  get: (key: string) => Promise<string | null>;
  on: (event: "error", listener: (error: unknown) => void) => void;
  set: (key: string, value: string, options: { EX: number }) => Promise<unknown>;
  ttl?: (key: string) => Promise<number>;
};

let redisClientPromise: Promise<CacheRedisClient | null> | null = null;
let redisDisabledUntil = 0;
let lastMemoryPruneAt = 0;
let lastRedisWarningAt = 0;

function readPositiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function readNonNegativeNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

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

  memoryCache.delete(key);
  memoryCache.set(key, entry);
  return entry.value;
}

function writeMemory(key: string, value: string, ttlSeconds: number) {
  if (MEMORY_CACHE_MAX_ENTRIES <= 0 || ttlSeconds <= 0) {
    return;
  }

  const boundedTtlSeconds = Math.min(ttlSeconds, MEMORY_CACHE_MAX_TTL_SECONDS);

  memoryCache.set(key, {
    expiresAt: Date.now() + boundedTtlSeconds * 1000,
    value
  });
  pruneMemoryCache();
}

function pruneMemoryCache(force = false) {
  if (MEMORY_CACHE_MAX_ENTRIES <= 0) {
    memoryCache.clear();
    return;
  }

  const now = Date.now();

  if (
    !force &&
    memoryCache.size <= MEMORY_CACHE_MAX_ENTRIES &&
    now - lastMemoryPruneAt < MEMORY_CACHE_PRUNE_INTERVAL_MS
  ) {
    return;
  }

  lastMemoryPruneAt = now;

  for (const [key, entry] of memoryCache) {
    if (entry.expiresAt <= now) {
      memoryCache.delete(key);
    }
  }

  while (memoryCache.size > MEMORY_CACHE_MAX_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value as string | undefined;

    if (!oldestKey) {
      break;
    }

    memoryCache.delete(oldestKey);
  }
}

function parseCachedJson<T>(value: string, key: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    console.warn(
      `[cache] Ignoring invalid JSON for ${key}:`,
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
}

function warnRedis(action: string, error: unknown) {
  const now = Date.now();

  if (now - lastRedisWarningAt < REDIS_WARNING_LOG_INTERVAL_MS) {
    return;
  }

  lastRedisWarningAt = now;
  console.warn(
    `[cache] Redis ${action} failed; using memory cache only for ${Math.round(
      REDIS_FAILURE_BACKOFF_MS / 1000
    )}s:`,
    error instanceof Error ? error.message : String(error)
  );
}

function backOffRedis(action: string, error: unknown) {
  redisDisabledUntil = Date.now() + REDIS_FAILURE_BACKOFF_MS;
  redisClientPromise = null;
  warnRedis(action, error);
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
        redisDisabledUntil = Date.now() + REDIS_FAILURE_BACKOFF_MS;
      });

      try {
        await client.connect();
        return client as unknown as CacheRedisClient;
      } catch (error) {
        backOffRedis("connect", error);
        return null;
      }
    })();
  }

  return redisClientPromise;
}

async function withRedis<T>(
  action: string,
  command: (redis: CacheRedisClient) => Promise<T>
): Promise<T | null> {
  const redis = await getRedisClient();

  if (!redis) {
    return null;
  }

  try {
    return await command(redis);
  } catch (error) {
    backOffRedis(action, error);

    try {
      redis.destroy?.();
    } catch {
      // Best-effort cleanup only; cache callers should keep degrading gracefully.
    }

    return null;
  }
}

async function getRedisTtlSeconds(key: string) {
  if (MEMORY_CACHE_READ_TTL_SECONDS <= 0) {
    return 0;
  }

  const ttl = await withRedis("ttl", async (redis) => {
    if (!redis.ttl) {
      return MEMORY_CACHE_READ_TTL_SECONDS;
    }

    return redis.ttl(key);
  });

  if (!ttl || ttl <= 0) {
    return MEMORY_CACHE_READ_TTL_SECONDS;
  }

  return Math.min(ttl, MEMORY_CACHE_READ_TTL_SECONDS);
}

export async function cacheGetJson<T>(key: string): Promise<T | null> {
  if (!CACHE_ENABLED) {
    return null;
  }

  const namespaced = namespacedKey(key);
  const memoryValue = readMemory(namespaced);

  if (memoryValue) {
    const parsed = parseCachedJson<T>(memoryValue, namespaced);

    if (parsed !== null) {
      return parsed;
    }

    memoryCache.delete(namespaced);
  }

  const redisValue = await withRedis("get", (redis) => redis.get(namespaced));

  if (!redisValue) {
    return null;
  }

  const parsed = parseCachedJson<T>(redisValue, namespaced);

  if (parsed === null) {
    await withRedis("delete invalid JSON", (redis) => redis.del([namespaced]));
    return null;
  }

  writeMemory(namespaced, redisValue, await getRedisTtlSeconds(namespaced));
  return parsed;
}

export async function cacheSetJson(key: string, value: unknown, ttlSeconds: number) {
  if (!CACHE_ENABLED || ttlSeconds <= 0) {
    return;
  }

  const namespaced = namespacedKey(key);
  const serialized = JSON.stringify(value);

  writeMemory(namespaced, serialized, ttlSeconds);
  await withRedis("set", (redis) => redis.set(namespaced, serialized, { EX: ttlSeconds }));
}

export async function cacheDelete(keys: string[]) {
  if (!CACHE_ENABLED || keys.length === 0) {
    return;
  }

  const namespacedKeys = [...new Set(keys.map(namespacedKey))];

  for (const key of namespacedKeys) {
    memoryCache.delete(key);
  }

  await withRedis("delete", (redis) => redis.del(namespacedKeys));
  pruneMemoryCache(true);
}

export type CacheSemaphoreLease = {
  distributed: boolean;
  id: string;
  key: string;
  ttlSeconds: number;
};

function pruneMemorySemaphore(key: string, now = Date.now()) {
  const leases = memorySemaphoreLeases.get(key);

  if (!leases) {
    return null;
  }

  for (const [id, expiresAt] of leases) {
    if (expiresAt <= now) {
      leases.delete(id);
    }
  }

  if (leases.size === 0) {
    memorySemaphoreLeases.delete(key);
    return null;
  }

  return leases;
}

export async function acquireCacheSemaphore(
  key: string,
  limit: number,
  ttlSeconds = 900
): Promise<CacheSemaphoreLease | null> {
  const normalizedLimit = Math.max(1, Math.floor(limit));
  const normalizedTtl = Math.max(30, Math.floor(ttlSeconds));
  const namespaced = namespacedKey(`semaphore:${key}`);
  const id = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + normalizedTtl * 1000;
  const redisResult = await withRedis("acquire semaphore", async (redis) => {
    if (!redis.eval) {
      return null;
    }

    return redis.eval(
      `redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
local count = redis.call('ZCARD', KEYS[1])
if count >= tonumber(ARGV[2]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
redis.call('EXPIRE', KEYS[1], ARGV[5])
return 1`,
      {
        keys: [namespaced],
        arguments: [
          String(now),
          String(normalizedLimit),
          String(expiresAt),
          id,
          String(normalizedTtl)
        ]
      }
    );
  });

  if (redisResult !== null) {
    if (Number(redisResult) !== 1) {
      return null;
    }

    const leases = pruneMemorySemaphore(namespaced, now) ?? new Map<string, number>();
    leases.set(id, expiresAt);
    memorySemaphoreLeases.set(namespaced, leases);
    return { distributed: true, id, key: namespaced, ttlSeconds: normalizedTtl };
  }

  const leases = pruneMemorySemaphore(namespaced, now) ?? new Map<string, number>();

  if (leases.size >= normalizedLimit) {
    return null;
  }

  leases.set(id, expiresAt);
  memorySemaphoreLeases.set(namespaced, leases);
  return { distributed: false, id, key: namespaced, ttlSeconds: normalizedTtl };
}

export async function renewCacheSemaphore(lease: CacheSemaphoreLease) {
  const expiresAt = Date.now() + lease.ttlSeconds * 1000;

  if (lease.distributed) {
    const renewed = await withRedis("renew semaphore", async (redis) => {
      if (!redis.eval) {
        return 0;
      }

      return redis.eval(
        `if redis.call('ZSCORE', KEYS[1], ARGV[1]) then
  redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
  redis.call('EXPIRE', KEYS[1], ARGV[3])
  return 1
end
return 0`,
        {
          keys: [lease.key],
          arguments: [lease.id, String(expiresAt), String(lease.ttlSeconds)]
        }
      );
    });

    if (Number(renewed) !== 1) {
      return false;
    }

    const leases = pruneMemorySemaphore(lease.key) ?? new Map<string, number>();
    leases.set(lease.id, expiresAt);
    memorySemaphoreLeases.set(lease.key, leases);
    return true;
  }

  const leases = pruneMemorySemaphore(lease.key);

  if (!leases?.has(lease.id)) {
    return false;
  }

  leases.set(lease.id, expiresAt);
  return true;
}

export async function releaseCacheSemaphore(lease: CacheSemaphoreLease) {
  if (lease.distributed) {
    await withRedis("release semaphore", async (redis) => {
      if (!redis.eval) {
        return 0;
      }

      return redis.eval("return redis.call('ZREM', KEYS[1], ARGV[1])", {
        keys: [lease.key],
        arguments: [lease.id]
      });
    });
    const leases = memorySemaphoreLeases.get(lease.key);
    leases?.delete(lease.id);

    if (leases?.size === 0) {
      memorySemaphoreLeases.delete(lease.key);
    }
    return;
  }

  const leases = memorySemaphoreLeases.get(lease.key);
  leases?.delete(lease.id);

  if (leases?.size === 0) {
    memorySemaphoreLeases.delete(lease.key);
  }
}

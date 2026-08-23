import {
  acquireCacheSemaphore,
  releaseCacheSemaphore,
  renewCacheSemaphore,
  type CacheSemaphoreLease
} from "@/lib/cache";

export const MAX_USER_API_CONCURRENCY_LIMIT = 1_000;
export const USER_API_CONCURRENCY_LEASE_TTL_SECONDS = 900;

export function normalizeUserApiConcurrencyLimit(value: unknown) {
  const parsed = typeof value === "string" ? Number(value) : value;

  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    return 0;
  }

  return Math.min(
    MAX_USER_API_CONCURRENCY_LIMIT,
    Math.max(0, Math.round(parsed))
  );
}

export function acquireUserApiConcurrency(userId: string, limit: number) {
  return acquireCacheSemaphore(
    `user-api:${userId}`,
    normalizeUserApiConcurrencyLimit(limit),
    USER_API_CONCURRENCY_LEASE_TTL_SECONDS
  );
}

export function renewUserApiConcurrency(lease: CacheSemaphoreLease) {
  return renewCacheSemaphore(lease);
}

export function releaseUserApiConcurrency(lease: CacheSemaphoreLease) {
  return releaseCacheSemaphore(lease);
}

export type UserApiConcurrencyLease = CacheSemaphoreLease;

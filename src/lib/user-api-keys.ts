import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { canUsePersonalApi } from "@/lib/user-groups";

export const USER_API_KEY_PREFIX = "sk-user-";

function hashApiKey(key: string) {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function generateUserApiKey() {
  return `${USER_API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
}

export function serializeUserApiKey(key: {
  id: string;
  name: string;
  keyPrefix: string;
  active: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: key.id,
    name: key.name,
    keyPrefix: key.keyPrefix,
    active: key.active,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString()
  };
}

export async function createUserApiKey(userId: string, name: string) {
  const rawKey = generateUserApiKey();
  const key = await prisma.userApiKey.create({
    data: {
      userId,
      name: name.trim() || "个人 API Key",
      keyHash: hashApiKey(rawKey),
      keyPrefix: rawKey.slice(0, 18)
    }
  });

  return {
    apiKey: rawKey,
    key: serializeUserApiKey(key)
  };
}

export async function authenticateUserApiKey(authorization: string | null) {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  const rawKey = match?.[1]?.trim();

  if (!rawKey?.startsWith(USER_API_KEY_PREFIX)) {
    return null;
  }

  const keyHash = hashApiKey(rawKey);
  const candidates = await prisma.userApiKey.findMany({
    where: {
      keyPrefix: rawKey.slice(0, 18),
      active: true
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          userGroup: true,
          active: true,
          emailVerified: true,
          monthlyCostLimitCents: true,
          quotaResetAt: true
        }
      }
    }
  });
  const matched = candidates.find((candidate) => safeEqual(candidate.keyHash, keyHash));

  if (!matched || !canUsePersonalApi(matched.user)) {
    return null;
  }

  await prisma.userApiKey
    .update({
      where: { id: matched.id },
      data: { lastUsedAt: new Date() }
    })
    .catch(() => undefined);

  return {
    apiKey: matched,
    user: matched.user
  };
}

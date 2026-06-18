import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { canUsePersonalApi } from "@/lib/user-groups";

export const USER_API_KEY_PREFIX = "sk-user-";
const KEY_ENCRYPTION_VERSION = "v1";

function getEncryptionSecret() {
  const secret = process.env.AUTH_SECRET;

  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must be set to reveal personal API keys.");
  }

  return secret || "development-only-auth-secret";
}

function encryptionKey() {
  return createHash("sha256").update(getEncryptionSecret(), "utf8").digest();
}

function hashApiKey(key: string) {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

function encryptApiKey(key: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    KEY_ENCRYPTION_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(":");
}

export function decryptApiKey(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const [version, iv, tag, encrypted] = value.split(":");

  if (version !== KEY_ENCRYPTION_VERSION || !iv || !tag || !encrypted) {
    return null;
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(iv, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    return null;
  }
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
  keyEncrypted?: string | null;
  active: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
}) {
  const apiKey = decryptApiKey(key.keyEncrypted);

  return {
    id: key.id,
    name: key.name,
    keyPrefix: key.keyPrefix,
    apiKey,
    canReveal: Boolean(apiKey),
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
      keyEncrypted: encryptApiKey(rawKey),
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
          aiStylePrompt: true,
          aiPointsBalanceCents: true,
          monthlyCostLimitCents: true,
          quotaNextResetAt: true,
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
      data: {
        lastUsedAt: new Date(),
        ...(matched.keyEncrypted ? {} : { keyEncrypted: encryptApiKey(rawKey) })
      }
    })
    .catch(() => undefined);

  return {
    apiKey: matched,
    user: matched.user
  };
}

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from "crypto";
import { Prisma } from "../../generated/prisma/client";
import {
  AI_POINTS_PRODUCT_TYPE,
  CODING_PLAN_PRODUCT_TYPE,
  codingPlanSnapshot,
  normalizeCodingPlanConfig,
  type CodingPlanOrderSnapshot
} from "@/lib/coding-plan";
import { cacheDelete } from "@/lib/cache";
import { grantEntitlement } from "@/lib/entitlements";
import { prisma } from "@/lib/prisma";
import { usageCacheKey } from "@/lib/quota";

export type RedemptionRewardType =
  | typeof AI_POINTS_PRODUCT_TYPE
  | typeof CODING_PLAN_PRODUCT_TYPE;

export type RedemptionReward =
  | {
      aiPointsBalanceCents: number;
      rewardType: typeof AI_POINTS_PRODUCT_TYPE;
    }
  | {
      codingPlan: CodingPlanOrderSnapshot;
      rewardType: typeof CODING_PLAN_PRODUCT_TYPE;
    };

const CODE_ENCRYPTION_VERSION = "v1";
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function encryptionSecret() {
  const secret = process.env.AUTH_SECRET;

  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must be set to manage redemption codes.");
  }

  return secret || "development-only-auth-secret";
}

function encryptionKey() {
  return createHash("sha256").update(encryptionSecret(), "utf8").digest();
}

export function normalizeRedemptionCode(value: unknown) {
  const normalized = typeof value === "string"
    ? value.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "")
    : "";

  if (normalized.length < 8 || normalized.length > 64) {
    throw new RedemptionCodeError("请输入有效的兑换码。", 400, "INVALID_CODE");
  }

  return normalized;
}

export function hashRedemptionCode(value: unknown) {
  return createHash("sha256").update(normalizeRedemptionCode(value), "utf8").digest("hex");
}

export function generateRedemptionCode(prefix: unknown = "LOWIQ") {
  const normalizedPrefix = (typeof prefix === "string" ? prefix : "LOWIQ")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12) || "LOWIQ";
  const bytes = randomBytes(12);
  let randomPart = "";

  for (const byte of bytes) {
    randomPart += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }

  return `${normalizedPrefix}-${randomPart.slice(0, 4)}-${randomPart.slice(4, 8)}-${randomPart.slice(8, 12)}`;
}

export function encryptRedemptionCode(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    CODE_ENCRYPTION_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(":");
}

export function decryptRedemptionCode(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const [version, iv, tag, encrypted] = value.split(":");

  if (version !== CODE_ENCRYPTION_VERSION || !iv || !tag || !encrypted) {
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

export function redemptionCodePreview(code: string) {
  const parts = code.split("-");
  const last = parts.at(-1) || code.slice(-4);
  return `${parts[0] || "CODE"}-••••-${last}`;
}

export function serializeRedemptionReward(input: {
  aiPointsBalanceCents: number;
  codingPlanSnapshotJson: string;
  rewardType: string;
}): RedemptionReward | null {
  if (input.rewardType === AI_POINTS_PRODUCT_TYPE) {
    return {
      aiPointsBalanceCents: Math.max(0, Math.round(input.aiPointsBalanceCents)),
      rewardType: AI_POINTS_PRODUCT_TYPE
    };
  }

  if (input.rewardType !== CODING_PLAN_PRODUCT_TYPE) {
    return null;
  }

  try {
    const raw = JSON.parse(input.codingPlanSnapshotJson || "{}") as Record<string, unknown>;
    const normalized = normalizeCodingPlanConfig({
      dailyCostLimitCents: raw.dailyCostLimitCents as number | undefined,
      description: raw.description as string | undefined,
      durationMonths: raw.durationMonths as number | undefined,
      enabled: true,
      id: raw.id as string | undefined,
      monthlyCostLimitCents: raw.monthlyCostLimitCents as number | undefined,
      name: raw.name as string | undefined,
      personalApiEnabled: raw.personalApiEnabled as boolean | undefined,
      priceCents: 100,
      weeklyCostLimitCents: raw.weeklyCostLimitCents as number | undefined
    }, "redeemed-coding-plan");

    return {
      codingPlan: codingPlanSnapshot(normalized),
      rewardType: CODING_PLAN_PRODUCT_TYPE
    };
  } catch {
    return null;
  }
}

export function serializeRedemptionCode(code: {
  id: string;
  codeEncrypted: string | null;
  codePreview: string;
  label: string;
  rewardType: string;
  aiPointsBalanceCents: number;
  codingPlanSnapshotJson: string;
  maxRedemptions: number;
  redeemedCount: number;
  active: boolean;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const reward = serializeRedemptionReward(code);

  return {
    id: code.id,
    code: decryptRedemptionCode(code.codeEncrypted),
    codePreview: code.codePreview,
    label: code.label,
    reward,
    maxRedemptions: code.maxRedemptions,
    redeemedCount: code.redeemedCount,
    active: code.active,
    expiresAt: code.expiresAt?.toISOString() ?? null,
    createdAt: code.createdAt.toISOString(),
    updatedAt: code.updatedAt.toISOString()
  };
}

export class RedemptionCodeError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = "REDEMPTION_FAILED"
  ) {
    super(message);
  }
}

export async function redeemCode(userId: string, rawCode: unknown) {
  const codeHash = hashRedemptionCode(rawCode);
  const now = new Date();

  let result: {
    codingPlanExpiresAt: Date | null;
    label: string;
    reward: RedemptionReward;
  };

  try {
    result = await prisma.$transaction(async (tx) => {
      const code = await tx.redemptionCode.findUnique({
        where: { codeHash }
      });

      if (!code) {
        throw new RedemptionCodeError("兑换码不存在。", 404, "CODE_NOT_FOUND");
      }

      if (!code.active) {
        throw new RedemptionCodeError("该兑换码已停用。", 410, "CODE_INACTIVE");
      }

      if (code.expiresAt && code.expiresAt <= now) {
        throw new RedemptionCodeError("该兑换码已过期。", 410, "CODE_EXPIRED");
      }

      const existing = await tx.redemption.findUnique({
        where: {
          codeId_userId: {
            codeId: code.id,
            userId
          }
        }
      });

      if (existing) {
        throw new RedemptionCodeError("你已经使用过这个兑换码。", 409, "ALREADY_REDEEMED");
      }

      const reward = serializeRedemptionReward(code);

      if (!reward) {
        throw new RedemptionCodeError("该兑换码的权益配置无效，请联系管理员。", 409, "INVALID_REWARD");
      }

      const reserved = await tx.redemptionCode.updateMany({
        where: {
          id: code.id,
          active: true,
          redeemedCount: { lt: code.maxRedemptions },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
        },
        data: {
          redeemedCount: { increment: 1 }
        }
      });

      if (reserved.count === 0) {
        throw new RedemptionCodeError("该兑换码的可用次数已用完。", 409, "CODE_EXHAUSTED");
      }

      await tx.redemption.create({
        data: {
          codeId: code.id,
          userId,
          rewardType: code.rewardType,
          aiPointsBalanceCents: code.aiPointsBalanceCents,
          codingPlanSnapshotJson: code.codingPlanSnapshotJson,
          redeemedAt: now
        }
      });

      const granted = await grantEntitlement(tx, userId, reward, now);

      return {
        codingPlanExpiresAt: granted.codingPlanExpiresAt,
        label: code.label,
        reward
      };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new RedemptionCodeError("你已经使用过这个兑换码。", 409, "ALREADY_REDEEMED");
    }

    throw error;
  }

  await cacheDelete([usageCacheKey(userId)]);

  return result;
}

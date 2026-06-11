import { cacheGetJson, cacheSetJson } from "@/lib/cache";
import { prisma } from "@/lib/prisma";

export type UsageSummary = {
  windowStart: string;
  tokensUsed: number;
  messagesUsed: number;
  costUsedCents: number;
  remainingCostCents: number;
  monthlyCostLimitCents: number;
};

export class QuotaError extends Error {
  status = 429;

  constructor(message: string, public summary: UsageSummary) {
    super(message);
  }
}

const USAGE_SUMMARY_CACHE_TTL_SECONDS = 8;

function usageSummaryCacheKey(userId: string) {
  return `usage-summary:${userId}`;
}

function monthStart(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function laterDate(a: Date, b: Date) {
  return a.getTime() > b.getTime() ? a : b;
}

export async function getUsageSummary(
  userId: string,
  options: { readCache?: boolean } = {}
): Promise<UsageSummary> {
  const cacheKey = usageSummaryCacheKey(userId);

  if (options.readCache !== false) {
    const cached = await cacheGetJson<UsageSummary>(cacheKey);

    if (cached) {
      return cached;
    }
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      quotaResetAt: true,
      monthlyCostLimitCents: true
    }
  });

  const windowStart = laterDate(monthStart(), user.quotaResetAt);
  const [usage, messagesUsed] = await Promise.all([
    prisma.usageRecord.aggregate({
      where: {
        userId,
        createdAt: {
          gte: windowStart
        }
      },
      _sum: {
        totalTokens: true,
        estimatedCostCents: true
      }
    }),
    prisma.usageRecord.count({
      where: {
        userId,
        createdAt: {
          gte: windowStart
        }
      }
    })
  ]);

  const tokensUsed = usage._sum.totalTokens ?? 0;
  const costUsedCents = usage._sum.estimatedCostCents ?? 0;

  const summary = {
    windowStart: windowStart.toISOString(),
    tokensUsed,
    messagesUsed,
    costUsedCents,
    remainingCostCents: Math.max(0, user.monthlyCostLimitCents - costUsedCents),
    monthlyCostLimitCents: user.monthlyCostLimitCents
  };

  await cacheSetJson(cacheKey, summary, USAGE_SUMMARY_CACHE_TTL_SECONDS);

  return summary;
}

export async function assertQuotaAvailable(userId: string, expectedCostCents: number) {
  const summary = await getUsageSummary(userId, { readCache: false });

  if (summary.costUsedCents + expectedCostCents > summary.monthlyCostLimitCents) {
    throw new QuotaError("本月费用额度不足。", summary);
  }

  return summary;
}

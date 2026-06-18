import { cacheDelete, cacheGetJson, cacheSetJson } from "@/lib/cache";
import { prisma } from "@/lib/prisma";

export type UsageSummary = {
  windowStart: string;
  windowEnd: string;
  tokensUsed: number;
  messagesUsed: number;
  costUsedCents: number;
  remainingCostCents: number;
  monthlyCostLimitCents: number;
  subscriptionCostUsedCents: number;
  subscriptionRemainingCostCents: number;
  aiPointsBalanceCents: number;
  aiPointsCostUsedCents: number;
};

export class QuotaError extends Error {
  status = 429;

  constructor(message: string, public summary: UsageSummary) {
    super(message);
  }
}

const USAGE_SUMMARY_CACHE_TTL_SECONDS = 8;

type UsageRecordCreateArgs = Parameters<typeof prisma.usageRecord.create>[0];

function usageSummaryCacheKey(userId: string) {
  return `usage-summary:${userId}`;
}

export function usageCacheKey(userId: string) {
  return usageSummaryCacheKey(userId);
}

function addMonthsClamped(date: Date, months = 1) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const day = date.getUTCDate();
  const targetLastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(day, targetLastDay),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds()
    )
  );
}

function resolveCurrentPeriod(start: Date, end: Date, now = new Date()) {
  let periodStart = start;
  let periodEnd = end > start ? end : addMonthsClamped(start);

  while (periodEnd <= now) {
    periodStart = periodEnd;
    periodEnd = addMonthsClamped(periodEnd);
  }

  return {
    periodStart,
    periodEnd,
    changed: periodStart.getTime() !== start.getTime() || periodEnd.getTime() !== end.getTime()
  };
}

export function nextQuotaResetAt(start = new Date()) {
  return addMonthsClamped(start);
}

export async function startNextQuotaPeriod(userId: string, start = new Date()) {
  const periodStart = start;
  const periodEnd = nextQuotaResetAt(periodStart);

  await prisma.user.update({
    where: { id: userId },
    data: {
      quotaResetAt: periodStart,
      quotaNextResetAt: periodEnd,
      quotaSystemMigratedAt: periodStart
    }
  });
  await cacheDelete([usageCacheKey(userId)]);

  return {
    periodStart,
    periodEnd
  };
}

async function normalizeQuotaUser(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      aiPointsBalanceCents: true,
      monthlyCostLimitCents: true,
      quotaNextResetAt: true,
      quotaResetAt: true,
      quotaSystemMigratedAt: true
    }
  });

  if (!user.quotaSystemMigratedAt) {
    const legacyUsage = await prisma.usageRecord.aggregate({
      where: {
        userId,
        createdAt: {
          gte: user.quotaResetAt
        }
      },
      _sum: {
        estimatedCostCents: true
      }
    });
    const migratedAt = new Date();
    const legacyBalanceCents = Math.max(
      0,
      user.monthlyCostLimitCents - (legacyUsage._sum.estimatedCostCents ?? 0)
    );
    const migrated = await prisma.user.update({
      where: { id: userId },
      data: {
        aiPointsBalanceCents: user.aiPointsBalanceCents + legacyBalanceCents,
        monthlyCostLimitCents: 0,
        quotaResetAt: migratedAt,
        quotaNextResetAt: nextQuotaResetAt(migratedAt),
        quotaSystemMigratedAt: migratedAt
      },
      select: {
        aiPointsBalanceCents: true,
        monthlyCostLimitCents: true,
        quotaNextResetAt: true,
        quotaResetAt: true
      }
    });

    await cacheDelete([usageCacheKey(userId)]);

    return migrated;
  }

  const period = resolveCurrentPeriod(user.quotaResetAt, user.quotaNextResetAt);

  if (period.changed) {
    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        quotaResetAt: period.periodStart,
        quotaNextResetAt: period.periodEnd
      },
      select: {
        aiPointsBalanceCents: true,
        monthlyCostLimitCents: true,
        quotaNextResetAt: true,
        quotaResetAt: true
      }
    });

    await cacheDelete([usageCacheKey(userId)]);

    return updated;
  }

  return user;
}

export async function getUsageSummary(
  userId: string,
  options: { readCache?: boolean } = {}
): Promise<UsageSummary> {
  const cacheKey = usageSummaryCacheKey(userId);

  if (options.readCache !== false) {
    const cached = await cacheGetJson<UsageSummary>(cacheKey);

    if (cached && "aiPointsBalanceCents" in cached && "windowEnd" in cached) {
      return cached;
    }
  }

  const user = await normalizeQuotaUser(userId);
  const windowStart = user.quotaResetAt;
  const [usage, messagesUsed] = await Promise.all([
    prisma.usageRecord.aggregate({
      where: {
        userId,
        createdAt: {
          gte: windowStart
        }
      },
      _sum: {
        aiPointsCostCents: true,
        estimatedCostCents: true,
        subscriptionCostCents: true,
        totalTokens: true
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
  const subscriptionCostUsedCents = usage._sum.subscriptionCostCents ?? 0;
  const aiPointsCostUsedCents = usage._sum.aiPointsCostCents ?? 0;
  const subscriptionRemainingCostCents = Math.max(
    0,
    user.monthlyCostLimitCents - subscriptionCostUsedCents
  );
  const aiPointsBalanceCents = Math.max(0, user.aiPointsBalanceCents);

  const summary = {
    windowStart: windowStart.toISOString(),
    windowEnd: user.quotaNextResetAt.toISOString(),
    tokensUsed,
    messagesUsed,
    costUsedCents,
    remainingCostCents: subscriptionRemainingCostCents + aiPointsBalanceCents,
    monthlyCostLimitCents: user.monthlyCostLimitCents,
    subscriptionCostUsedCents,
    subscriptionRemainingCostCents,
    aiPointsBalanceCents,
    aiPointsCostUsedCents
  };

  await cacheSetJson(cacheKey, summary, USAGE_SUMMARY_CACHE_TTL_SECONDS);

  return summary;
}

function quotaSource(subscriptionCostCents: number, aiPointsCostCents: number) {
  if (subscriptionCostCents > 0 && aiPointsCostCents > 0) {
    return "MIXED";
  }

  if (aiPointsCostCents > 0) {
    return "AI_POINTS";
  }

  return "MONTHLY_SUBSCRIPTION";
}

export async function createUsageRecordWithQuotaDebit(args: UsageRecordCreateArgs) {
  const costCents = Math.max(0, Number(args.data.estimatedCostCents ?? 0));
  const userId = String(args.data.userId);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        aiPointsBalanceCents: true,
        monthlyCostLimitCents: true,
        quotaNextResetAt: true,
        quotaResetAt: true
      }
    });
    const period = resolveCurrentPeriod(user.quotaResetAt, user.quotaNextResetAt);
    const periodUser = period.changed
      ? await tx.user.update({
          where: { id: userId },
          data: {
            quotaResetAt: period.periodStart,
            quotaNextResetAt: period.periodEnd
          },
          select: {
            aiPointsBalanceCents: true,
            monthlyCostLimitCents: true,
            quotaNextResetAt: true,
            quotaResetAt: true
          }
        })
      : user;
    const subscriptionUsage = await tx.usageRecord.aggregate({
      where: {
        userId,
        createdAt: {
          gte: periodUser.quotaResetAt
        }
      },
      _sum: {
        subscriptionCostCents: true
      }
    });
    const subscriptionRemainingCostCents = Math.max(
      0,
      periodUser.monthlyCostLimitCents - (subscriptionUsage._sum.subscriptionCostCents ?? 0)
    );
    const subscriptionCostCents = Math.min(costCents, subscriptionRemainingCostCents);
    const aiPointsCostCents = Math.max(0, costCents - subscriptionCostCents);

    if (aiPointsCostCents > 0) {
      await tx.user.update({
        where: { id: userId },
        data: {
          aiPointsBalanceCents: Math.max(
            0,
            periodUser.aiPointsBalanceCents - aiPointsCostCents
          )
        }
      });
    }

    const record = await tx.usageRecord.create({
      ...args,
      data: {
        ...args.data,
        aiPointsCostCents,
        quotaSource: quotaSource(subscriptionCostCents, aiPointsCostCents),
        subscriptionCostCents
      }
    });

    return record;
  }).finally(async () => {
    await cacheDelete([usageCacheKey(userId)]);
  });
}

export async function assertQuotaAvailable(userId: string, expectedCostCents: number) {
  const summary = await getUsageSummary(userId, { readCache: false });

  if (expectedCostCents > summary.remainingCostCents) {
    throw new QuotaError("额度不足。", summary);
  }

  return summary;
}

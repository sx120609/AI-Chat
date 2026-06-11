import { prisma } from "@/lib/prisma";

export type UsageSummary = {
  windowStart: string;
  tokensUsed: number;
  messagesUsed: number;
  costUsedCents: number;
  remainingTokens: number;
  remainingMessages: number;
  remainingCostCents: number;
  monthlyTokenLimit: number;
  monthlyMessageLimit: number;
  monthlyCostLimitCents: number;
};

export class QuotaError extends Error {
  status = 429;

  constructor(message: string, public summary: UsageSummary) {
    super(message);
  }
}

function monthStart(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function laterDate(a: Date, b: Date) {
  return a.getTime() > b.getTime() ? a : b;
}

export async function getUsageSummary(userId: string): Promise<UsageSummary> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      quotaResetAt: true,
      monthlyTokenLimit: true,
      monthlyMessageLimit: true,
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

  return {
    windowStart: windowStart.toISOString(),
    tokensUsed,
    messagesUsed,
    costUsedCents,
    remainingTokens: Math.max(0, user.monthlyTokenLimit - tokensUsed),
    remainingMessages: Math.max(0, user.monthlyMessageLimit - messagesUsed),
    remainingCostCents: Math.max(0, user.monthlyCostLimitCents - costUsedCents),
    monthlyTokenLimit: user.monthlyTokenLimit,
    monthlyMessageLimit: user.monthlyMessageLimit,
    monthlyCostLimitCents: user.monthlyCostLimitCents
  };
}

export async function assertQuotaAvailable(
  userId: string,
  expectedTokens: number,
  expectedCostCents: number
) {
  const summary = await getUsageSummary(userId);

  if (summary.remainingMessages <= 0) {
    throw new QuotaError("本月消息次数额度已用完。", summary);
  }

  if (summary.tokensUsed + expectedTokens > summary.monthlyTokenLimit) {
    throw new QuotaError("本月 token 额度不足。", summary);
  }

  if (summary.costUsedCents + expectedCostCents > summary.monthlyCostLimitCents) {
    throw new QuotaError("本月费用额度不足。", summary);
  }

  return summary;
}

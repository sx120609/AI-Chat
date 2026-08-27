import "dotenv/config";
import pg from "pg";

const { Client } = pg;

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL must point to the PostgreSQL database.");
}

const statements = [
  'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "aiPointsBalanceCents" DOUBLE PRECISION NOT NULL DEFAULT 0',
  'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "quotaNextResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
  'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "quotaSystemMigratedAt" TIMESTAMP(3)',
  'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "codingPlanMonthlyCostLimitCents" INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "codingPlanDailyCostLimitCents" INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "codingPlanWeeklyCostLimitCents" INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "codingPlanId" TEXT NOT NULL DEFAULT \'\'',
  'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "codingPlanName" TEXT NOT NULL DEFAULT \'\'',
  'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "codingPlanExpiresAt" TIMESTAMP(3)',
  'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "codingPlanPersonalApiEnabled" BOOLEAN NOT NULL DEFAULT FALSE',
  'ALTER TABLE "User" ALTER COLUMN "monthlyCostLimitCents" SET DEFAULT 0',
  'ALTER TABLE "UsageRecord" ADD COLUMN IF NOT EXISTS "subscriptionCostCents" DOUBLE PRECISION NOT NULL DEFAULT 0',
  'ALTER TABLE "UsageRecord" ADD COLUMN IF NOT EXISTS "aiPointsCostCents" DOUBLE PRECISION NOT NULL DEFAULT 0',
  'ALTER TABLE "UsageRecord" ADD COLUMN IF NOT EXISTS "quotaSource" TEXT NOT NULL DEFAULT \'MONTHLY_SUBSCRIPTION\'',
  'ALTER TABLE "UserApiKey" ADD COLUMN IF NOT EXISTS "usageCostLimitCents" INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE "AiSettings" ADD COLUMN IF NOT EXISTS "gpt54ProApiBaseUrl" TEXT NOT NULL DEFAULT \'\'',
  'ALTER TABLE "AiSettings" ADD COLUMN IF NOT EXISTS "gpt54ProApiKey" TEXT',
  'ALTER TABLE "AiSettings" ADD COLUMN IF NOT EXISTS "gpt54ProOrgId" TEXT',
  'ALTER TABLE "AiSettings" ADD COLUMN IF NOT EXISTS "codingPlanEnabled" BOOLEAN NOT NULL DEFAULT FALSE',
  'ALTER TABLE "AiSettings" ADD COLUMN IF NOT EXISTS "codingPlanName" TEXT NOT NULL DEFAULT \'Coding Plan\'',
  'ALTER TABLE "AiSettings" ADD COLUMN IF NOT EXISTS "codingPlanDescription" TEXT NOT NULL DEFAULT \'面向编码任务的月度额度套餐\'',
  'ALTER TABLE "AiSettings" ADD COLUMN IF NOT EXISTS "codingPlanPriceCents" INTEGER NOT NULL DEFAULT 1990',
  'ALTER TABLE "AiSettings" ADD COLUMN IF NOT EXISTS "codingPlanMonthlyCostLimitCents" INTEGER NOT NULL DEFAULT 1000',
  'ALTER TABLE "AiSettings" ADD COLUMN IF NOT EXISTS "codingPlanPersonalApiEnabled" BOOLEAN NOT NULL DEFAULT TRUE',
  'ALTER TABLE "AiSettings" ADD COLUMN IF NOT EXISTS "codingPlansJson" TEXT NOT NULL DEFAULT \'\'',
  `CREATE TABLE IF NOT EXISTS "RedemptionCode" (
    "id" TEXT PRIMARY KEY,
    "codeHash" TEXT NOT NULL UNIQUE,
    "codeEncrypted" TEXT,
    "codePreview" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "rewardType" TEXT NOT NULL,
    "aiPointsBalanceCents" INTEGER NOT NULL DEFAULT 0,
    "codingPlanSnapshotJson" TEXT NOT NULL DEFAULT '{}',
    "maxRedemptions" INTEGER NOT NULL DEFAULT 1,
    "redeemedCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT TRUE,
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS "Redemption" (
    "id" TEXT PRIMARY KEY,
    "codeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rewardType" TEXT NOT NULL,
    "aiPointsBalanceCents" INTEGER NOT NULL DEFAULT 0,
    "codingPlanSnapshotJson" TEXT NOT NULL DEFAULT '{}',
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Redemption_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "RedemptionCode"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Redemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS "RedemptionCode_active_expiresAt_idx" ON "RedemptionCode"("active", "expiresAt")',
  'CREATE INDEX IF NOT EXISTS "RedemptionCode_createdAt_idx" ON "RedemptionCode"("createdAt")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "Redemption_codeId_userId_key" ON "Redemption"("codeId", "userId")',
  'CREATE INDEX IF NOT EXISTS "Redemption_userId_redeemedAt_idx" ON "Redemption"("userId", "redeemedAt")',
  'CREATE INDEX IF NOT EXISTS "Redemption_codeId_redeemedAt_idx" ON "Redemption"("codeId", "redeemedAt")'
];

async function main() {
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();

  try {
    await client.query("BEGIN");

    for (const statement of statements) {
      await client.query(statement);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }

  console.log("Applied quota wallet, Coding Plan, redemption code and model upstream schema additions.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

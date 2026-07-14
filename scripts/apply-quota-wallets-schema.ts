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
  'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "codingPlanExpiresAt" TIMESTAMP(3)',
  'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "codingPlanPersonalApiEnabled" BOOLEAN NOT NULL DEFAULT FALSE',
  'ALTER TABLE "User" ALTER COLUMN "monthlyCostLimitCents" SET DEFAULT 0',
  'ALTER TABLE "UsageRecord" ADD COLUMN IF NOT EXISTS "subscriptionCostCents" DOUBLE PRECISION NOT NULL DEFAULT 0',
  'ALTER TABLE "UsageRecord" ADD COLUMN IF NOT EXISTS "aiPointsCostCents" DOUBLE PRECISION NOT NULL DEFAULT 0',
  'ALTER TABLE "UsageRecord" ADD COLUMN IF NOT EXISTS "quotaSource" TEXT NOT NULL DEFAULT \'MONTHLY_SUBSCRIPTION\'',
  'ALTER TABLE "AiSettings" ADD COLUMN IF NOT EXISTS "gpt54ProApiBaseUrl" TEXT NOT NULL DEFAULT \'\'',
  'ALTER TABLE "AiSettings" ADD COLUMN IF NOT EXISTS "gpt54ProApiKey" TEXT',
  'ALTER TABLE "AiSettings" ADD COLUMN IF NOT EXISTS "gpt54ProOrgId" TEXT',
  'ALTER TABLE "AiSettings" ADD COLUMN IF NOT EXISTS "codingPlanEnabled" BOOLEAN NOT NULL DEFAULT FALSE',
  'ALTER TABLE "AiSettings" ADD COLUMN IF NOT EXISTS "codingPlanName" TEXT NOT NULL DEFAULT \'Coding Plan\'',
  'ALTER TABLE "AiSettings" ADD COLUMN IF NOT EXISTS "codingPlanDescription" TEXT NOT NULL DEFAULT \'面向编码任务的月度额度套餐\'',
  'ALTER TABLE "AiSettings" ADD COLUMN IF NOT EXISTS "codingPlanPriceCents" INTEGER NOT NULL DEFAULT 1990',
  'ALTER TABLE "AiSettings" ADD COLUMN IF NOT EXISTS "codingPlanMonthlyCostLimitCents" INTEGER NOT NULL DEFAULT 1000',
  'ALTER TABLE "AiSettings" ADD COLUMN IF NOT EXISTS "codingPlanPersonalApiEnabled" BOOLEAN NOT NULL DEFAULT TRUE'
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

  console.log("Applied quota wallet, Coding Plan and model upstream schema additions.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

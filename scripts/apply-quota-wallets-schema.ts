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
  'ALTER TABLE "User" ALTER COLUMN "monthlyCostLimitCents" SET DEFAULT 0',
  'ALTER TABLE "UsageRecord" ADD COLUMN IF NOT EXISTS "subscriptionCostCents" DOUBLE PRECISION NOT NULL DEFAULT 0',
  'ALTER TABLE "UsageRecord" ADD COLUMN IF NOT EXISTS "aiPointsCostCents" DOUBLE PRECISION NOT NULL DEFAULT 0',
  'ALTER TABLE "UsageRecord" ADD COLUMN IF NOT EXISTS "quotaSource" TEXT NOT NULL DEFAULT \'MONTHLY_SUBSCRIPTION\''
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

  console.log("Applied quota wallet schema additions.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

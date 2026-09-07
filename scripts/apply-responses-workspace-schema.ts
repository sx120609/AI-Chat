import "dotenv/config";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '10s'");
  await client.query(`ALTER TABLE "Message"
    ADD COLUMN IF NOT EXISTS "responseStateJson" TEXT NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS "runHeartbeatAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "stopRequested" BOOLEAN NOT NULL DEFAULT false`);
  await client.query(`ALTER TABLE "AiSettings" ADD COLUMN IF NOT EXISTS "responsesToolsJson" TEXT NOT NULL DEFAULT '{}'`);
  await client.query("COMMIT");
  console.log("Responses workspace schema is ready.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}

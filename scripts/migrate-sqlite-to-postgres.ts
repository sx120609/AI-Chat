import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import pg from "pg";

const { Client } = pg;

type SqliteValue = string | number | bigint | Buffer | null;
type SqliteRow = Record<string, SqliteValue | undefined>;

const TABLES = [
  "User",
  "Conversation",
  "Message",
  "Attachment",
  "UsageRecord",
  "UserApiKey",
  "PaymentOrder",
  "AiSettings"
] as const;

const RESET_FLAG = process.env.MIGRATE_RESET_POSTGRES === "true";
const databaseUrl = process.env.DATABASE_URL;
const sqlitePath = path.resolve(process.env.SQLITE_DATABASE_PATH || "dev.db");

if (!databaseUrl) {
  throw new Error("DATABASE_URL must point to the target PostgreSQL database.");
}

if (!fs.existsSync(sqlitePath)) {
  throw new Error(`SQLite database was not found: ${sqlitePath}`);
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function sqliteTableExists(db: Database.Database, table: string) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  return Boolean(row);
}

function sqliteColumns(db: Database.Database, table: string) {
  if (!sqliteTableExists(db, table)) {
    return new Set<string>();
  }

  return new Set(
    db
      .prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
      .all()
      .map((row) => String((row as { name: string }).name))
  );
}

function readTable(db: Database.Database, table: string) {
  if (!sqliteTableExists(db, table)) {
    return [] as SqliteRow[];
  }

  return db.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all() as SqliteRow[];
}

function value(row: SqliteRow, columns: Set<string>, key: string, fallback: SqliteValue = null) {
  if (!columns.has(key)) {
    return fallback;
  }

  return row[key] ?? fallback;
}

function stringValue(
  row: SqliteRow,
  columns: Set<string>,
  key: string,
  fallback = ""
) {
  const raw = value(row, columns, key, fallback);
  return raw === null || raw === undefined ? fallback : String(raw);
}

function optionalString(row: SqliteRow, columns: Set<string>, key: string) {
  const raw = value(row, columns, key, null);
  return raw === null || raw === undefined || raw === "" ? null : String(raw);
}

function intValue(row: SqliteRow, columns: Set<string>, key: string, fallback = 0) {
  const raw = value(row, columns, key, fallback);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolValue(row: SqliteRow, columns: Set<string>, key: string, fallback = false) {
  const raw = value(row, columns, key, fallback ? 1 : 0);

  if (typeof raw === "boolean") {
    return raw;
  }

  if (typeof raw === "string") {
    return raw === "true" || raw === "1";
  }

  return Number(raw) === 1;
}

function dateValue(row: SqliteRow, columns: Set<string>, key: string, fallback = new Date()) {
  const raw = value(row, columns, key, null);

  if (!raw) {
    return fallback;
  }

  const date = new Date(String(raw));
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function optionalDate(row: SqliteRow, columns: Set<string>, key: string) {
  const raw = value(row, columns, key, null);

  if (!raw) {
    return null;
  }

  const date = new Date(String(raw));
  return Number.isNaN(date.getTime()) ? null : date;
}

async function assertTargetReady(client: pg.Client) {
  for (const table of TABLES) {
    const result = await client.query<{ name: string | null }>(
      "SELECT to_regclass($1) AS name",
      [`public.${quoteIdentifier(table)}`]
    );

    if (!result.rows[0]?.name) {
      throw new Error(`PostgreSQL table ${table} does not exist. Run npm run db:push first.`);
    }
  }

  const counts: Array<{ table: string; count: number }> = [];

  for (const table of TABLES) {
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ${quoteIdentifier(table)}`
    );
    counts.push({ table, count: Number(result.rows[0]?.count || 0) });
  }

  const nonEmpty = counts.filter((item) => item.count > 0);

  if (nonEmpty.length > 0 && !RESET_FLAG) {
    const detail = nonEmpty.map((item) => `${item.table}=${item.count}`).join(", ");
    throw new Error(
      `Target PostgreSQL database already has data (${detail}). ` +
        "Set MIGRATE_RESET_POSTGRES=true to clear it before importing."
    );
  }

  await client.query(
    `TRUNCATE TABLE ${TABLES.map(quoteIdentifier).join(", ")} RESTART IDENTITY CASCADE`
  );
}

async function insertRow(client: pg.Client, table: string, values: Record<string, unknown>) {
  const entries = Object.entries(values);
  const columns = entries.map(([key]) => quoteIdentifier(key)).join(", ");
  const params = entries.map((_, index) => `$${index + 1}`).join(", ");
  const updates = entries
    .filter(([key]) => key !== "id")
    .map(([key]) => `${quoteIdentifier(key)} = EXCLUDED.${quoteIdentifier(key)}`)
    .join(", ");

  await client.query(
    `INSERT INTO ${quoteIdentifier(table)} (${columns}) VALUES (${params}) ` +
      `ON CONFLICT ("id") DO UPDATE SET ${updates}`,
    entries.map(([, item]) => item)
  );
}

async function main() {
  const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();

  const columns = Object.fromEntries(
    TABLES.map((table) => [table, sqliteColumns(sqlite, table)])
  ) as Record<(typeof TABLES)[number], Set<string>>;

  const rows = Object.fromEntries(TABLES.map((table) => [table, readTable(sqlite, table)])) as Record<
    (typeof TABLES)[number],
    SqliteRow[]
  >;

  await client.query("BEGIN");

  try {
    await assertTargetReady(client);

    for (const row of rows.User) {
      await insertRow(client, "User", {
        id: stringValue(row, columns.User, "id"),
        email: stringValue(row, columns.User, "email").toLowerCase(),
        name: stringValue(row, columns.User, "name", "用户"),
        passwordHash: stringValue(row, columns.User, "passwordHash"),
        role: stringValue(row, columns.User, "role", "USER"),
        userGroup: stringValue(row, columns.User, "userGroup", "NORMAL"),
        active: boolValue(row, columns.User, "active", true),
        emailVerified: boolValue(row, columns.User, "emailVerified", true),
        aiStylePrompt: stringValue(row, columns.User, "aiStylePrompt", ""),
        monthlyTokenLimit: intValue(row, columns.User, "monthlyTokenLimit", 200000),
        monthlyMessageLimit: intValue(row, columns.User, "monthlyMessageLimit", 500),
        monthlyCostLimitCents: intValue(row, columns.User, "monthlyCostLimitCents", 5000),
        quotaResetAt: dateValue(row, columns.User, "quotaResetAt"),
        createdAt: dateValue(row, columns.User, "createdAt"),
        updatedAt: dateValue(row, columns.User, "updatedAt")
      });
    }

    for (const row of rows.UserApiKey) {
      await insertRow(client, "UserApiKey", {
        id: stringValue(row, columns.UserApiKey, "id"),
        userId: stringValue(row, columns.UserApiKey, "userId"),
        name: stringValue(row, columns.UserApiKey, "name", "个人 API Key"),
        keyHash: stringValue(row, columns.UserApiKey, "keyHash"),
        keyPrefix: stringValue(row, columns.UserApiKey, "keyPrefix"),
        active: boolValue(row, columns.UserApiKey, "active", true),
        lastUsedAt: optionalDate(row, columns.UserApiKey, "lastUsedAt"),
        createdAt: dateValue(row, columns.UserApiKey, "createdAt"),
        updatedAt: dateValue(row, columns.UserApiKey, "updatedAt")
      });
    }

    for (const row of rows.Conversation) {
      await insertRow(client, "Conversation", {
        id: stringValue(row, columns.Conversation, "id"),
        userId: stringValue(row, columns.Conversation, "userId"),
        title: stringValue(row, columns.Conversation, "title", "New chat"),
        model: stringValue(row, columns.Conversation, "model", "GPT-5.5"),
        mode: stringValue(row, columns.Conversation, "mode", "CHAT"),
        pinned: boolValue(row, columns.Conversation, "pinned", false),
        archivedAt: optionalDate(row, columns.Conversation, "archivedAt"),
        createdAt: dateValue(row, columns.Conversation, "createdAt"),
        updatedAt: dateValue(row, columns.Conversation, "updatedAt")
      });
    }

    for (const row of rows.Message) {
      await insertRow(client, "Message", {
        id: stringValue(row, columns.Message, "id"),
        conversationId: stringValue(row, columns.Message, "conversationId"),
        role: stringValue(row, columns.Message, "role", "USER"),
        content: stringValue(row, columns.Message, "content"),
        reasoningContent: optionalString(row, columns.Message, "reasoningContent"),
        imageUrl: optionalString(row, columns.Message, "imageUrl"),
        webSourcesJson: stringValue(row, columns.Message, "webSourcesJson", "[]"),
        model: optionalString(row, columns.Message, "model"),
        mode: stringValue(row, columns.Message, "mode", "CHAT"),
        promptTokens: intValue(row, columns.Message, "promptTokens"),
        completionTokens: intValue(row, columns.Message, "completionTokens"),
        totalTokens: intValue(row, columns.Message, "totalTokens"),
        estimatedCostCents: intValue(row, columns.Message, "estimatedCostCents"),
        createdAt: dateValue(row, columns.Message, "createdAt")
      });
    }

    for (const row of rows.Attachment) {
      await insertRow(client, "Attachment", {
        id: stringValue(row, columns.Attachment, "id"),
        userId: stringValue(row, columns.Attachment, "userId"),
        conversationId: optionalString(row, columns.Attachment, "conversationId"),
        messageId: optionalString(row, columns.Attachment, "messageId"),
        kind: stringValue(row, columns.Attachment, "kind", "file"),
        originalName: stringValue(row, columns.Attachment, "originalName", "attachment"),
        mimeType: stringValue(row, columns.Attachment, "mimeType", "application/octet-stream"),
        sizeBytes: intValue(row, columns.Attachment, "sizeBytes"),
        storagePath: stringValue(row, columns.Attachment, "storagePath"),
        extractedText: optionalString(row, columns.Attachment, "extractedText"),
        createdAt: dateValue(row, columns.Attachment, "createdAt")
      });
    }

    for (const row of rows.UsageRecord) {
      await insertRow(client, "UsageRecord", {
        id: stringValue(row, columns.UsageRecord, "id"),
        userId: stringValue(row, columns.UsageRecord, "userId"),
        conversationId: optionalString(row, columns.UsageRecord, "conversationId"),
        messageId: optionalString(row, columns.UsageRecord, "messageId"),
        model: stringValue(row, columns.UsageRecord, "model", "GPT-5.5"),
        mode: stringValue(row, columns.UsageRecord, "mode", "CHAT"),
        promptTokens: intValue(row, columns.UsageRecord, "promptTokens"),
        completionTokens: intValue(row, columns.UsageRecord, "completionTokens"),
        totalTokens: intValue(row, columns.UsageRecord, "totalTokens"),
        estimatedCostCents: intValue(row, columns.UsageRecord, "estimatedCostCents"),
        createdAt: dateValue(row, columns.UsageRecord, "createdAt")
      });
    }

    for (const row of rows.PaymentOrder) {
      const amountCents = intValue(row, columns.PaymentOrder, "amountCents");

      await insertRow(client, "PaymentOrder", {
        id: stringValue(row, columns.PaymentOrder, "id"),
        userId: stringValue(row, columns.PaymentOrder, "userId"),
        provider: stringValue(row, columns.PaymentOrder, "provider", "easypay"),
        method: stringValue(row, columns.PaymentOrder, "method", "alipay"),
        status: stringValue(row, columns.PaymentOrder, "status", "PENDING"),
        outTradeNo: stringValue(row, columns.PaymentOrder, "outTradeNo"),
        providerTradeNo: optionalString(row, columns.PaymentOrder, "providerTradeNo"),
        subject: stringValue(row, columns.PaymentOrder, "subject", "余额充值"),
        amountCents,
        balanceCents: intValue(row, columns.PaymentOrder, "balanceCents", amountCents),
        metadataJson: stringValue(row, columns.PaymentOrder, "metadataJson", "{}"),
        paidAt: optionalDate(row, columns.PaymentOrder, "paidAt"),
        createdAt: dateValue(row, columns.PaymentOrder, "createdAt"),
        updatedAt: dateValue(row, columns.PaymentOrder, "updatedAt")
      });
    }

    for (const row of rows.AiSettings) {
      await insertRow(client, "AiSettings", {
        id: stringValue(row, columns.AiSettings, "id", "default"),
        siteName: stringValue(row, columns.AiSettings, "siteName", "Team AI Gateway"),
        siteUrl: stringValue(row, columns.AiSettings, "siteUrl", ""),
        apiBaseUrl: stringValue(row, columns.AiSettings, "apiBaseUrl", "https://api.openai.com/v1"),
        apiKey: optionalString(row, columns.AiSettings, "apiKey"),
        orgId: optionalString(row, columns.AiSettings, "orgId"),
        mockResponses: boolValue(row, columns.AiSettings, "mockResponses", false),
        chatModelMapJson: stringValue(
          row,
          columns.AiSettings,
          "chatModelMapJson",
          "{\"GPT-5.5\":\"gpt-5.5\",\"GPT-5.5-1M\":\"gpt-5.5\",\"GPT-5.4\":\"gpt-5.4\",\"GPT-5.4-Mini\":\"gpt-5.4-mini\",\"GPT-5.3-Codex-Spark\":\"gpt-5.3-codex-spark\"}"
        ),
        chatModelDisplayJson: stringValue(row, columns.AiSettings, "chatModelDisplayJson", "{}"),
        availableModelsJson: stringValue(row, columns.AiSettings, "availableModelsJson", "[]"),
        enabledChatModelsJson: stringValue(row, columns.AiSettings, "enabledChatModelsJson", "[]"),
        imageModelId: stringValue(row, columns.AiSettings, "imageModelId", "image2"),
        defaultReasoningEffort: stringValue(row, columns.AiSettings, "defaultReasoningEffort", "medium"),
        reasoningParamMode: stringValue(row, columns.AiSettings, "reasoningParamMode", "chat"),
        longContextThresholdTokens: intValue(
          row,
          columns.AiSettings,
          "longContextThresholdTokens",
          270000
        ),
        systemPromptMode: stringValue(row, columns.AiSettings, "systemPromptMode", "default"),
        customSystemPrompt: stringValue(row, columns.AiSettings, "customSystemPrompt", ""),
        modelSystemPromptsJson: stringValue(row, columns.AiSettings, "modelSystemPromptsJson", "{}"),
        codeInterpreterEnabled: boolValue(
          row,
          columns.AiSettings,
          "codeInterpreterEnabled",
          false
        ),
        codeInterpreterSandbox: stringValue(row, columns.AiSettings, "codeInterpreterSandbox", "docker"),
        codeInterpreterAllowPackageInstall: boolValue(
          row,
          columns.AiSettings,
          "codeInterpreterAllowPackageInstall",
          false
        ),
        codeInterpreterPipIndexUrl: stringValue(
          row,
          columns.AiSettings,
          "codeInterpreterPipIndexUrl",
          "https://pypi.org/simple"
        ),
        webSearchEnabled: boolValue(row, columns.AiSettings, "webSearchEnabled", false),
        webSearchProvider: stringValue(row, columns.AiSettings, "webSearchProvider", "duckduckgo"),
        webSearchMaxResults: intValue(row, columns.AiSettings, "webSearchMaxResults", 5),
        registrationEnabled: boolValue(row, columns.AiSettings, "registrationEnabled", false),
        registrationRequireEmailVerification: boolValue(
          row,
          columns.AiSettings,
          "registrationRequireEmailVerification",
          false
        ),
        registrationDefaultCostLimitCents: intValue(
          row,
          columns.AiSettings,
          "registrationDefaultCostLimitCents",
          5000
        ),
        smtpEnabled: boolValue(row, columns.AiSettings, "smtpEnabled", false),
        smtpHost: stringValue(row, columns.AiSettings, "smtpHost", ""),
        smtpPort: intValue(row, columns.AiSettings, "smtpPort", 587),
        smtpUsername: stringValue(row, columns.AiSettings, "smtpUsername", ""),
        smtpPassword: optionalString(row, columns.AiSettings, "smtpPassword"),
        smtpFromEmail: stringValue(row, columns.AiSettings, "smtpFromEmail", ""),
        smtpFromName: stringValue(row, columns.AiSettings, "smtpFromName", ""),
        smtpSecure: boolValue(row, columns.AiSettings, "smtpSecure", false),
        smtpStartTls: boolValue(row, columns.AiSettings, "smtpStartTls", true),
        easyPayEnabled: boolValue(row, columns.AiSettings, "easyPayEnabled", false),
        easyPayAllowRefund: boolValue(row, columns.AiSettings, "easyPayAllowRefund", false),
        easyPayDisplayMode: stringValue(row, columns.AiSettings, "easyPayDisplayMode", "qrcode"),
        easyPayMethodsJson: stringValue(
          row,
          columns.AiSettings,
          "easyPayMethodsJson",
          "[\"alipay\",\"wxpay\"]"
        ),
        easyPayBalanceCentsPerYuan: intValue(
          row,
          columns.AiSettings,
          "easyPayBalanceCentsPerYuan",
          100
        ),
        easyPayPid: stringValue(row, columns.AiSettings, "easyPayPid", ""),
        easyPayKey: optionalString(row, columns.AiSettings, "easyPayKey"),
        easyPayApiBaseUrl: stringValue(row, columns.AiSettings, "easyPayApiBaseUrl", ""),
        easyPayAlipayChannelId: stringValue(
          row,
          columns.AiSettings,
          "easyPayAlipayChannelId",
          ""
        ),
        easyPayWxpayChannelId: stringValue(
          row,
          columns.AiSettings,
          "easyPayWxpayChannelId",
          ""
        ),
        updatedAt: dateValue(row, columns.AiSettings, "updatedAt")
      });
    }

    await client.query("COMMIT");

    console.log("Migrated SQLite data to PostgreSQL:");
    for (const table of TABLES) {
      console.log(`- ${table}: ${rows[table].length}`);
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    sqlite.close();
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

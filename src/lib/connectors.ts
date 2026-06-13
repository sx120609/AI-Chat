import {
  parsePersonalizationSettings,
  serializePersonalizationSettings,
  type PersonalizationSettings
} from "@/lib/personalization";
import { prisma } from "@/lib/prisma";

export type AppConnectorProvider = keyof PersonalizationSettings["apps"];
export type AppConnectorStatus = "connected" | "disconnected" | "needs_setup";

type ConnectorDefinition = {
  description: string;
  label: string;
  provider: AppConnectorProvider;
  scope: string;
};

type ConnectorRecord = {
  authorizedAt: Date | null;
  createdAt: Date;
  enabled: boolean;
  id: string;
  lastUsedAt: Date | null;
  metadataJson: string;
  provider: string;
  revokedAt: Date | null;
  status: string;
  updatedAt: Date;
};

export const APP_CONNECTOR_DEFINITIONS: ConnectorDefinition[] = [
  {
    provider: "webSearch",
    label: "联网搜索",
    description: "允许聊天使用站点配置的搜索来源。",
    scope: "搜索结果"
  },
  {
    provider: "fileLibrary",
    label: "文件库",
    description: "允许在账号文件库中管理和引用上传文件。",
    scope: "上传文件"
  },
  {
    provider: "mcpConnectors",
    label: "第三方 MCP",
    description: "预留第三方工具与 MCP 授权状态。",
    scope: "外部工具"
  },
  {
    provider: "knowledgeBase",
    label: "企业知识库",
    description: "预留企业知识源授权状态。",
    scope: "知识库"
  }
];

const CONNECTOR_PROVIDERS = new Set(APP_CONNECTOR_DEFINITIONS.map((definition) => definition.provider));

function safeJsonParse(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;

    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function normalizeStatus(value: string): AppConnectorStatus {
  return value === "connected" || value === "needs_setup" ? value : "disconnected";
}

function defaultStatus(enabled: boolean): AppConnectorStatus {
  return enabled ? "connected" : "disconnected";
}

export function normalizeAppConnectorProvider(value: unknown): AppConnectorProvider | null {
  return typeof value === "string" && CONNECTOR_PROVIDERS.has(value as AppConnectorProvider)
    ? (value as AppConnectorProvider)
    : null;
}

function connectorToView(
  definition: ConnectorDefinition,
  record: ConnectorRecord | undefined,
  personalization: PersonalizationSettings
): AppConnectorView {
  const enabled = record?.enabled ?? personalization.apps[definition.provider];
  const status = record ? normalizeStatus(record.status) : defaultStatus(enabled);

  return {
    id: record?.id ?? null,
    provider: definition.provider,
    label: definition.label,
    description: definition.description,
    scope: definition.scope,
    enabled,
    status,
    authorizedAt: record?.authorizedAt?.toISOString() ?? null,
    revokedAt: record?.revokedAt?.toISOString() ?? null,
    lastUsedAt: record?.lastUsedAt?.toISOString() ?? null,
    updatedAt: record?.updatedAt?.toISOString() ?? null,
    metadata: record ? safeJsonParse(record.metadataJson) : {}
  };
}

export type AppConnectorView = {
  authorizedAt: string | null;
  description: string;
  enabled: boolean;
  id: string | null;
  label: string;
  lastUsedAt: string | null;
  metadata: Record<string, unknown>;
  provider: AppConnectorProvider;
  revokedAt: string | null;
  scope: string;
  status: AppConnectorStatus;
  updatedAt: string | null;
};

export async function listUserAppConnectors(userId: string, aiStylePrompt: string) {
  const personalization = parsePersonalizationSettings(aiStylePrompt);
  const records = await prisma.userAppConnector.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" }
  });
  const recordByProvider = new Map(records.map((record) => [record.provider, record]));

  return APP_CONNECTOR_DEFINITIONS.map((definition) =>
    connectorToView(definition, recordByProvider.get(definition.provider), personalization)
  );
}

export async function updateUserAppConnector({
  action,
  enabled,
  provider,
  userId
}: {
  action?: "authorize" | "revoke";
  enabled?: boolean;
  provider: AppConnectorProvider;
  userId: string;
}) {
  const now = new Date();
  const nextEnabled = action === "authorize" ? true : action === "revoke" ? false : Boolean(enabled);
  const status: AppConnectorStatus = nextEnabled ? "connected" : "disconnected";
  const connector = await prisma.userAppConnector.upsert({
    where: {
      userId_provider: {
        userId,
        provider
      }
    },
    create: {
      userId,
      provider,
      enabled: nextEnabled,
      status,
      authorizedAt: nextEnabled ? now : null,
      revokedAt: nextEnabled ? null : now,
      metadataJson: JSON.stringify({
        source: action ?? "toggle"
      })
    },
    update: {
      enabled: nextEnabled,
      status,
      ...(nextEnabled ? { authorizedAt: now, revokedAt: null } : { revokedAt: now }),
      metadataJson: JSON.stringify({
        source: action ?? "toggle"
      })
    }
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { aiStylePrompt: true }
  });

  if (user) {
    const personalization = parsePersonalizationSettings(user.aiStylePrompt);

    await prisma.user.update({
      where: { id: userId },
      data: {
        aiStylePrompt: serializePersonalizationSettings({
          ...personalization,
          apps: {
            ...personalization.apps,
            [provider]: nextEnabled
          }
        })
      }
    });
  }

  const refreshed = await prisma.user.findUnique({
    where: { id: userId },
    select: { aiStylePrompt: true }
  });
  const definition = APP_CONNECTOR_DEFINITIONS.find((item) => item.provider === provider)!;

  return connectorToView(
    definition,
    connector,
    parsePersonalizationSettings(refreshed?.aiStylePrompt ?? user?.aiStylePrompt ?? "")
  );
}

export async function markUserAppConnectorUsed({
  provider,
  userId
}: {
  provider: AppConnectorProvider;
  userId: string;
}) {
  const now = new Date();

  await prisma.userAppConnector.upsert({
    where: {
      userId_provider: {
        userId,
        provider
      }
    },
    create: {
      userId,
      provider,
      enabled: true,
      status: "connected",
      authorizedAt: now,
      lastUsedAt: now,
      metadataJson: JSON.stringify({
        source: "runtime"
      })
    },
    update: {
      lastUsedAt: now
    }
  });
}

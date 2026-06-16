export type MessageGenerationStatus = "running" | "done" | "error" | "stopped";

export type PersistedToolEvent = {
  detail?: string;
  finishedAt?: number;
  id: string;
  label: string;
  startedAt: number;
  status: "running" | "done" | "skipped" | "error";
  type:
    | "router"
    | "attachments"
    | "web_search"
    | "file_analysis"
    | "memory"
    | "generation"
    | "usage"
    | "image";
};

const TOOL_EVENT_STATUSES = new Set(["running", "done", "skipped", "error"]);
const TOOL_EVENT_TYPES = new Set([
  "router",
  "attachments",
  "web_search",
  "file_analysis",
  "memory",
  "generation",
  "usage",
  "image"
]);
const GENERATION_STATUSES = new Set(["running", "done", "error", "stopped"]);

export function normalizeGenerationStatus(value: unknown): MessageGenerationStatus {
  return typeof value === "string" && GENERATION_STATUSES.has(value)
    ? (value as MessageGenerationStatus)
    : "done";
}

function cleanString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function cleanTimestamp(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

export function normalizeToolEvent(value: unknown): PersistedToolEvent | null {
  const event = value as Partial<PersistedToolEvent>;
  const id = cleanString(event.id, 80);
  const label = cleanString(event.label, 80);
  const startedAt = cleanTimestamp(event.startedAt);

  if (
    !id ||
    !label ||
    !startedAt ||
    typeof event.status !== "string" ||
    !TOOL_EVENT_STATUSES.has(event.status) ||
    typeof event.type !== "string" ||
    !TOOL_EVENT_TYPES.has(event.type)
  ) {
    return null;
  }

  const finishedAt = cleanTimestamp(event.finishedAt);
  const detail = cleanString(event.detail, 500);

  return {
    id,
    label,
    startedAt,
    status: event.status as PersistedToolEvent["status"],
    type: event.type as PersistedToolEvent["type"],
    ...(detail ? { detail } : {}),
    ...(finishedAt ? { finishedAt } : {})
  };
}

export function normalizeToolEvents(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeToolEvent)
    .filter((event): event is PersistedToolEvent => Boolean(event))
    .slice(0, 30);
}

export function stringifyToolEvents(events: PersistedToolEvent[]) {
  return JSON.stringify(normalizeToolEvents(events)).slice(0, 12000);
}

export function parseToolEventsJson(value: string | null | undefined) {
  if (!value) {
    return [];
  }

  try {
    return normalizeToolEvents(JSON.parse(value) as unknown);
  } catch {
    return [];
  }
}

export function mergePersistedToolEvent(
  current: PersistedToolEvent[],
  event: Omit<PersistedToolEvent, "startedAt"> & Partial<Pick<PersistedToolEvent, "startedAt">>,
  now = Date.now()
) {
  const nextEvent = normalizeToolEvent({
    ...event,
    startedAt: event.startedAt ?? now,
    finishedAt: event.finishedAt ?? (event.status === "running" ? undefined : now)
  });

  if (!nextEvent) {
    return current;
  }

  const index = current.findIndex((item) => item.id === nextEvent.id);

  if (index < 0) {
    return [...current, nextEvent];
  }

  return current.map((item) =>
    item.id === nextEvent.id
      ? {
          ...item,
          ...nextEvent,
          finishedAt:
            event.finishedAt ?? (event.status === "running" ? undefined : item.finishedAt ?? now),
          startedAt: event.startedAt ?? item.startedAt
        }
      : item
  );
}

export function epochMillisFromDate(value: Date | null | undefined) {
  return value ? value.getTime() : null;
}

export function dateFromEpochMillis(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? new Date(value)
    : null;
}

export function messageProcessForClient(message: {
  generationStatus?: string | null;
  processFinishedAt?: Date | null;
  processStartedAt?: Date | null;
  streamStatus?: string | null;
  toolEventsJson?: string | null;
}) {
  const generationStatus = normalizeGenerationStatus(message.generationStatus);

  return {
    generationStatus,
    pending: generationStatus === "running",
    processFinishedAt: epochMillisFromDate(message.processFinishedAt),
    processStartedAt: epochMillisFromDate(message.processStartedAt),
    streamStatus: message.streamStatus ?? null,
    toolEvents: parseToolEventsJson(message.toolEventsJson)
  };
}

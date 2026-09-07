export type ResponsesTools = {
  artifacts: boolean;
  codeInterpreter: boolean;
  imageGeneration: boolean;
  fileSearch: boolean;
  sharedVectorStoreIds: string[];
  modelIds: string[];
  codeSessionCostCents: number;
  imageCostCents: number;
  fileSearchCostCents: number;
};

export const DEFAULT_RESPONSES_TOOLS: ResponsesTools = {
  artifacts: true, codeInterpreter: false, imageGeneration: false, fileSearch: false,
  sharedVectorStoreIds: [], modelIds: [], codeSessionCostCents: 0, imageCostCents: 0, fileSearchCostCents: 0
};

export function normalizeResponsesTools(value: unknown): ResponsesTools {
  let input = value;
  if (typeof input === "string") { try { input = JSON.parse(input); } catch { input = {}; } }
  const record = (input && typeof input === "object" ? input : {}) as Partial<ResponsesTools>;
  const ids = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && /^[\w.:-]{1,120}$/.test(id)))].slice(0, 50) : [];
  const price = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100_000, value)) : 0;
  return {
    artifacts: record.artifacts !== false,
    codeInterpreter: record.codeInterpreter === true,
    imageGeneration: record.imageGeneration === true,
    fileSearch: record.fileSearch === true,
    sharedVectorStoreIds: ids(record.sharedVectorStoreIds).filter(id => id.startsWith("vs_")),
    modelIds: ids(record.modelIds),
    codeSessionCostCents: price(record.codeSessionCostCents),
    imageCostCents: price(record.imageCostCents),
    fileSearchCostCents: price(record.fileSearchCostCents)
  };
}

export function toolsForModel(settings: ResponsesTools | undefined, modelId: string, upstreamId: string): ResponsesTools {
  const tools = normalizeResponsesTools(settings);
  if (tools.modelIds.length && !tools.modelIds.includes(modelId) && !tools.modelIds.includes(upstreamId)) return { ...tools, artifacts: false, codeInterpreter: false, imageGeneration: false, fileSearch: false };
  return tools;
}

import { buildCodexConfig } from "@/lib/codex-config";

export type CCSwitchApp = "claude" | "codex" | "gemini";

export type CCSwitchModelSelection = {
  model: string;
  haikuModel?: string;
  sonnetModel?: string;
  opusModel?: string;
};

type BuildCCSwitchImportUrlInput = {
  app: CCSwitchApp;
  apiKey: string;
  models: CCSwitchModelSelection;
  name: string;
  serverAddress: string;
};

function normalizeServerAddress(value: string) {
  const url = new URL(value.trim());

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("CC Switch 只支持 HTTP 或 HTTPS 接口地址。");
  }

  url.search = "";
  url.hash = "";

  return url.toString().replace(/\/+$/, "");
}

function encodeBase64Utf8(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

export function buildCCSwitchImportUrl({
  app,
  apiKey,
  models,
  name,
  serverAddress
}: BuildCCSwitchImportUrlInput) {
  const normalizedAddress = normalizeServerAddress(serverAddress);
  const endpoint = app === "codex" ? `${normalizedAddress}/v1` : normalizedAddress;
  const params = new URLSearchParams();

  params.set("resource", "provider");
  params.set("app", app);
  params.set("name", name.trim());
  params.set("endpoint", endpoint);
  params.set("apiKey", apiKey.trim());

  if (app === "codex") {
    params.set("configFormat", "json");
    params.set(
      "config",
      encodeBase64Utf8(
        JSON.stringify({
          auth: { OPENAI_API_KEY: apiKey.trim() },
          config: buildCodexConfig({
            baseUrl: endpoint,
            envKey: null,
            model: models.model,
            providerId: "custom",
            siteName: name
          })
        })
      )
    );
    params.set("icon", "openai");
  }

  for (const [key, value] of Object.entries(models)) {
    const normalizedValue = value?.trim();

    if (normalizedValue) {
      params.set(key, normalizedValue);
    }
  }

  params.set("homepage", normalizedAddress);
  params.set("enabled", "true");

  return `ccswitch://v1/import?${params.toString()}`;
}

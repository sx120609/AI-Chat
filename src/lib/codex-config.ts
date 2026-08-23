export const LOWIQ_API_KEY_ENV = "LOWIQ_API_KEY";

export type CodexConfigOs = "unix" | "windows";

type BuildCodexConfigInput = {
  baseUrl: string;
  envKey?: string | null;
  model: string;
  providerId?: string;
  siteName: string;
};

function normalizeCodexBaseUrl(value: string) {
  const trimmed = value.trim();

  // The profile dialog renders once before window.location.origin is available.
  // Keep the temporary relative value render-safe; the client effect immediately
  // replaces it with the absolute public origin before the dialog can be opened.
  if (trimmed.startsWith("/")) {
    return trimmed.replace(/\/+$/, "") || "/";
  }

  const url = new URL(trimmed);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Codex 只支持 HTTP 或 HTTPS 接口地址。");
  }

  url.search = "";
  url.hash = "";

  return url.toString().replace(/\/+$/, "");
}

function tomlString(value: string) {
  return JSON.stringify(value);
}

function powerShellDoubleQuote(value: string) {
  return `"${value.replace(/`/g, "``").replace(/"/g, '`"')}"`;
}

export function buildCodexConfig({
  baseUrl,
  envKey = LOWIQ_API_KEY_ENV,
  model,
  providerId = "lowiq",
  siteName
}: BuildCodexConfigInput) {
  if (!/^[A-Za-z0-9_-]+$/.test(providerId)) {
    throw new Error("Codex Provider ID 格式不正确。");
  }

  const normalizedBaseUrl = normalizeCodexBaseUrl(baseUrl);
  const displayName = siteName.trim() || "AI Gateway";
  const normalizedModel = model.trim();
  const normalizedEnvKey = envKey?.trim() || "";
  const providerLines = [
    `[model_providers.${providerId}]`,
    `name = ${tomlString(displayName)}`,
    `base_url = ${tomlString(normalizedBaseUrl)}`,
    'wire_api = "responses"'
  ];

  if (normalizedEnvKey) {
    providerLines.push(
      `env_key = ${tomlString(normalizedEnvKey)}`,
      `env_key_instructions = ${tomlString(`Set ${normalizedEnvKey} to your ${displayName} API key`)}`
    );
  }

  providerLines.push(
    "requires_openai_auth = true",
    "supports_standalone_web_search = true"
  );

  return [
    `model_provider = ${tomlString(providerId)}`,
    `model = ${tomlString(normalizedModel)}`,
    `review_model = ${tomlString(normalizedModel)}`,
    'model_reasoning_effort = "high"',
    "disable_response_storage = true",
    'web_search = "live"',
    "windows_wsl_setup_acknowledged = true",
    "",
    ...providerLines,
    "",
    "[features]",
    "goals = true"
  ].join("\n");
}

export function buildCodexAuthRepairCommand({
  baseUrl,
  os
}: {
  baseUrl: string;
  os: CodexConfigOs;
}) {
  const normalizedBaseUrl = normalizeCodexBaseUrl(baseUrl);

  if (os === "windows") {
    return [
      '$path = Join-Path $env:USERPROFILE ".codex\\config.toml"',
      'if (!(Test-Path -LiteralPath $path)) { throw "未找到 Codex config.toml，请先导入完整配置。" }',
      `$target = ${powerShellDoubleQuote(normalizedBaseUrl)}`,
      "$content = [IO.File]::ReadAllText($path)",
      "$sections = [regex]::Matches($content, '(?ms)^\\[model_providers\\.[^\\]]+\\]\\r?\\n.*?(?=^\\[|\\z)')",
      '$match = $sections | Where-Object { $_.Value.Contains("base_url = `"$target`"") } | Select-Object -First 1',
      'if (-not $match) { throw "未找到当前站点的 Codex Provider 配置，请重新复制完整配置。" }',
      '$backup = "$path.bak-$((Get-Date).ToString(\'yyyyMMddHHmmss\'))"',
      "Copy-Item -LiteralPath $path -Destination $backup -Force",
      "$section = $match.Value",
      "$authPattern = '(?m)^requires_openai_auth\\s*=\\s*(?:true|false)\\s*$'",
      'if ([regex]::IsMatch($section, $authPattern)) { $section = [regex]::Replace($section, $authPattern, "requires_openai_auth = true") } else { $section = $section.TrimEnd() + "`r`nrequires_openai_auth = true`r`n" }',
      "$updated = $content.Remove($match.Index, $match.Length).Insert($match.Index, $section)",
      "$utf8 = [Text.UTF8Encoding]::new($false)",
      '[IO.File]::WriteAllText($path, $updated, $utf8)',
      'Write-Host "修复完成，原配置已备份到 $backup。请完全退出并重启 Codex。"'
    ].join("; ");
  }

  return [
    "python3 - <<'PY'",
    "import datetime, json, pathlib, re, shutil",
    'path = pathlib.Path.home() / ".codex" / "config.toml"',
    'if not path.exists(): raise SystemExit("未找到 Codex config.toml，请先导入完整配置。")',
    `target = ${JSON.stringify(normalizedBaseUrl)}`,
    'content = path.read_text(encoding="utf-8")',
    'pattern = re.compile(r"^\\[model_providers\\.[^\\]]+\\]\\r?\\n.*?(?=^\\[|\\Z)", re.M | re.S)',
    'match = next((item for item in pattern.finditer(content) if re.search(r"^base_url\\s*=\\s*" + re.escape(json.dumps(target)) + r"\\s*$", item.group(0), re.M)), None)',
    'if match is None: raise SystemExit("未找到当前站点的 Codex Provider 配置，请重新复制完整配置。")',
    'backup = path.with_name(path.name + ".bak-" + datetime.datetime.now().strftime("%Y%m%d%H%M%S"))',
    "shutil.copy2(path, backup)",
    'section = match.group(0)',
    'auth_pattern = re.compile(r"^requires_openai_auth\\s*=\\s*(?:true|false)\\s*$", re.M)',
    'section = auth_pattern.sub("requires_openai_auth = true", section) if auth_pattern.search(section) else section.rstrip() + "\\nrequires_openai_auth = true\\n"',
    'path.write_text(content[:match.start()] + section + content[match.end():], encoding="utf-8")',
    'print(f"修复完成，原配置已备份到 {backup}。请完全退出并重启 Codex。")',
    "PY"
  ].join("\n");
}

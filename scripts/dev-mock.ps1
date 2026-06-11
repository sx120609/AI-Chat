param(
  [int]$Port = 3000
)

$env:AUTH_SECRET = if ($env:AUTH_SECRET) { $env:AUTH_SECRET } else { "local-dev-secret" }
$env:AI_MOCK_RESPONSES = "true"
$env:AI_API_KEY = if ($env:AI_API_KEY) { $env:AI_API_KEY } else { "mock" }

npm run dev -- --hostname 127.0.0.1 --port $Port

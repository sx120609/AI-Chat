# 小团队 AI API 网关

一个面向小团队的 AI API 网关网站。每个成员有独立账号、聊天记录、月度额度和用量统计；管理员可以创建用户、设置额度、查看消耗并重置当前额度窗口。上游 AI API Key 保存在服务端数据库或服务端环境变量中，不会返回给前端。

## 功能

- 用户登录与管理员后台
- 类 ChatGPT 聊天界面，支持服务端流式输出
- 会话与消息历史持久化
- 模型选择：`GPT-5.5`、`GPT-5.5-1M`、`GPT-5.4`、`GPT-5.4-Mini`、`GPT-5.3-Codex-Spark`
- 管理员可从上游 `/models` 自动刷新模型，并启用/停用聊天模型
- 聊天页支持推理强度选择：低、中、高、超高
- 支持全局和模型专属系统提示词，用于修正 Sub2API 后端透出的 Codex CLI 等身份设定
- 支持 Responses API 流式输出状态提示，并兼容部分上游把非 SSE JSON 返回给 `/responses` 的情况
- 默认不向用户展示上游原始 `reasoning_content`，避免泄漏订阅后端的内部身份或推理噪声
- 后端按实际请求体估算上下文窗口，聊天页以轻量状态显示；接近长上下文或裁剪历史时再提示用户新开会话
- 支持 Markdown/GFM 消息渲染
- 原生 `image2` 生图与编辑：同一个聊天输入框内可直接说“画一张...”，可上传图片让 image2 编辑，也可对已生成图片继续修改
- 支持上传 ZIP、PDF、Word、Excel、CSV、TXT 和图片；附件优先直接交给主模型分析，后端提取文本只作为历史上下文和不支持原始文件输入时的兜底
- 预留代码解释器式沙箱配置；当前聊天不会自动用轻量模型生成代码分析附件
- 可选服务端联网搜索：管理员允许后，后端会先规划是否需要搜索，用户也可为单次消息强制开启，回答保留来源卡片
- 管理后台可设置站点名称、站点地址、API Base URL、API Key、Org ID 和 Mock 模式
- 用户级月度费用额度，费用按模型输入/输出 token 单价估算
- 超额前置拦截，超额后禁止继续调用
- 管理员查看所有用户用量、调整额度、启停账号、重置额度窗口
- Prisma + PostgreSQL 默认配置，并提供旧 SQLite 数据迁移脚本

## 技术栈

- Next.js App Router
- TypeScript
- Prisma
- PostgreSQL 数据库
- Tailwind CSS

## 快速开始

```bash
npm install
cp .env.example .env
# 编辑 .env，至少设置 DATABASE_URL、AUTH_SECRET、ADMIN_EMAIL、ADMIN_PASSWORD
npm run db:push
npm run db:seed
npm run dev
```

打开 `http://localhost:3000`。

管理员账号由 `.env` 里的 `ADMIN_EMAIL` 和 `ADMIN_PASSWORD` 创建。项目不会再写入示例用户或示例聊天。

## 生产部署

项目内置 `deploy.sh`，默认适配 Ubuntu/Debian 服务器。首次部署时，在服务器上克隆仓库后执行：

```bash
chmod +x deploy.sh
./deploy.sh install
```

脚本会安装系统依赖、Node.js、PostgreSQL，创建本地数据库和 `.env`，执行 `npm ci`、`npm run db:push`、`npm run db:seed`、`npm run build`，并注册 `systemd` 服务 `team-ai-gateway`。如果没有可用 Redis，脚本会尝试安装并启动本机 `redis-server`；如果服务器已有可连接的 Redis，会直接复用。生产服务默认监听 `20131` 端口；重新执行 `deploy` 或 `update` 会重写 systemd 服务并重启到当前端口。如果 `.env` 不存在，脚本会生成管理员初始密码并在终端输出一次，同时保存到服务器本地 `.env`。

从 GitHub 拉取最新代码并更新部署：

```bash
./deploy.sh update
```

常用运维命令：

```bash
./deploy.sh status
./deploy.sh logs
./deploy.sh restart
./deploy.sh stop
```

常用覆盖参数：

```bash
APP_PORT=20132 ./deploy.sh install
SETUP_NGINX=true DOMAIN=example.com ./deploy.sh install
INSTALL_DOCKER=true ./deploy.sh install
SKIP_LOCAL_POSTGRES=true DATABASE_URL="postgresql://user:pass@host:5432/db?schema=public" ./deploy.sh install
```

`INSTALL_DOCKER=true` 只是在服务器上安装 Docker，方便以后开启代码解释器沙箱；后台功能默认仍是关闭的。Nginx 配置只创建 HTTP 反向代理，HTTPS 证书建议再用 Certbot 或你的面板统一配置。

登录后进入 `管理后台 -> 站点与 API 设置`，填写站点信息、API 地址和 API Key。也可以先在 `.env` 写入 `SITE_NAME`、`SITE_URL`、`AI_API_BASE_URL` 和 `AI_API_KEY` 作为初始化兜底。

如果使用 Sub2API、One API、New API 这类 OpenAI-compatible 网关，`API 地址` 要填写兼容端点根路径，通常需要保留 `/v1`，例如：

```text
http://your-sub2api-host:8080/v1
```

后台的“模型映射”用于把页面上的展示模型名转换成实际发给上游的模型 ID。若 Sub2API 面板里显示的模型 ID 不同，请把对应输入框改成上游实际模型名。

点击“刷新上游模型”会调用当前 API 地址下的 `/models`。网关会过滤掉常见的 image、embedding、audio、moderation 等非聊天模型，聊天模型是否对用户可见由“启用模型”决定。

点击“测试连接”会在后端检查 API 地址格式、`/v1` 路径、Key 是否已保存，以及 `/models` 是否可访问。诊断结果只返回状态和模型样例，不会把完整 Key 发给前端。

“默认推理强度”只提供 Codex 风格的 `低`、`中`、`高`、`超高` 四档。聊天、工具路由、搜索规划、上下文压缩等文本请求统一调用 Responses API，并按 `reasoning.effort` 透传为 `low`、`medium`、`high`、`xhigh`；如果你的上游不支持推理参数，可在后台关闭。

聊天请求会优先使用 Responses API 的 `stream: true`、`store: false`、`input` 和 `reasoning.effort`。如果上游返回“不支持/无效参数”类兼容错误，会依次去掉推理参数、去掉 `store`，带原始文件的请求还会退回到纯文本附件上下文。生图消息会保留在普通聊天会话中，不需要切换到单独的生图模式。

“身份与系统提示词”用于修正订阅转发类上游可能携带的默认身份设定。默认模板会让模型在网页聊天场景下按当前选择的模型名回答身份问题；`GPT-5.5-1M` 会自称有 1M 超长上下文的 GPT-5.5。也可以设置全局自定义提示词，或为某个模型单独覆盖。提示词支持 `{model}`、`{model_identity}`、`{date}`、`{time}` 和 `{timezone}` 占位符；聊天请求会优先使用用户浏览器传来的本地日期、时间和时区。

“长上下文阈值”默认是 `270000` tokens。OpenAI 当前价格页说明 GPT-5.5、GPT-5.4、GPT-5.4 mini 的标准价格适用于 270K 以下上下文；如果你使用的 Sub2API 上游另有规则，可以在后台调整。聊天页显示的是后端估算值，最终计费仍以上游返回的 `usage` 为准。

## 环境变量

```bash
DB_NAME="team_ai_gateway"
DB_USER="team_ai_gateway"
DB_PASSWORD="change-me"
DATABASE_URL="postgresql://team_ai_gateway:change-me@127.0.0.1:5432/team_ai_gateway?schema=public"
REDIS_URL="redis://127.0.0.1:6379"
CACHE_ENABLED="true"
AUTH_SECRET="change-me-to-a-long-random-secret"
AI_API_KEY=""
AI_API_BASE_URL="https://api.openai.com/v1"
AI_MOCK_RESPONSES="false"
SITE_NAME="Team AI Gateway"
SITE_URL=""
REGISTRATION_ENABLED="false"
REGISTRATION_REQUIRE_EMAIL_VERIFICATION="false"
REGISTRATION_DEFAULT_COST_LIMIT_CENTS="5000"
SMTP_ENABLED="false"
SMTP_HOST=""
SMTP_PORT="587"
SMTP_USERNAME=""
SMTP_PASSWORD=""
SMTP_FROM_EMAIL=""
SMTP_FROM_NAME=""
SMTP_SECURE="false"
SMTP_STARTTLS="true"
ADMIN_EMAIL=""
ADMIN_PASSWORD=""
ADMIN_NAME="管理员"
```

Redis 是默认缓存依赖。`deploy.sh` 会先检测 `.env` 里的 `REDIS_URL` 是否可连接；可连接时直接复用现有 Redis，不会强制重启 `redis-server.service`。如果不需要 Redis 缓存，可以设置 `CACHE_ENABLED="false"`。后端会缓存 AI 运行设置、站点设置和短 TTL 用量摘要；发消息前的额度校验仍强制刷新数据库，避免缓存导致超额放行。Redis 连接失败时应用会短暂禁用缓存并继续运行。

`AI_API_BASE_URL` 可指向任何 OpenAI-compatible 的自定义接口地址，例如 `https://your-gateway.example.com/v1`。推荐在管理后台配置；前端只会看到是否已设置 Key 和 Key 尾号，不会拿到完整 Key。

本地无 API Key 时可把 `AI_MOCK_RESPONSES` 设为 `true`，聊天和 image2 会走本地 mock。

## 文件上传

普通文件上传会优先把原始附件作为主模型输入：图片以多模态图片输入传给兼容上游，非图片文件在大小允许时通过上游文件输入交给主模型直接解析。后端仍会用 `jszip`、`pdf-parse`、`mammoth`、`exceljs` 等提取可读文本，作为历史上下文、上下文压缩和上游不支持原始文件输入时的兜底。解析结果保存在数据库，不会把文件内容暴露给前端。

代码解释器沙箱配置仍保留在环境变量和后台设置中，但当前聊天链路不会自动让轻量模型生成 Python 来分析附件。轻量模型只用于判断本条消息应该聊天、生图或联网搜索。

相关环境变量：

```bash
CODE_INTERPRETER_ENABLED="false"
CODE_INTERPRETER_SANDBOX="docker"
CODE_INTERPRETER_DOCKER_IMAGE="python:3.12-slim"
CODE_INTERPRETER_ALLOW_PACKAGE_INSTALL="false"
CODE_INTERPRETER_PIP_INDEX_URL="https://pypi.org/simple"
CODE_INTERPRETER_TIMEOUT_MS="45000"
CODE_INTERPRETER_PACKAGE_CACHE="true"
CODE_INTERPRETER_CACHE_DIR=".cache/code-interpreter"
CODE_INTERPRETER_PACKAGE_INSTALL_TIMEOUT_MS="120000"
CODE_INTERPRETER_DOCKER_MEMORY="768m"
CODE_INTERPRETER_DOCKER_CPUS="1"
WEB_SEARCH_ENABLED="false"
WEB_SEARCH_PROVIDER="duckduckgo"
WEB_SEARCH_MAX_RESULTS="5"
REGISTRATION_ENABLED="false"
REGISTRATION_REQUIRE_EMAIL_VERIFICATION="false"
REGISTRATION_DEFAULT_COST_LIMIT_CENTS="5000"
SMTP_ENABLED="false"
SMTP_HOST=""
SMTP_PORT="587"
SMTP_USERNAME=""
SMTP_PASSWORD=""
SMTP_FROM_EMAIL=""
SMTP_FROM_NAME=""
SMTP_SECURE="false"
SMTP_STARTTLS="true"
```

这些 `CODE_INTERPRETER_*` 变量目前只是保留配置，不会被聊天请求自动调用。以后如果重新接入代码执行工具，仍应只允许 Docker 沙箱运行，且默认 `--network none`。

## 联网搜索

联网搜索默认关闭。管理员可在后台开启，也可用环境变量初始化：

```bash
WEB_SEARCH_ENABLED="false"
WEB_SEARCH_PROVIDER="duckduckgo"
WEB_SEARCH_MAX_RESULTS="5"
```

搜索由服务端请求 DuckDuckGo 结果，前端用户浏览器不会直接访问搜索引擎。管理员开启后，后端会先用 AI 规划搜索词，再对最新/今天/实时/新闻/价格/版本等问题自动搜索；用户也可以点亮聊天输入框的联网按钮，强制下一条消息搜索。来源会作为卡片保存到助手消息中。天气类问题会优先补充服务端实时天气来源，提高“今天/当前天气”这类回答的稳定性。

## 注册与邮件

公开注册默认关闭。管理员可在管理后台的“用户”选项卡开启注册、设置注册默认余额，并选择是否要求邮箱验证。启用邮箱验证前，需要先在“邮件”选项卡配置 SMTP 服务。

SMTP 支持 465 这类隐式 SSL/TLS，也支持 587 这类 STARTTLS。`SMTP_SECURE="true"` 表示连接一开始就使用 TLS；`SMTP_STARTTLS="true"` 表示普通 SMTP 连接后必须升级到 TLS。后台会隐藏已保存的 SMTP 密码，并提供测试邮件按钮。

## 数据库

默认使用 PostgreSQL：

```bash
DATABASE_URL="postgresql://team_ai_gateway:change-me@127.0.0.1:5432/team_ai_gateway?schema=public"
```

先在 PostgreSQL 中创建数据库，例如 `team_ai_gateway`，然后执行：

```bash
npm run db:push
npm run db:seed
```

从旧版 SQLite `dev.db` 迁移到 PostgreSQL 时，先确保 `.env` 的 `DATABASE_URL` 指向新的 PostgreSQL 数据库，执行建表后再导入：

```bash
npm run db:push
npm run db:migrate:sqlite-to-pg
```

迁移脚本默认读取项目根目录的 `dev.db`。如果目标 PostgreSQL 已有数据，脚本会停止以避免覆盖；确认要清空目标库后可设置 `MIGRATE_RESET_POSTGRES=true` 再运行。需要指定旧库路径时可设置 `SQLITE_DATABASE_PATH`。

## 额度与费用估算

额度窗口按自然月自动切换；管理员点击“重置额度”会把该用户的 `quotaResetAt` 设置为当前时间，当前窗口用量重新从该时间开始统计。额度只按费用扣减，消息数和 token 数仅作为用量明细展示。

聊天模型的输入/缓存输入/输出 token 单价与 image2 固定费用位于 `src/lib/models.ts`，管理后台模型列表也会展示单价。由于 MVP 支持的模型名可能来自自定义上游，默认价格是网关侧估算值，可按实际供应商价格调整。

token 统计优先使用上游返回的 `usage`，包括 `prompt_tokens`、`completion_tokens`、`prompt_tokens_details.cached_tokens` 和 `completion_tokens_details.reasoning_tokens` 等细项；如果 usage 中包含 `cost` / `total_cost` / `cost_usd`，会优先采用上游返回费用。聊天费用以小数美分存储，能展示 `$0.010155` 这类 Sub2API 明细级别的小额费用。如果上游流式响应没有返回 usage，网关会用 `src/lib/tokens.ts` 的近似算法估算，并在消息底部标记“估算”。

## 安全边界

- 所有上游调用都从 `/api/chat` 与 `/api/images` 在服务端发起。
- API Key 和自定义 Base URL 只存在于服务端数据库或服务端环境变量；管理后台读取时不会回显完整 Key。
- 前端只拿到网关返回的模型名、消息、图片、用量和错误信息。
- 密码使用 Node `scrypt` 哈希保存。
- 登录态使用 HTTP-only cookie，并用 `AUTH_SECRET` 做 HMAC 签名。
- 代码解释器默认关闭；开启后也只通过 Docker 沙箱运行，输入文件会复制到临时目录，项目目录和用户主目录不会挂载进容器。

## 常用命令

```bash
npm run dev
npm run build
npm run lint
npm run db:push
npm run db:seed
npm run prisma:studio
```

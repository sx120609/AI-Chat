# Sub2API 工具兼容性核对

核对日期：2026-09-07。源码：Wei-Shaw/sub2api，提交 b7dba62678a834080564966c002fd0ca2b328b7a。此结论针对公开源码，不代表当前部署版本或账号已实测。

| 本站选项 | 核对结果 |
| --- | --- |
| 创建可下载成果 | 本站 create_artifact 函数保存文件，需要上游 function calling；不是 Sub2API 托管文件服务。本地模拟上游流程通过，真实上游仍需验证。 |
| 上游图片生成 | openai_codex_transform.go 明确适配 image_generation，且对 Spark 等不支持模型做特殊处理；取决于版本、模型、账号及路由。 |
| 上游代码执行 | 未找到 OpenAI/Codex 的完整支持承诺。公开 gateway.go 没有 /v1/containers 文件下载路由，而本站 workspace-artifacts.ts 依赖该接口，不能宣称完整兼容。Grok 的工具类型白名单不证明 OpenAI/Codex 支持。 |
| 上游共享知识库 | 未找到 OpenAI/Codex file_search 完整支持承诺及 Vector Store 管理路由。透传字段不保证托管检索可执行，现成知识库也需要匹配账号及权限。 |

源码参考：
- https://github.com/Wei-Shaw/sub2api/blob/b7dba62678a834080564966c002fd0ca2b328b7a/backend/internal/service/openai_codex_transform.go
- https://github.com/Wei-Shaw/sub2api/blob/b7dba62678a834080564966c002fd0ca2b328b7a/backend/internal/server/routes/gateway.go
- https://github.com/Wei-Shaw/sub2api/blob/b7dba62678a834080564966c002fd0ca2b328b7a/backend/internal/service/openai_gateway_grok.go

模型 ID 留空只表示本站不筛选，不会自动检测模型能力。费用字段是本站附加收费，不是上游实际价格。默认配置只启用本站成果工具，其余三项默认关闭；已有管理员设置不由本次核对改写。

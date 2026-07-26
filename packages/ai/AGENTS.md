# @duoduo/ai 包开发指南

本包负责 Agent 服务使用的供应商中立 AI 运行时边界，以及内建 Provider、协议、认证、传输、媒体生成和 Node CLI。Agent 应通过本包的公共导出完成模型选择与运行时组装，不得深度导入 `src/`。核心领域类型必须独立于具体 Provider；Provider 线协议细节必须封装在运行时/测试边界之后；模块导入期间绝不能隐式读取凭证或环境变量。

## 当前状态与事实来源

当前实现状态以 `package.json` 的 `exports`/`scripts`、`src/providers/_generated/manifest.ts` 和 `IMPLEMENTATION-STATUS.md` 为准。Provider 数量、公共导出或实现切片发生变化时，必须在同一变更中更新生成目录和状态文档；不要只手工修改本文中的数量描述。

## 公共边界

- `@duoduo/ai` 暴露供应商中立的运行时、认证、模型、流和响应类型。
- `@duoduo/ai/images` 负责供应商中立的图像模型、输入/输出、流、成本和直接生成协议；协议专用字段必须通过声明合并保持类型化。
- `@duoduo/ai/videos` 负责供应商中立的视频模型、输入/输出、流、成本、直接/可恢复生成以及严格的操作声明协议。
- `@duoduo/ai/protocols/xai-images` 和 `@duoduo/ai/protocols/xai-videos` 负责官方 Grok Imagine 图像/视频线协议。xAI 视频请求 ID 必须在解析路由前完成校验；生成、编辑和扩展路由必须显式定义，不得依靠推断。
- `@duoduo/ai/protocols/ark-video-tasks` 和 Doubao 视频绑定负责官方 Seedance 2.0 多模态任务协议。任务 ID 必须在解析轮询路由前完成校验；只接受引用图像、视频和音频角色；不支持的控制项或媒体形式必须采用故障关闭策略。
- `@duoduo/ai/protocols/kling-video-tasks` 和 `@duoduo/ai/providers/kling` 负责官方 Kling VIDEO 3.0 Omni 任务协议。任务 ID 必须在构建查询前完成校验；只接受以 URL 为来源的首帧、尾帧和参考图像；制品在固定的 30 天保留期后过期；在官方协议提供远程取消能力之前，不得实现该能力。
- `@duoduo/ai/protocols/duoduo-generation-v1` 和 `@duoduo/ai/providers/self-hosted-generation` 暴露项目自有的 Generation Gateway 目录/任务边界。公共接口仅限模型发现及创建、获取、取消生成任务：不得暴露 `CloudGpuDriver`、云 SDK、调度器或业务 `ArtifactStore`。网关返回的 GPU 实例、容器、节点/主机和 IP 扩展字段均不可信；应丢弃这些字段并发送诊断信息，不得将其投射到公共事件或操作引用中。真实基础设施必须封装在注入的 `DuoduoGenerationGateway` 实现之后。
- `@duoduo/ai/generation` 负责领域中立的可恢复操作状态机、密封信封/凭证校验端口，以及进度、制品和计算用量类型；图像/视频包负责严格声明和品牌化引用。
- `@duoduo/ai/protocols/dashscope-images` 和 `@duoduo/ai/protocols/dashscope-image-tasks` 负责 Qwen Wan 的直接和可恢复图像线协议；任务 ID 和操作路由必须在解析传输前完成校验。
- `@duoduo/ai/protocols/ark-images` 和 `@duoduo/ai/providers/doubao` 的图像绑定负责显式的 Seedream 模型 ID/端点 ID 直接生成；Ark 图像标识只能出现在请求体中，绝不能成为路由片段。
- `@duoduo/ai/protocols/openrouter-images` 负责 OpenRouter 有序多模态请求映射以及文本/图像响应归一化；应用消费者应使用 Provider 门面，而不是直接导入协议适配器。
- `@duoduo/ai/providers/openrouter` 负责显式的 OpenRouter 聊天和直接图像绑定，包括公共图像模型引用和目录描述符。
- `@duoduo/ai/auth/node` 暴露仅限 Node 的凭证持久化、密钥来源和本地作用域授权工厂。这些实现不得进入供应商中立模块。
- `@duoduo/ai/transport` 暴露传输协议和网络策略辅助函数，但不暴露测试驱动。
- `@duoduo/ai/transport/node` 暴露仅限 Node 的代理 fetch 和 WebSocket 连接器。
- `@duoduo/ai/session` 暴露供应商中立的会话句柄、租约和生命周期管理。
- `@duoduo/ai/protocols/openai-responses` 负责 OpenAI Responses 线协议解析和协议类型。
- `@duoduo/ai/protocols/azure-openai-responses` 将 Azure OpenAI Responses 绑定到共享 Responses 解析器，不得复制解析器。
- `@duoduo/ai/protocols/anthropic-messages` 负责 Anthropic Messages 请求映射、SSE 解析、重放签名、思考、工具和缓存用量。
- `@duoduo/ai/providers/openai` 负责显式 OpenAI Provider 工厂，绝不能隐式读取环境变量或凭证。
- `@duoduo/ai/providers/azure-openai-responses` 负责显式的 Azure 端点、部署、API 版本和环境解析。
- `@duoduo/ai/providers/anthropic` 负责显式 Anthropic Provider 工厂以及 API Key/OAuth 传输绑定。
- `@duoduo/ai/protocols/google-generative-ai` 和 `@duoduo/ai/providers/google` 负责 Gemini Developer API SSE 路径和显式 API Key 绑定。
- `@duoduo/ai/protocols/google-vertex` 和 `@duoduo/ai/providers/google-vertex` 负责 Vertex API Key/ADC 分支、项目/位置标识和共享 Google 线协议语义。
- `@duoduo/ai/protocols/bedrock-converse-stream` 和 `@duoduo/ai/providers/amazon-bedrock` 负责 Bedrock Converse Stream 映射、事件流解析、区域端点、Bearer 认证和 AWS 签名。
- `@duoduo/ai/protocols/openai-chat-completions` 负责 OpenAI Chat 请求映射、流式解析、重放元数据，以及针对思考、工具、缓存、路由和会话亲和性的类型化兼容配置。
- `@duoduo/ai/providers/*` 下兼容 OpenAI 的 Provider 子路径是共享兼容配置边界之上的轻量显式工厂；Provider 差异应作为描述符/配置数据添加，而不是通过 Provider 类型分支实现。
- `@duoduo/ai/auth/ambient/google-adc` 和 `@duoduo/ai/auth/ambient/aws` 暴露显式注入的环境能力；它们不得隐式读取 SDK 状态、配置文件、元数据服务或进程环境。
- `@duoduo/ai/auth/oauth/anthropic` 暴露显式 Anthropic OAuth 流程；供应商中立的 OAuth 端口继续从 `@duoduo/ai` 导出。
- `@duoduo/ai/protocols/openai-codex-responses` 和 `@duoduo/ai/protocols/mistral-conversations` 负责其余保留的 PI 文本协议配置、重放元数据和流归一化。
- `@duoduo/ai/protocols/dashscope` 和 `@duoduo/ai/providers/qwen` 负责经过整理的 DashScope 原生路由、区域/工作空间端点解析和显式 Qwen 协议偏好绑定。
- `@duoduo/ai/protocols/ark-responses` 和 `@duoduo/ai/providers/doubao` 负责 Ark v3 推理事件归一化、显式模型 ID/端点 ID 请求体绑定，以及北京 Ark 端点边界。
- `@duoduo/ai/providers/openai-codex` 和 `@duoduo/ai/providers/mistral` 暴露显式工厂。
- `@duoduo/ai/auth/oauth/openai-codex` 和 `@duoduo/ai/auth/oauth/xai` 暴露显式 OAuth 流程，支持中止感知轮询、保留刷新令牌以及可选的远程撤销。
- `@duoduo/ai/testing` 是 Faux、夹具传输和第三方聚合器协议辅助工具的唯一公共入口。聚合器远程目录只能发布模型事实；受信任代码必须负责端点、认证、协议、操作模式和兼容性配置，回退目标必须保留在同一个 Provider 实例内。生产导出不得包含这些测试辅助工具。

适配器只接收请求级、已完成绑定的 `RequestTransport`；它们不得选择或修改最终 URL 或受保护的认证请求头。Provider 专用线协议细节必须保留在供应商中立核心模块之外。

持久化认证必须通过显式的 `CredentialStore` 和 `CredentialScopeAuthority`。只有当凭证存储和作用域指纹都声明 `cross-runtime` 生命周期时，目录标识才可以持久化；进程本地或环境标识绝不能读取或写入持久化 `CatalogStore`。

会话标识必须独立于凭证材料包含已授权的作用域标识。替换凭证和退出登录必须立即隔离匹配的会话，而资源释放要等待活跃租约耗尽。未提供 `sessionId` 的请求只能使用请求本地资源和亲和性。

## 命令

从仓库根目录运行：

- `pnpm --filter @duoduo/ai test -- --run core stream testing`
- `pnpm --filter @duoduo/ai test -- --run transport openai-responses openai`
- `pnpm --filter @duoduo/ai test -- --run auth catalog runtime`
- `pnpm --filter @duoduo/ai test -- --run transport session azure-openai-responses`
- `pnpm --filter @duoduo/ai test -- --run anthropic-messages anthropic oauth`
- `pnpm --filter @duoduo/ai test -- --run google vertex bedrock ambient`
- `pnpm --filter @duoduo/ai test -- --run openai-chat-completions providers-compatible`
- `pnpm --filter @duoduo/ai test -- --run gateways minimax kimi openrouter`
- `pnpm --filter @duoduo/ai test -- --run protocols providers baseline-parity oauth`
- `pnpm --filter @duoduo/ai test -- --run dashscope qwen`
- `pnpm --filter @duoduo/ai test -- --run ark-responses doubao`
- `pnpm --filter @duoduo/ai test -- --run images openrouter-images`
- `pnpm --filter @duoduo/ai test -- --run generation images videos xai-imagine`
- `pnpm --filter @duoduo/ai test -- --run ark-video-tasks seedance videos`
- `pnpm --filter @duoduo/ai test -- --run kling-video-tasks kling videos`
- `pnpm --filter @duoduo/ai parity:check -- --pi-root vendor/pi`
- `pnpm --filter @duoduo/ai api:check`
- `pnpm --filter @duoduo/ai typecheck`
- `pnpm --filter @duoduo/ai build`
- `pnpm --filter @duoduo/ai manifest:check`
- `pnpm --filter @duoduo/ai lint`
- `pnpm --filter @duoduo/ai format:check`
- `pnpm --filter @duoduo/ai release:check`
- `pnpm --filter @duoduo/ai release:no-vendor`

测试必须离线且具备确定性。
可恢复生成引用归运行时所有，并且必须脱敏。只有跨运行时认证标识、作用域授权和注入的 `GenerationOperationCodec` 才能生成序列化操作令牌。恢复操作在领域/版本/TTL、作用域、凭证、Provider 配置、模型、配置或操作绑定不匹配时必须采用故障关闭策略；适配器绝不能接收凭证证明或密封令牌。

## 产品化边界

- `@duoduo/ai/providers` 暴露 Provider 工厂扩展类型，但不导入具体 Provider。
- `@duoduo/ai/providers/all` 是唯一显式启用全部内置 Provider 的入口。`builtinProviders()` 是异步函数，通过 `unconfigured` 报告缺失的必需非敏感配置，并且绝不能猜测区域、端点、账号 ID、部署或网关适配器。
- `@duoduo/ai/cli` 暴露 Node CLI 组装和可测试运行器。疑似敏感配置必须被拒绝；凭证持久化要求显式提供可用的主密钥，否则必须采用故障关闭策略。
- `scripts/catalog` 负责确定性的离线目录生成。远程分片只能包含安全的模型事实，不能控制端点、认证、协议、配置、操作或路由行为。
- `scripts/manifest` 约束生成的 39 Provider 目录、公共导出映射、源码/构建路径、CLI 二进制文件以及已通过的实现切片。
- `test/live/run.ts` 是唯一的在线测试入口。不得从常规测试、构建、安装钩子、源码入口或目录脚本导入它。它要求环境启用标志、Provider 允许列表、正数美元预算、显式 Provider/模型和 `--allow-paid`；媒体运行还要求数量/时长预算。
- 自托管生成 Provider 要求注入 `DuoduoGenerationGateway`。基础 URL 只代表标识/配置，绝不足以据此合成适配器。

其他包命令：

- `pnpm --filter @duoduo/ai catalog:update`
- `pnpm --filter @duoduo/ai catalog:update -- --check --offline`
- `pnpm --filter @duoduo/ai manifest:check`
- `pnpm --filter @duoduo/ai test:live -- --provider <kind> --model <id> --estimated-max-usd <usd> --allow-paid`

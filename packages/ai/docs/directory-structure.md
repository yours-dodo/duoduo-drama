# `@duoduo/ai` 源码目录与文件职责

本文面向第一次维护 `@duoduo/ai` 的工程师，覆盖 `src` 下当前全部源码、就近测试和生成数据。目标是让读者能够判断代码应该放在哪里，并快速找到每个文件的职责。

> 本文描述职责，不替代公共 API 定义。包外代码只能使用 `package.json` 声明的导出，不能深度导入 `src`。

## 分层关系

```text
应用
  → runtime：组装和协调
    → providers：绑定模型、端点、认证与协议
      → protocols：映射和解析供应商线协议
        → transport：执行受约束的请求级传输

core / images / videos / generation：供应商中立领域模型
auth / catalog / session / stream：横切运行时能力
cli：Node 命令行组装
testing：与生产入口隔离的测试支持
```

边界原则：

- 供应商中立目录不能依赖具体 Provider。
- `protocols` 实现线协议；`providers` 选择可信端点、认证和协议配置。
- 平台相关实现进入 `auth/node` 或 `transport/node`。
- `*.test.ts` 与实现就近放置，但不会被编译到 `dist`。
- `*.generated.json` 由脚本生成，不能手工修改。

## 文件索引

### `src/auth`

认证领域与凭证安全边界。定义通用端口，平台实现和供应商 OAuth 放在子目录。

| 文件                       | 作用                                                                   |
| -------------------------- | ---------------------------------------------------------------------- |
| `ambient.test.ts`          | 验证环境凭证解析与策略的正常、边界和失败路径。                         |
| `ambient.ts`               | 定义环境凭证来源与解析接口，并提供显式环境凭证解析器。                 |
| `api-key.ts`               | 定义请求级凭证覆盖、凭证绑定事实和认证方案识别。                       |
| `credential-store.test.ts` | 验证凭证存储并发与状态转换的正常、边界和失败路径。                     |
| `credential-store.ts`      | 定义凭证记录、修订、刷新租约、CAS 更新及 CredentialStore 持久化端口。  |
| `login.ts`                 | 定义登录交互、认证状态、登出结果和运行时认证 API。                     |
| `oauth.ts`                 | 定义供应商中立的 OAuth 流程、HTTP 传输、提示、事件、时钟和随机数端口。 |
| `override-policy.ts`       | 定义请求级凭证覆盖的允许与拒绝策略。                                   |
| `record-sealer.test.ts`    | 验证凭证记录密封、篡改和过期处理的正常、边界和失败路径。               |
| `record-sealer.ts`         | 实现凭证记录的密封与开启边界，校验持久化信封并隔离具体加密编解码器。   |
| `scope-authority.test.ts`  | 验证凭证作用域规范化与授权的正常、边界和失败路径。                     |
| `scope-authority.ts`       | 规范化凭证作用域并定义作用域授权、指纹验证与生命周期约束。             |
| `secret-value.test.ts`     | 验证秘密值包装与防泄漏的正常、边界和失败路径。                         |
| `secret-value.ts`          | 提供带品牌的秘密值包装，限制敏感字符串被普通代码或日志意外使用。       |

### `src/auth/ambient`

显式注入的云环境认证能力。

| 文件                 | 作用                                                                     |
| -------------------- | ------------------------------------------------------------------------ |
| `aws.test.ts`        | 验证Aws 行为的正常、边界和失败路径。                                     |
| `aws.ts`             | 将显式注入的 AWS 请求签名器绑定为环境认证，并解析 Bedrock 区域。         |
| `google-adc.test.ts` | 验证Google Adc 行为的正常、边界和失败路径。                              |
| `google-adc.ts`      | 将显式注入的 Google ADC 令牌提供器绑定为环境认证，并解析项目与位置配置。 |

### `src/auth/node`

依赖 Node.js 文件系统、加密或进程环境的认证实现。

| 文件                 | 作用                                                                  |
| -------------------- | --------------------------------------------------------------------- |
| `file-store.test.ts` | 验证文件凭证存储的正常、边界和失败路径。                              |
| `file-store.ts`      | 实现 Node 文件系统凭证存储，包括持久化、并发更新和密封记录接线。      |
| `index.ts`           | 导出仅限 Node.js 的认证实现。                                         |
| `key-source.ts`      | 从显式环境来源创建 AES-GCM 凭证编解码器，并提供 Node 环境读取适配器。 |
| `local-scope.ts`     | 实现本机作用域授权，生成和验证与本地状态绑定的作用域指纹。            |

### `src/auth/oauth/_shared`

不同 OAuth 流程复用的内部辅助代码。

| 文件      | 作用                                                                   |
| --------- | ---------------------------------------------------------------------- |
| `http.ts` | OAuth 流程共享的表单/JSON 请求、令牌响应解析、中止延迟和编码辅助函数。 |

### `src/auth/oauth/anthropic`

Anthropic OAuth 流程。

| 文件                      | 作用                                                        |
| ------------------------- | ----------------------------------------------------------- |
| `anthropic-oauth.test.ts` | 验证运行时 Anthropic OAuth 接线的正常、边界和失败路径。     |
| `index.ts`                | 实现 Anthropic OAuth 流程，处理授权、轮询、刷新和撤销能力。 |

### `src/auth/oauth/github-copilot`

GitHub Copilot 设备授权与端点边界。

| 文件                           | 作用                                                                        |
| ------------------------------ | --------------------------------------------------------------------------- |
| `endpoint.ts`                  | 校验并解析 GitHub Copilot OAuth/网关来源，防止发现结果越出受信任 DNS 边界。 |
| `github-copilot-oauth.test.ts` | 验证GitHub Copilot OAuth的正常、边界和失败路径。                            |
| `index.ts`                     | 实现 GitHub Copilot OAuth 流程，处理授权、轮询、刷新和撤销能力。            |

### `src/auth/oauth`

供应商 OAuth 流程。

| 文件                     | 作用                                                    |
| ------------------------ | ------------------------------------------------------- |
| `oauth-baseline.test.ts` | 验证各 OAuth 实现的共同安全基线的正常、边界和失败路径。 |

### `src/auth/oauth/openai-codex`

OpenAI Codex OAuth 流程。

| 文件       | 作用                                                           |
| ---------- | -------------------------------------------------------------- |
| `index.ts` | 实现 OpenAI Codex OAuth 流程，处理授权、轮询、刷新和撤销能力。 |

### `src/auth/oauth/xai`

xAI OAuth 流程。

| 文件       | 作用                                                  |
| ---------- | ----------------------------------------------------- |
| `index.ts` | 实现 xAI OAuth 流程，处理授权、轮询、刷新和撤销能力。 |

### `src/catalog`

模型目录缓存、刷新和一致性。

| 文件                       | 作用                                                         |
| -------------------------- | ------------------------------------------------------------ |
| `cache-key.ts`             | 规范化模型目录缓存键，绑定 Provider、作用域和凭证身份。      |
| `catalog-store.test.ts`    | 验证目录存储提交语义的正常、边界和失败路径。                 |
| `catalog-store.ts`         | 定义缓存目录、刷新票据、提交结果和 CatalogStore 持久化端口。 |
| `channel-identity.test.ts` | 验证聊天、图像和视频目录身份隔离的正常、边界和失败路径。     |
| `manifest.ts`              | 对规范化目录载荷计算稳定摘要。                               |
| `refresh-ticket.ts`        | 比较目录刷新票据，避免较旧刷新结果覆盖新状态。               |

### `src/cli`

Node CLI 的命令执行、平台组装和安全策略。

| 文件                        | 作用                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `bin.ts`                    | Node CLI 可执行入口；组装依赖、运行命令并设置进程退出码。                          |
| `catalog-generator.test.ts` | 验证目录生成的确定性与安全字段的正常、边界和失败路径。                             |
| `cli.test.ts`               | 验证CLI 端到端命令行为的正常、边界和失败路径。                                     |
| `exports.test.ts`           | 验证CLI 公共导出的正常、边界和失败路径。                                           |
| `file-catalog-store.ts`     | 实现 CLI 使用的本地文件目录缓存。                                                  |
| `index.ts`                  | CLI 公共子路径入口，导出可嵌入的运行器、Node 组装和在线策略 API。                  |
| `live-policy.test.ts`       | 验证在线执行预算和许可门槛的正常、边界和失败路径。                                 |
| `live-policy.ts`            | 根据能力类型、预算、数量和显式许可评估在线执行是否允许。                           |
| `node.test.ts`              | 验证Node CLI 依赖组装的正常、边界和失败路径。                                      |
| `node.ts`                   | 解析 CLI 本地路径、主密钥来源和 Provider 配置，并组装 Node CLI 依赖。              |
| `runner.test.ts`            | 验证CLI 参数、退出码和脱敏的正常、边界和失败路径。                                 |
| `runner.ts`                 | 解析并执行 providers、models、auth、diagnose 等命令，统一退出码、JSON 输出和脱敏。 |

### `src/core`

供应商中立的聊天领域类型和纯逻辑。

| 文件               | 作用                                                             |
| ------------------ | ---------------------------------------------------------------- |
| `content.ts`       | 定义文本、推理、图像、工具调用和 JSON 等标准内容块。             |
| `context.ts`       | 校验对话上下文，提取工具名，并把响应转换为可继续对话的助手消息。 |
| `errors.ts`        | 定义统一错误分类、运行时错误类和上下文溢出判断。                 |
| `events.ts`        | 定义聊天请求、标准流事件、协议终态、诊断信息和完整助手响应。     |
| `finish-reason.ts` | 归类完成原因、映射响应状态并判断错误是否可取消。                 |
| `messages.ts`      | 定义用户、助手、工具结果消息、工具定义、对话上下文和完成状态。   |
| `models.ts`        | 定义 Provider/模型身份、能力、限制、价格、默认请求项和目录快照。 |
| `tools.test.ts`    | 验证工具参数解析与 Schema 校验的正常、边界和失败路径。           |
| `tools.ts`         | 解析工具参数并按 JSON Schema 的受支持子集校验工具调用。          |
| `usage.test.ts`    | 验证Token 用量、成本和估算的正常、边界和失败路径。               |
| `usage.ts`         | 定义 Token 用量和成本，并提供成本计算与上下文 Token 粗估。       |

### `src/generation`

图像与视频共用的可恢复操作、安全信封和进度模型。

| 文件                   | 作用                                                               |
| ---------------------- | ------------------------------------------------------------------ |
| `artifact.ts`          | 定义生成制品来源、制品元数据和计算资源用量。                       |
| `credential-proof.ts`  | 创建和验证操作凭证证明，使恢复任务绑定到正确凭证而不暴露凭证材料。 |
| `generation.test.ts`   | 验证可恢复生成状态机、信封和安全校验的正常、边界和失败路径。       |
| `index.ts`             | 可恢复生成公共入口，汇总状态机、操作编解码、认证、进度和制品类型。 |
| `operation-auth.ts`    | 定义序列化生成操作所需的认证与作用域声明。                         |
| `operation-codec.ts`   | 定义操作信封和编解码端口，并校验版本、领域、TTL 与令牌形状。       |
| `operation-machine.ts` | 实现可恢复生成操作状态机，仲裁终态、取消和并发事件。               |
| `progress.ts`          | 定义生成领域、阶段和进度，并校验进度值的一致性。                   |

### `src/images`

供应商中立的图像生成领域与运行时。

| 文件                        | 作用                                                                 |
| --------------------------- | -------------------------------------------------------------------- |
| `contracts.ts`              | 定义图像协议声明、兼容配置、请求、事件接收器和协议终态契约。         |
| `cost.ts`                   | 定义图像用量与成本，并按模型价格计算费用。                           |
| `images.test.ts`            | 验证图像模型、输入、流与运行时的正常、边界和失败路径。               |
| `index.ts`                  | 图像公共子路径入口，汇总模型、输入输出、流、运行时和可恢复操作 API。 |
| `input.ts`                  | 定义文本/图像提示词部件，提供输入构造器并解析默认参数。              |
| `models.ts`                 | 定义图像模型引用、尺寸、能力、限制、价格、句柄和筛选条件。           |
| `operation-claims.ts`       | 创建、检查、序列化和解析图像操作引用，并为协议配置生成指纹。         |
| `operation-projector.ts`    | 将图像协议事件投射为供应商中立的生成流事件。                         |
| `operation-runtime.test.ts` | 验证图像恢复、取消及操作引用校验的正常、边界和失败路径。             |
| `output.ts`                 | 定义单张生成图像、批量输出和直接/可恢复生成结果。                    |
| `runtime.ts`                | 组装 Images API，负责模型解析、生成、恢复、取消及操作安全校验。      |
| `stream.ts`                 | 定义图像生成事件流及只允许直接生成的窄化流类型。                     |

### `src` 根目录

源码公共入口。根入口只暴露供应商中立能力；测试入口单独隔离测试工具。

| 文件         | 作用                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------- |
| `index.ts`   | 包根入口；汇总供应商中立的认证、目录、核心模型、运行时、会话和重试公共 API，不注册具体 Provider。 |
| `testing.ts` | 测试公共入口；集中导出 Faux Provider、夹具驱动、断言、内存存储和聚合器契约。                      |

### `src/protocols/anthropic-messages`

Anthropic Messages 线协议的请求映射、响应解析与离线契约测试。

| 文件                         | 作用                                                          |
| ---------------------------- | ------------------------------------------------------------- |
| `adapter.ts`                 | 实现 Anthropic Messages 请求映射、响应/流解析和统一协议契约。 |
| `anthropic-errors.test.ts`   | 验证Anthropic Errors 行为的正常、边界和失败路径。             |
| `anthropic-messages.test.ts` | 验证Anthropic Messages 行为的正常、边界和失败路径。           |
| `anthropic-profile.test.ts`  | 验证Anthropic Profile 行为的正常、边界和失败路径。            |
| `index.ts`                   | Anthropic Messages 协议公共入口，导出适配器、配置和协议类型。 |
| `sse.ts`                     | 解析 Anthropic Messages 的 SSE 事件并处理协议特有边界。       |

### `src/protocols/ark-images`

Ark Images 线协议的请求映射、响应解析与离线契约测试。

| 文件                 | 作用                                                  |
| -------------------- | ----------------------------------------------------- |
| `adapter.ts`         | 实现 Ark Images 请求映射、响应/流解析和统一协议契约。 |
| `ark-images.test.ts` | 验证Ark Images 行为的正常、边界和失败路径。           |
| `index.ts`           | Ark Images 协议公共入口，导出适配器、配置和协议类型。 |

### `src/protocols/ark-responses`

Ark Responses 线协议的请求映射、响应解析与离线契约测试。

| 文件                    | 作用                                                     |
| ----------------------- | -------------------------------------------------------- |
| `adapter.ts`            | 实现 Ark Responses 请求映射、响应/流解析和统一协议契约。 |
| `ark-responses.test.ts` | 验证Ark Responses 行为的正常、边界和失败路径。           |
| `index.ts`              | Ark Responses 协议公共入口，导出适配器、配置和协议类型。 |

### `src/protocols/ark-video-tasks`

Ark Video Tasks 线协议的请求映射、响应解析与离线契约测试。

| 文件                      | 作用                                                       |
| ------------------------- | ---------------------------------------------------------- |
| `adapter.ts`              | 实现 Ark Video Tasks 请求映射、响应/流解析和统一协议契约。 |
| `ark-video-tasks.test.ts` | 验证Ark Video Tasks 行为的正常、边界和失败路径。           |
| `index.ts`                | Ark Video Tasks 协议公共入口，导出适配器、配置和协议类型。 |

### `src/protocols/azure-openai-responses`

Azure OpenAI Responses 线协议的请求映射、响应解析与离线契约测试。

| 文件         | 作用                                                              |
| ------------ | ----------------------------------------------------------------- |
| `adapter.ts` | 实现 Azure OpenAI Responses 请求映射、响应/流解析和统一协议契约。 |
| `index.ts`   | Azure OpenAI Responses 协议公共入口，导出适配器、配置和协议类型。 |

### `src/protocols/bedrock-converse-stream`

Bedrock Converse Stream 线协议的请求映射、响应解析与离线契约测试。

| 文件                              | 作用                                                               |
| --------------------------------- | ------------------------------------------------------------------ |
| `adapter.ts`                      | 实现 Bedrock Converse Stream 请求映射、响应/流解析和统一协议契约。 |
| `bedrock-converse-stream.test.ts` | 验证Bedrock Converse Stream 行为的正常、边界和失败路径。           |
| `eventstream.test.ts`             | 验证Eventstream 行为的正常、边界和失败路径。                       |
| `eventstream.ts`                  | 解析 AWS EventStream 二进制帧并提取 Bedrock 流事件。               |
| `index.ts`                        | Bedrock Converse Stream 协议公共入口，导出适配器、配置和协议类型。 |

### `src/protocols/dashscope-image-tasks`

Dashscope Image Tasks 线协议的请求映射、响应解析与离线契约测试。

| 文件                            | 作用                                                             |
| ------------------------------- | ---------------------------------------------------------------- |
| `adapter.ts`                    | 实现 Dashscope Image Tasks 请求映射、响应/流解析和统一协议契约。 |
| `dashscope-image-tasks.test.ts` | 验证Dashscope Image Tasks 行为的正常、边界和失败路径。           |
| `index.ts`                      | Dashscope Image Tasks 协议公共入口，导出适配器、配置和协议类型。 |

### `src/protocols/dashscope-images`

Dashscope Images 线协议的请求映射、响应解析与离线契约测试。

| 文件                       | 作用                                                        |
| -------------------------- | ----------------------------------------------------------- |
| `adapter.ts`               | 实现 Dashscope Images 请求映射、响应/流解析和统一协议契约。 |
| `dashscope-images.test.ts` | 验证Dashscope Images 行为的正常、边界和失败路径。           |
| `index.ts`                 | Dashscope Images 协议公共入口，导出适配器、配置和协议类型。 |

### `src/protocols/dashscope`

Dashscope 线协议的请求映射、响应解析与离线契约测试。

| 文件                | 作用                                                 |
| ------------------- | ---------------------------------------------------- |
| `adapter.ts`        | 实现 Dashscope 请求映射、响应/流解析和统一协议契约。 |
| `dashscope.test.ts` | 验证Dashscope 行为的正常、边界和失败路径。           |
| `index.ts`          | Dashscope 协议公共入口，导出适配器、配置和协议类型。 |

### `src/protocols/duoduo-generation-v1`

Duoduo Generation V1 线协议的请求映射、响应解析与离线契约测试。

| 文件                             | 作用                                                            |
| -------------------------------- | --------------------------------------------------------------- |
| `adapter.ts`                     | 实现 Duoduo Generation V1 请求映射、响应/流解析和统一协议契约。 |
| `contracts.ts`                   | 定义项目自有 Generation Gateway 的目录、任务和注入网关接口。    |
| `index.ts`                       | Duoduo Generation V1 协议公共入口，导出适配器、配置和协议类型。 |
| `self-hosted-generation.test.ts` | 验证自托管生成 行为的正常、边界和失败路径。                     |

### `src/protocols/google-generative-ai`

Google Generative Ai 线协议的请求映射、响应解析与离线契约测试。

| 文件                           | 作用                                                               |
| ------------------------------ | ------------------------------------------------------------------ |
| `adapter.ts`                   | 实现 Google Generative Ai 请求映射、响应/流解析和统一协议契约。    |
| `google-generative-ai.test.ts` | 验证Google Generative Ai 行为的正常、边界和失败路径。              |
| `google-shared.ts`             | 共享 Gemini Developer API 与 Vertex 的请求体映射和流式事件归一化。 |
| `index.ts`                     | Google Generative Ai 协议公共入口，导出适配器、配置和协议类型。    |

### `src/protocols/google-vertex`

Google Vertex 线协议的请求映射、响应解析与离线契约测试。

| 文件                    | 作用                                                     |
| ----------------------- | -------------------------------------------------------- |
| `adapter.ts`            | 实现 Google Vertex 请求映射、响应/流解析和统一协议契约。 |
| `google-vertex.test.ts` | 验证Google Vertex 行为的正常、边界和失败路径。           |
| `index.ts`              | Google Vertex 协议公共入口，导出适配器、配置和协议类型。 |

### `src/protocols/kling-video-tasks`

Kling Video Tasks 线协议的请求映射、响应解析与离线契约测试。

| 文件                        | 作用                                                         |
| --------------------------- | ------------------------------------------------------------ |
| `adapter.ts`                | 实现 Kling Video Tasks 请求映射、响应/流解析和统一协议契约。 |
| `index.ts`                  | Kling Video Tasks 协议公共入口，导出适配器、配置和协议类型。 |
| `kling-video-tasks.test.ts` | 验证Kling Video Tasks 行为的正常、边界和失败路径。           |

### `src/protocols/mistral-conversations`

Mistral Conversations 线协议的请求映射、响应解析与离线契约测试。

| 文件                            | 作用                                                             |
| ------------------------------- | ---------------------------------------------------------------- |
| `index.ts`                      | Mistral Conversations 协议公共入口，导出适配器、配置和协议类型。 |
| `mistral-conversations.test.ts` | 验证Mistral Conversations 行为的正常、边界和失败路径。           |

### `src/protocols/openai-chat-completions`

Openai Chat Completions 线协议的请求映射、响应解析与离线契约测试。

| 文件                              | 作用                                                               |
| --------------------------------- | ------------------------------------------------------------------ |
| `adapter.ts`                      | 实现 Openai Chat Completions 请求映射、响应/流解析和统一协议契约。 |
| `index.ts`                        | Openai Chat Completions 协议公共入口，导出适配器、配置和协议类型。 |
| `openai-chat-completions.test.ts` | 验证Openai Chat Completions 行为的正常、边界和失败路径。           |

### `src/protocols/openai-codex-responses`

Openai Codex Responses 线协议的请求映射、响应解析与离线契约测试。

| 文件                             | 作用                                                              |
| -------------------------------- | ----------------------------------------------------------------- |
| `index.ts`                       | Openai Codex Responses 协议公共入口，导出适配器、配置和协议类型。 |
| `openai-codex-responses.test.ts` | 验证Openai Codex Responses 行为的正常、边界和失败路径。           |

### `src/protocols/openai-responses`

Openai Responses 线协议的请求映射、响应解析与离线契约测试。

| 文件                       | 作用                                                        |
| -------------------------- | ----------------------------------------------------------- |
| `adapter.ts`               | 实现 Openai Responses 请求映射、响应/流解析和统一协议契约。 |
| `index.ts`                 | Openai Responses 协议公共入口，导出适配器、配置和协议类型。 |
| `openai-responses.test.ts` | 验证Openai Responses 行为的正常、边界和失败路径。           |
| `sse.ts`                   | 解析 Openai Responses 的 SSE 事件并处理协议特有边界。       |

### `src/protocols/openrouter-images`

Openrouter Images 线协议的请求映射、响应解析与离线契约测试。

| 文件                        | 作用                                                         |
| --------------------------- | ------------------------------------------------------------ |
| `adapter.ts`                | 实现 Openrouter Images 请求映射、响应/流解析和统一协议契约。 |
| `index.ts`                  | Openrouter Images 协议公共入口，导出适配器、配置和协议类型。 |
| `openrouter-images.test.ts` | 验证Openrouter Images 行为的正常、边界和失败路径。           |

### `src/protocols/xai-images`

Xai Images 线协议的请求映射、响应解析与离线契约测试。

| 文件                         | 作用                                                  |
| ---------------------------- | ----------------------------------------------------- |
| `adapter.ts`                 | 实现 Xai Images 请求映射、响应/流解析和统一协议契约。 |
| `index.ts`                   | Xai Images 协议公共入口，导出适配器、配置和协议类型。 |
| `xai-imagine-images.test.ts` | 验证Xai Imagine Images 行为的正常、边界和失败路径。   |

### `src/protocols/xai-videos`

Xai Videos 线协议的请求映射、响应解析与离线契约测试。

| 文件                         | 作用                                                  |
| ---------------------------- | ----------------------------------------------------- |
| `adapter.ts`                 | 实现 Xai Videos 请求映射、响应/流解析和统一协议契约。 |
| `index.ts`                   | Xai Videos 协议公共入口，导出适配器、配置和协议类型。 |
| `xai-imagine-videos.test.ts` | 验证Xai Imagine Videos 行为的正常、边界和失败路径。   |

### `src/providers/_generated`

由脚本生成的目录与上游对齐事实，不手工修改。

| 文件                             | 作用                                                |
| -------------------------------- | --------------------------------------------------- |
| `builtin-catalog.generated.json` | 生成的内置 Provider 模型目录；由 catalog 脚本更新。 |
| `pi-parity.generated.json`       | 生成的 PI 上游能力对齐快照；由 parity 脚本更新。    |

### `src/providers/_shared`

多个 Provider 复用的内部工厂。

| 文件                   | 作用                                                                             |
| ---------------------- | -------------------------------------------------------------------------------- |
| `multi-protocol.ts`    | 用描述符驱动支持多种聊天协议的网关 Provider，集中选择受信任协议配置。            |
| `openai-compatible.ts` | 用描述符驱动 OpenAI Chat Completions 兼容 Provider，集中处理共有工厂与模型引用。 |

### `src/providers/all`

显式加载全部内置 Provider 的唯一入口。

| 文件       | 作用                                                             |
| ---------- | ---------------------------------------------------------------- |
| `index.ts` | 定义内置 Provider 清单、配置映射和异步 builtinProviders() 组装。 |

### `src/providers/amazon-bedrock`

Amazon Bedrock Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/ant-ling`

蚂蚁 Ling Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/anthropic`

Anthropic Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/azure-openai-responses`

Azure OpenAI Responses Provider 的模型、端点、认证和协议绑定。

| 文件            | 作用                                                           |
| --------------- | -------------------------------------------------------------- |
| `index.test.ts` | 验证 Azure 资源名/基础 URL、部署映射、API 版本和显式凭证配置。 |
| `index.ts`      | 该 Provider 的公共入口。                                       |

### `src/providers`

将模型目录、端点、认证和协议绑定成具体 Provider。

| 文件                           | 作用                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `baseline-parity.test.ts`      | 验证内置 Provider 与基准能力快照保持一致。                                                 |
| `index.ts`                     | Provider 扩展公共入口；声明工厂配置映射和内置 Provider 工厂描述符，但不导入具体 Provider。 |
| `providers-compatible.test.ts` | 验证 OpenAI 兼容 Provider 的描述符、模型引用、端点、认证和兼容配置。                       |
| `providers-gateways.test.ts`   | 验证多协议网关 Provider 的协议选择、回退、目录安全和通道隔离。                             |

### `src/providers/cerebras`

Cerebras Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/cloudflare-ai-gateway`

Cloudflare AI Gateway Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/cloudflare-workers-ai`

Cloudflare Workers AI Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/deepseek`

Deepseek Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/doubao`

Doubao Provider 的模型、端点、认证和协议绑定。

| 文件             | 作用                                                           |
| ---------------- | -------------------------------------------------------------- |
| `catalog.ts`     | 构建 Doubao 的受信任模型目录并合并显式附加模型。               |
| `doubao.test.ts` | 验证Doubao 行为的正常、边界和失败路径。                        |
| `endpoints.ts`   | 解析 Doubao 的区域、基础端点和安全请求路径。                   |
| `images.ts`      | 绑定 Doubao 图像模型、图像协议和图像模型引用。                 |
| `index.ts`       | 该 Provider 的公共入口，汇总分拆的目录、端点、协议和媒体绑定。 |
| `manifest.ts`    | 声明 Doubao 支持的协议、认证和聊天/媒体能力清单。              |
| `profiles.ts`    | 定义 Doubao 模型到协议/兼容配置的受信任映射。                  |
| `provider.ts`    | 组装 Doubao Provider 工厂、模型引用、认证和各能力绑定。        |
| `videos.ts`      | 绑定 Doubao 视频模型、任务协议和视频模型引用。                 |

### `src/providers/fireworks`

Fireworks Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/github-copilot`

GitHub Copilot Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/google-vertex`

Google Vertex Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/google`

Google Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/groq`

Groq Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/huggingface`

Huggingface Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/kimi-coding`

Kimi Coding Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/kling`

Kling Provider 的模型、端点、认证和协议绑定。

| 文件            | 作用                                                           |
| --------------- | -------------------------------------------------------------- |
| `auth.ts`       | 创建 Kling 请求凭证并计算认证策略指纹。                        |
| `catalog.ts`    | 构建 Kling 的受信任模型目录并合并显式附加模型。                |
| `endpoints.ts`  | 解析 Kling 的区域、基础端点和安全请求路径。                    |
| `index.ts`      | 该 Provider 的公共入口，汇总分拆的目录、端点、协议和媒体绑定。 |
| `kling.test.ts` | 验证Kling 行为的正常、边界和失败路径。                         |
| `manifest.ts`   | 声明 Kling 支持的协议、认证和聊天/媒体能力清单。               |
| `profiles.ts`   | 定义 Kling 模型到协议/兼容配置的受信任映射。                   |
| `provider.ts`   | 组装 Kling Provider 工厂、模型引用、认证和各能力绑定。         |

### `src/providers/minimax-cn`

MiniMax 中国区 Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/minimax`

Minimax Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/mistral`

Mistral Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/moonshotai-cn`

Moonshot AI 中国区 Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/moonshotai`

Moonshot AI Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/nvidia`

Nvidia Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/openai-codex`

OpenAI Codex Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/openai`

Openai Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/opencode-go`

OpenCode Go Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/opencode`

OpenCode Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/openrouter`

OpenRouter Provider 的模型、端点、认证和协议绑定。

| 文件        | 作用                                               |
| ----------- | -------------------------------------------------- |
| `images.ts` | 绑定 OpenRouter 图像模型、图像协议和图像模型引用。 |
| `index.ts`  | 该 Provider 的公共入口。                           |

### `src/providers/qwen`

Qwen Provider 的模型、端点、认证和协议绑定。

| 文件           | 作用                                                           |
| -------------- | -------------------------------------------------------------- |
| `catalog.ts`   | 构建 Qwen 的受信任模型目录并合并显式附加模型。                 |
| `endpoints.ts` | 解析 Qwen 的区域、基础端点和安全请求路径。                     |
| `images.ts`    | 绑定 Qwen 图像模型、图像协议和图像模型引用。                   |
| `index.ts`     | 该 Provider 的公共入口，汇总分拆的目录、端点、协议和媒体绑定。 |
| `manifest.ts`  | 声明 Qwen 支持的协议、认证和聊天/媒体能力清单。                |
| `profiles.ts`  | 定义 Qwen 模型到协议/兼容配置的受信任映射。                    |
| `provider.ts`  | 组装 Qwen Provider 工厂、模型引用、认证和各能力绑定。          |
| `qwen.test.ts` | 验证Qwen 行为的正常、边界和失败路径。                          |

### `src/providers/self-hosted-generation`

自托管生成 Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/together`

Together Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/vercel-ai-gateway`

Vercel AI Gateway Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/xai`

xAI Provider 的模型、端点、认证和协议绑定。

| 文件        | 作用                                        |
| ----------- | ------------------------------------------- |
| `images.ts` | 绑定 xAI 图像模型、图像协议和图像模型引用。 |
| `index.ts`  | 该 Provider 的公共入口。                    |
| `videos.ts` | 绑定 xAI 视频模型、任务协议和视频模型引用。 |

### `src/providers/xiaomi-token-plan-ams`

Xiaomi Token Plan AMS Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/xiaomi-token-plan-cn`

Xiaomi Token Plan CN Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/xiaomi-token-plan-sgp`

Xiaomi Token Plan SGP Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/xiaomi`

Xiaomi Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/zai-coding-cn`

Z.AI Coding 中国区 Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/providers/zai`

Z.AI Provider 的模型、端点、认证和协议绑定。

| 文件       | 作用                     |
| ---------- | ------------------------ |
| `index.ts` | 该 Provider 的公共入口。 |

### `src/runtime`

Provider 注册、认证、目录、会话与各通道 API 的组装协调。

| 文件                          | 作用                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| `ambient-provider.test.ts`    | 验证运行时环境认证接线的正常、边界和失败路径。                                            |
| `anthropic-oauth.test.ts`     | 验证运行时 Anthropic OAuth 接线的正常、边界和失败路径。                                   |
| `auth-catalog.test.ts`        | 验证认证身份与目录缓存联动的正常、边界和失败路径。                                        |
| `auth-coordinator.ts`         | 协调 Provider 认证描述、存储凭证、环境认证和请求覆盖，生成最终认证绑定。                  |
| `catalog-coordinator.test.ts` | 验证目录刷新并发与缓存协调的正常、边界和失败路径。                                        |
| `catalog-coordinator.ts`      | 协调静态目录、远程刷新、缓存、凭证身份和并发刷新结果。                                    |
| `create-ai.test.ts`           | 验证AiRuntime 组装和公共 API的正常、边界和失败路径。                                      |
| `create-ai.ts`                | 组装 AiRuntime 及 models、inventory、sessions、images、videos API，是 createAi() 的实现。 |
| `registry.ts`                 | 定义 Provider、协议清单、聊天传输绑定及 ProviderRegistry 注册表。                         |
| `transport-session.test.ts`   | 验证传输资源与会话租约联动的正常、边界和失败路径。                                        |

### `src/session`

会话资源、租约、隔离和生命周期。

| 文件              | 作用                                                 |
| ----------------- | ---------------------------------------------------- |
| `index.ts`        | 会话公共子路径入口。                                 |
| `lease.ts`        | 定义会话身份、句柄、资源、租约和清理选择器。         |
| `manager.test.ts` | 验证会话租约、失效与资源清理的正常、边界和失败路径。 |
| `manager.ts`      | 实现会话资源缓存、租约计数、失效隔离和延迟清理。     |

### `src/stream`

通用异步事件流、背压和响应聚合。

| 文件                      | 作用                                                               |
| ------------------------- | ------------------------------------------------------------------ |
| `attempt-sink.ts`         | 把单次协议尝试的事件隔离后转发到最终流，防止失败重试泄漏部分结果。 |
| `bounded-queue.test.ts`   | 验证有界队列背压与关闭的正常、边界和失败路径。                     |
| `bounded-queue.ts`        | 实现带容量限制、背压和关闭语义的观察者队列。                       |
| `event-stream.ts`         | 实现通用异步事件流。                                               |
| `response-stream.test.ts` | 验证响应流事件、终态与取消的正常、边界和失败路径。                 |
| `response-stream.ts`      | 实现聊天响应流，聚合事件、终态、取消和最终响应。                   |

### `src/testing`

通过 @duoduo/ai/testing 暴露的测试支持。

| 文件                          | 作用                                                             |
| ----------------------------- | ---------------------------------------------------------------- |
| `aggregator-provider.test.ts` | 验证聚合 Provider 安全目录和回退的正常、边界和失败路径。         |
| `aggregator-provider.ts`      | 构造测试用多协议聚合 Provider，并校验远程目录事实与回退配置。    |
| `assertions.ts`               | 收集响应流并提供事件顺序、唯一终态和响应开始断言。               |
| `fake-clock.ts`               | 提供可控的测试时钟。                                             |
| `fake-generation-gateway.ts`  | 提供内存中的自托管生成网关假实现。                               |
| `faux.test.ts`                | 验证脚本化 Faux Provider的正常、边界和失败路径。                 |
| `faux.ts`                     | 实现脚本化 Faux Provider，可记录调用并生成文本、工具或失败响应。 |
| `memory-stores.ts`            | 提供内存 CredentialStore 和 CatalogStore。                       |
| `types.ts`                    | 定义基于夹具传输的测试 Provider 类型。                           |

### `src/testing/contracts`

聚合 Provider 的跨通道测试契约。

| 文件                   | 作用                                                       |
| ---------------------- | ---------------------------------------------------------- |
| `capability-map.ts`    | 校验聚合器能力到模型的映射并查询某能力的模型集合。         |
| `channel-isolation.ts` | 生成聊天/图像/视频通道身份并断言目录、模型与操作身份隔离。 |

### `src/transport`

请求级传输、网络策略、重试和协议无关网络能力。

| 文件                        | 作用                                                                          |
| --------------------------- | ----------------------------------------------------------------------------- |
| `dispatcher.test.ts`        | 验证传输重试、幂等和失败阶段的正常、边界和失败路径。                          |
| `dispatcher.ts`             | 执行带重试的传输调度，处理幂等键、失败阶段和重试安全性。                      |
| `fixture-driver.ts`         | 实现离线夹具传输驱动，匹配预期请求并返回预设响应。                            |
| `index.ts`                  | 传输公共子路径入口，导出请求传输、策略、重试、SSE、WebSocket 和资源加载能力。 |
| `network-policy.ts`         | 创建基于来源允许列表的网络策略。                                              |
| `request-transport.test.ts` | 验证最终目标绑定与认证头保护的正常、边界和失败路径。                          |
| `request-transport.ts`      | 绑定最终目标和认证器，保护认证头并生成只能请求既定 URL 的 RequestTransport。  |
| `resource-loader.test.ts`   | 验证受限资源加载的正常、边界和失败路径。                                      |
| `resource-loader.ts`        | 通过受控传输加载远程资源，并执行大小、类型和网络限制。                        |
| `retry.ts`                  | 解析 Retry-After，计算退避时间并校验重试策略。                                |
| `sse.ts`                    | 定义标准 Server-Sent Event 数据结构。                                         |
| `types.ts`                  | 定义传输请求、响应、限制、驱动和网络策略的底层接口。                          |
| `websocket.ts`              | 在授权与网络策略约束下建立 WebSocket 连接。                                   |

### `src/transport/node`

Node.js 专用网络连接器。

| 文件                     | 作用                                                          |
| ------------------------ | ------------------------------------------------------------- |
| `index.ts`               | 导出仅限 Node.js 的代理 fetch 与 WebSocket 连接器。           |
| `node-transport.test.ts` | 验证Node 代理 fetch 与 WebSocket 适配的正常、边界和失败路径。 |
| `proxy-fetch.ts`         | 基于显式代理配置创建 Node fetch 传输驱动。                    |
| `websocket.ts`           | 适配 Node WebSocket 构造器为统一连接器。                      |

### `src/videos`

供应商中立的视频生成领域与运行时。

| 文件                     | 作用                                                                 |
| ------------------------ | -------------------------------------------------------------------- |
| `contracts.ts`           | 定义视频协议声明、兼容配置、请求、事件接收器和协议终态契约。         |
| `cost.ts`                | 定义视频用量与成本，并按时长和模型价格计算费用。                     |
| `index.ts`               | 视频公共子路径入口，汇总模型、输入输出、流、运行时和可恢复操作 API。 |
| `input.ts`               | 定义文本、图像、视频、音频等视频提示资源，并解析统一输入。           |
| `models.ts`              | 定义视频操作类型、分辨率、能力、限制、价格、句柄和筛选条件。         |
| `operation-claims.ts`    | 创建、检查、序列化和解析视频操作引用，并为协议配置生成指纹。         |
| `operation-projector.ts` | 将视频协议事件投射为供应商中立的生成流事件。                         |
| `output.ts`              | 定义生成视频、视频输出和直接/可恢复生成结果。                        |
| `runtime.ts`             | 组装 Videos API，负责模型解析、生成、恢复、取消及操作安全校验。      |
| `stream.ts`              | 定义视频生成事件流及只允许直接生成的窄化流类型。                     |
| `videos.test.ts`         | 验证视频模型、输入、流与恢复操作的正常、边界和失败路径。             |

## 如何选择代码落点

| 需求                                     | 首选目录                                    |
| ---------------------------------------- | ------------------------------------------- |
| 跨供应商通用的消息、模型、工具或错误概念 | `core`                                      |
| 通用图像或视频输入、输出、模型和流       | `images` 或 `videos`                        |
| 可恢复生成的通用状态、令牌或安全约束     | `generation`                                |
| 新的 HTTP、SSE、二进制流或异步任务协议   | `protocols/<protocol>`                      |
| 新供应商、区域产品或网关绑定             | `providers/<kind>`                          |
| OAuth、云环境认证或本地凭证存储          | `auth/oauth`、`auth/ambient` 或 `auth/node` |
| 请求调度、重试、网络策略或平台连接器     | `transport` 或 `transport/node`             |
| Provider 注册、认证/目录协调或 API 组装  | `runtime`                                   |
| 包消费者可复用的假实现和断言             | `testing`，并经 `src/testing.ts` 导出       |

新增文件后，应同步检查公共入口、`package.json` 导出、消费者编译测试以及 Provider 目录/清单生成结果。

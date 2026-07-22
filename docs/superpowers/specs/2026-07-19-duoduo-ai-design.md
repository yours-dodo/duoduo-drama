# Duoduo AI 单包模块化设计

> 后续决策（2026-07-22）：Radius Provider、Radius OAuth 和 PI Messages 私有协议因无产品消费者而按 YAGNI 原则从当前发布面移除。本文中的相关章节仅保留为初始设计历史，不再是当前产品合同；当前事实以 `packages/ai/package.json`、生成目录和 `packages/ai/IMPLEMENTATION-STATUS.md` 为准。

## 文档状态、读者与使用方式

| 项目         | 当前结论                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| 状态         | 设计基线 v2；可以按本文进入实现，但 `packages/ai` 尚未创建，八个实现 gate 当前均未完成                                |
| 权威范围     | 本文是 `@duoduo/ai` 的范围、架构、公共合同、安全边界与验收要求的唯一权威；项目级业务规划仍以根 `PROJECT-PLAN.md` 为准 |
| 对照基线     | 本地 `vendor/pi/packages/ai`，固定 commit `3da591ab74ab9ab407e72ed882600b2c851fae21`                                  |
| 目标读者     | 实现 Runtime/Provider/Protocol 的开发者、接入 `duoduo-agent-core` 的调用方、做安全与发布验收的审查者                  |
| 读完后的动作 | 实现者从 Foundation gate 开始；接入方只依赖公共 export map；审查者按“Gate 追踪与验收证据”逐项收集证据                 |

本文描述的是要实现的合同，不代表代码已经完成。PI 仅是固定的行为基线和 fixture 来源，不得成为构建时或运行时依赖；本文与 PI 内部实现冲突时，以本文冻结的安全边界、类型和错误语义为准，但“PI 基线能力”不得在没有明确差异说明时被删减。

具体开发顺序、切片依赖、文件清单、测试先行步骤和验收命令见 [`Duoduo AI 可执行实施计划`](../plans/2026-07-19-duoduo-ai-implementation-plan.md)。设计文档决定“必须满足什么”，实施计划决定“按什么顺序证明并交付”。

建议阅读路径：

- 实现核心与 Runtime：依次阅读[总体模块结构](#module-structure)、[核心领域协议](#core-contract)、[公共 Runtime API](#runtime-api)、[统一调用流](#call-flow)和[安全与威胁模型](#security-model)。
- 实现 Provider/Protocol：再阅读[Provider 与 ProtocolAdapter](#provider-protocol)、[文本协议 wire 与类型矩阵](#text-protocol-matrix)、[Provider 覆盖](#provider-coverage)和[扩展开发模板](#extension-template)。
- 实现图片：阅读[图片生成](#images)、[图片流与任务恢复](#image-operation)与[内建图片矩阵](#image-matrix)。
- 实现视频与生成任务：阅读[统一生成任务内核](#generation-kernel)、[视频生成](#videos)与[托管平台、自建网关和云 GPU](#generation-channels)。
- 做交付验收：阅读[公共导出](#public-exports)、[测试设计](#testing)、[实现顺序](#implementation-gates)和[Gate 追踪与验收证据](#gate-evidence)。

## 背景

多多短剧需要一个稳定的模型运行时层，将 OpenAI、Anthropic、Google、DeepSeek、Kimi、GLM、MiniMax、Qwen、豆包、Kling、Seedance、Grok Imagine、第三方综合平台与自建生成网关的认证、模型目录、请求协议、流式事件、Usage 和错误统一起来。未来的 `duoduo-agent-core` 应只依赖这一统一边界，不直接认识任何模型厂商 SDK、wire protocol 或云 GPU 厂商。

本设计参考本地 `vendor/pi/packages/ai` 在 commit `3da591ab74ab9ab407e72ed882600b2c851fae21` 中的功能范围与分层经验，但不复制其源码，也不追求与 `@earendil-works/pi-ai` 逐字 API 兼容。`@duoduo/ai` 将按照本项目的命名、模块边界、错误语义和测试规则独立实现。

## 决策摘要

- 新建单一 workspace package：`packages/ai`，包名 `@duoduo/ai`。
- 在一个 package 内建立严格模块边界，通过 subpath exports 暴露按需能力。
- 功能范围对齐 PI AI 的完整模型运行时能力，并额外将 Qwen 和豆包作为一等 Provider。
- Provider 与 wire protocol 分离；多个 Provider 可复用同一 ProtocolAdapter。
- 根入口无自动注册、环境变量读取或其他副作用。
- 文本/多模态对话与图片生成复用认证、目录、传输和诊断基础设施，但使用不同的领域类型和公共入口。
- 图片与视频共享生成任务内核，但各自拥有输入、能力、输出、目录与 protocol interface；不使用一个可任意塞字段的通用 media 请求。
- Provider 表示实际访问渠道，模型的 `publisher/family/upstreamModelId` 表示来源；官方直连、第三方综合平台和自建网关可以暴露同一模型，但必须保持不同的 `providerInstanceId`、价格、限流与任务语义。
- 租赁云 GPU 的开关机、扩缩容、调度和 Worker 部署隐藏在自有 Generation Gateway 后，不进入 Agent 或通用 Provider interface。
- 第一版显式选择 Provider/model handle；自动按价格、可用性或优先级跨渠道路由属于后续独立模块，禁止 adapter 暗中 fallback。
- 不建立 PI 的 legacy `compat` 入口；从第一版开始只维护新的稳定 API。

## OAuth、动态目录与图片为何属于 AI 层

PI AI 的 OAuth 不是多多短剧的“用户登录”。它解决模型 Provider 的凭证获取、刷新、撤销和请求转换：例如 GitHub device code 换 Copilot token，OpenAI Codex/Anthropic/xAI/Radius 获取并刷新 access token。业务用户是谁、是否有权使用某个 tenant/credential slot 由宿主 `CredentialScopeAuthority` 决定；OAuth flow 只在获准 scope 内管理上游模型账号，绝不能替代业务鉴权。

动态模型目录解决“可用模型在运行时才知道”的情况。静态 JSON 只能表达构建时已知模型；Radius 的 gateway config、账号级 visible model list、企业网关 discovery 可能随凭证、区域、workspace 或账号改变。目录层把静态 shard、显式模型、credential 过滤和受控 discovery 合并成 scope-bound `ModelHandle`，并用持久 cache/fingerprint 防止跨租户或错误账号复用。它不是每次请求都扫描互联网，也不为没有可靠 list API 的 Provider 伪造动态发现；第一版只有 Radius 强制 runtime discovery。

图片生成放在 AI 而不是 Agent，是职责边界：AI 层知道模型能力、认证、create/poll/cancel wire 协议、图片输入序列化、Usage/Cost、错误和临时 URL；Agent 层只决定“为什么生成、何时调用、选择哪个工具/模型、如何把结果用于任务”。如果把 Provider 图片调用放进 Agent，每个 Agent 都会重复认证、重试和厂商适配；如果把业务素材库/版权/版本流放进 AI，又会污染通用模型层。因此 `@duoduo/ai/images` 只负责模型调用，素材持久化与业务授权仍在上层。

## 目标

1. 为对话、推理、工具调用、多模态输入、图片生成和视频生成提供统一的 TypeScript 协议。
2. 支持静态和动态模型目录、能力元数据、上下文窗口、输出限制与价格。
3. 支持 API Key、OAuth、环境认证、CredentialStore 和并发安全的 token 刷新。
4. 将 fetch、SSE、WebSocket、超时、重试、代理和取消收敛为可替换的传输层。
5. 对所有 Provider 输出确定性流事件、终态响应、Usage、Cost 与脱敏诊断。
6. 通过独立 Provider subpath、延迟加载和可注册工厂，同时支持内建与自定义 Provider。
7. 为未来 `@duoduo/agent-core` 提供窄而稳定的 `stream()` / `complete()` 边界。
8. 让官方直连、综合平台和自建云 GPU 网关通过同一 Provider/Protocol 扩展机制接入，同时保留渠道差异和可审计身份。

## 非目标

- 本阶段不实现 Agent loop、工具执行、steering、follow-up 或 Agent 会话状态。
- 不实现短剧、项目、用户、团队、权限或素材持久化规则。
- 不追求与 PI AI 的内部文件、类名或旧全局注册 API 兼容。
- 不在默认测试中发起付费或非确定性模型请求。
- 3D 生成、语音合成和 embedding 不因为某个 Provider 同时提供它们而自动进入本阶段；视频生成属于本设计范围。
- 本阶段不实现云 GPU 资源控制面、调度器、容器部署、模型缓存或业务素材持久化；只冻结并验证它们通过自有 Generation Gateway 接入 `@duoduo/ai` 的 interface。
- 本阶段不实现跨 Provider 自动选路、价格竞价或故障转移；同一上游模型的不同访问渠道使用不同 model handle，由上层显式选择。

## Package 位置与仓库边界

`@duoduo/ai` 放在 `packages/ai`。这是对当前“至少两个真实消费者后才抽取共享包”规则的明确例外：它不是含糊的 shared package，而是具有独立协议、Provider 生态、构建边界和测试矩阵的模型运行时。`agent` workspace 是预期消费者，但本设计只交付 AI package；Agent 接入和 Agent loop 另行设计与验收。

实现时必须同步：

- 在 `pnpm-workspace.yaml` 恢复 `packages/*`。
- 新建 `packages/ai/AGENTS.md`，固定模块依赖和测试安全规则。
- 更新根 `AGENTS.md` 和 README 中的 package 边界说明。
- 增加一个只依赖公共 export map 的编译型消费 fixture，证明包在不深度导入源码时可被未来 Agent runtime 使用；本阶段不修改 `agent` workspace。

<a id="module-structure"></a>

## 总体模块结构

```text
packages/ai/
├── AGENTS.md
├── package.json
├── tsconfig.json
├── scripts/
│   └── catalog/
├── src/
│   ├── core/
│   │   ├── content.ts
│   │   ├── errors.ts
│   │   ├── events.ts
│   │   ├── messages.ts
│   │   ├── models.ts
│   │   ├── provider-identity.ts
│   │   ├── secret-value.ts
│   │   ├── tools.ts
│   │   └── usage.ts
│   ├── stream/
│   ├── runtime/
│   ├── auth/
│   ├── catalog/
│   ├── context/
│   ├── transport/
│   ├── session/
│   ├── protocols/
│   ├── providers/
│   ├── generation/
│   ├── images/
│   ├── videos/
│   ├── telemetry/
│   ├── testing/
│   ├── cli/
│   └── index.ts
└── test/
    ├── fixtures/
    └── live/
```

常规单元测试与源码就近放置为 `*.test.ts`。`test/fixtures` 仅存放跨模块固定数据，`test/live` 仅存放显式启用的真实 Provider 验证。

## 依赖方向

```text
core
├── stream
├── auth ──(声明 AuthHttpTransport 端口，由 transport 注入实现)
├── catalog
├── context
├── transport
├── session
└── generation

core/auth/context/transport/session/stream → protocols
core/auth/stream/transport                → generation
core/catalog/stream/transport/generation → images/videos
core/auth/catalog/protocols/images/videos → providers
上述全部模块                              → runtime
runtime/providers                         → CLI / 业务调用方
```

箭头右侧是依赖者，文本箭头左侧是被依赖模块。`auth` 只声明 OAuth 所需的最小 `AuthHttpTransport`/policy 端口，具体 transport 实现在 runtime 装配，避免 auth 反向依赖 protocol/provider。任何内层模块都不得反向导入 `providers`、`runtime` 或 `cli`。

详细约束：

- `core` 只包含类型和纯函数，不依赖 Node、环境变量、SDK 或具体 Provider。
- 跨 auth/catalog/protocol/images 共用的 `ProviderSnapshot` 与 `SecretValue` 下沉到 core identity/sensitive-value 类型；secret 的构造和 reveal 实现仍不公开，避免 auth ↔ transport 或内层 → providers 环。
- `stream` 只依赖事件和终态类型，实现 AsyncIterable、有界队列、结果 Promise 与确定性终止。
- `auth`、`catalog`、`context`、`transport` 和 `session` 不导入彼此的实现；需要协作时通过端口和 runtime 注入。
- `protocols` 依赖统一上下文、传输和流，但不读取环境变量，也不自行选择 Provider。
- `providers` 是薄装配层：组合身份、认证、模型源、协议 adapter 和少量兼容规则。
- `runtime` 负责注册、查找、认证协调、路由和统一终态，不包含厂商 payload 转换。
- `session` 管理协议需要的连接、response ID affinity 和可释放资源，只暴露通用资源生命周期，不认识具体 Provider。
- `generation` 是图片与视频共享的深模块，拥有异步 operation 状态机、持久句柄安全骨架、通用阶段与产物描述；它不认识图片尺寸、视频时长或具体 Provider。
- `images` 与 `videos` 分别拥有领域输入、输出、目录和 adapter；两者复用 generation/auth/catalog/transport/telemetry，不相互导入，也不反向依赖 `providers`。
- `cli` 位于最外层，不被其他模块依赖。

这些边界不是文档约定而已：package 内使用模块 alias 与 ESLint `no-restricted-imports`/依赖图测试阻止反向导入；public export-map 测试阻止消费者深度导入。

公共端口归属固定如下：core/root 拥有 provider identity、secret wrapper、模型/消息/错误与 Runtime facade；`auth` 拥有认证/OAuth/store 端口，`auth/node` 拥有文件 store、loopback 和本地 scope preset；`catalog` 拥有 discovery/cache 端口；`context` 拥有 `ContextPolicy/PreparedContext`；`session` 拥有资源 lease；`transport` 拥有 request facade、driver 与 NetworkPolicy，`transport/node` 拥有代理/Node WebSocket/SDK driver；`protocols` 与 `providers` 的裸 subpath 分别拥有基础 contract/binding；`generation` 拥有共享任务内核；`images` 与 `videos` 分别拥有各自领域、目录与协议端口。具体 Provider/protocol 实现只能从各自 wildcard subpath 导入。

模块所有权与禁止项进一步冻结为：

| 模块         | 唯一拥有                                                                  | 可依赖                                      | 明确禁止                                               |
| ------------ | ------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------ |
| `core`       | 基础 identity、secret wrapper、消息/模型/tool/usage/error 纯类型与纯函数  | Web 标准类型                                | Node、环境变量、网络、store、Provider                  |
| `stream`     | 公共流状态机、有界 observer queue、终态聚合骨架                           | `core`                                      | Provider payload、认证、fetch                          |
| `auth`       | Credential/OAuth/ambient/scope/store 端口与 record sealer                 | `core`、自己声明的最小 HTTP 端口            | protocol/provider、裸 fetch、业务 principal            |
| `catalog`    | 通用 cache key/ticket/store、manifest 与 discovery 基础端口               | `core`、transport 的窄端口类型              | 图片/聊天具体 payload、Provider 注册表                 |
| `context`    | 跨 Provider 通用历史规范化与 `PreparedContext`                            | `core`                                      | 具体 Provider ID、wire role/payload                    |
| `transport`  | protected target、request facade、driver、resource loader、network policy | `core`                                      | model routing、目录选择、业务授权                      |
| `session`    | session/resource lease、引用计数、cleanup/dispose                         | `core`                                      | 消息历史、Agent steering、Provider SDK 静态导入        |
| `protocols`  | wire serializer/parser、typed option/compatibility contract               | `core/stream/context/transport/session`     | 环境变量、CredentialStore、Provider 选择、公共终态创建 |
| `generation` | 图片/视频共享 operation、阶段、产物与持久恢复安全骨架                     | `core/auth/stream/transport`                | 图片/视频参数、云 GPU SDK、业务任务队列                |
| `images`     | 图片模型/输入/结果/流、图片 protocol 与 operation 领域 facade             | `core/stream/catalog/transport/generation`  | Provider 工厂、raw credential、业务素材持久化          |
| `videos`     | 视频模型/输入/结果/流、视频 protocol 与 operation 领域 facade             | `core/stream/catalog/transport/generation`  | Provider 工厂、GPU 调度、剪辑工程与素材持久化          |
| `providers`  | Provider 工厂、auth/model-source/protocol binding、curated shard          | `core/auth/catalog/protocols/images/videos` | Runtime 单例、自动注册、导入时读环境或联网             |
| `runtime`    | 注册、scope/auth/catalog/context/transport/session 编排与公共 facade      | 所有内层模块                                | 厂商 payload 转换、业务数据库/用户模型                 |
| `telemetry`  | 脱敏事件端口与可选 OTel adapter                                           | `core`                                      | 全局 provider 副作用、prompt/tool-result 默认采集      |
| `testing`    | fake/fixture/contract suite                                               | 公共模块                                    | 生产入口反向依赖、默认真实凭据/网络                    |
| `cli`        | Node 命令解析和公共 Runtime 组合                                          | 公共 export map、Node-only presets          | 私有源码深度导入、第二套 credential 文件格式           |

ESLint 依赖图测试按这张表逐边验证，不只检查是否存在循环。type-only import 也必须遵守所有权；如果两个模块需要同一类型，应下沉到 `core` 或抽成上表已有的窄端口，不能用 barrel re-export 隐藏反向依赖。

<a id="core-contract"></a>

## 核心领域协议

### 模型

```ts
type ProviderInstanceId = string;
type CredentialIdentityLifetime = 'cross-runtime' | 'process-local';
interface AiCapabilityMap {
  chat: true;
  images: true;
  videos: true;
}
type AiCapabilityId = keyof AiCapabilityMap;
declare const protocolBrand: unique symbol;

interface ModelRef<TProtocol extends string = string> {
  providerInstanceId: ProviderInstanceId;
  modelId: string;
  readonly [protocolBrand]?: TProtocol;
}

interface ModelDefinition<TProtocol extends string = string> {
  id: string;
  upstreamModelId: string;
  name: string;
  providerInstanceId: ProviderInstanceId;
  publisher?: string;
  family?: string;
  protocol: TProtocol;
  protocolProfileId: string;
  capabilities: ModelCapabilities;
  limits: ModelLimits;
  requestDefaults?: Readonly<CommonStreamRequestDefaults>;
  pricing?: ModelPricing;
  providerMetadata?: Readonly<Record<string, JsonValue>>;
}

interface ModelCapabilities {
  input: readonly ('text' | 'image')[];
  streaming: boolean;
  reasoning: boolean;
  toolCalling: boolean;
  parallelToolCalls: boolean;
  deferredTools: boolean;
  thinkingLevels: readonly ReasoningLevel[];
}

interface ModelLimits {
  contextTokens: number;
  maxOutputTokens: number;
  maxInputImages?: number;
  maxInputImageBytes?: number;
}

interface TokenRates {
  input?: number;
  output?: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cacheWriteByRetention?: Readonly<
    Partial<Record<'standard' | 'one_hour', number>>
  >;
}

interface ModelPricing {
  currency: 'USD';
  unit: 'per_million_tokens';
  rates: TokenRates;
  tiers?: readonly {
    aboveInputTokens: number;
    rates: TokenRates;
  }[];
  serviceTierMultipliers?: Readonly<Record<string, number>>;
}
```

`ModelRef` 是跨目录刷新稳定的公共身份；Runtime 在每次调用开始时将其解析为经过 schema 验证、冻结的内部快照。`ModelDefinition` 只由受信任的 Provider/目录边界创建，普通调用方不能把任意对象伪装成模型并跳过验证。scope-aware 的异步 `find()` 对不可见模型 resolve `undefined`，`require()` reject typed control-plane error；流内解析失败则进入失败终态。

目录 loader 验证 capabilities/limits 数值非负、thinking level 有序、pricing tier threshold 严格递增。未知能力显式使用保守值 `false`，未知价格保持整个字段或对应 rate 为 `undefined`，不得用 0 表示“未知”。`id` 是当前访问渠道内的稳定公共 ID，`upstreamModelId` 是发给该渠道的 wire ID；`publisher/family` 只用于来源展示、筛选和未来显式路由候选，不参与当前请求的隐式 fallback。图片和视频分别使用独立的模型定义，不混入对话能力。

### 消息与内容

```ts
type JsonPrimitive = string | number | boolean | null;
type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

interface EndpointHints {
  baseUrl?: URL;
  audience?: string;
  providerAccountId?: string;
}

interface CatalogAuthView {
  catalogVisibilityFingerprint: string;
  visibleModelIds?: readonly string[];
  publicMetadata?: Readonly<Record<string, JsonValue>>;
}

interface HttpByteResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: ReadableStream<Uint8Array>;
  requestId?: string;
}

type ReplayScope = 'portable' | 'same-provider' | 'same-model';

type ReplayMetadata =
  | {
      version: 1;
      scope: 'portable';
      source?: ModelRef;
      protocolId: string;
      codecId: string;
      codecVersion: number;
      data: JsonValue;
    }
  | {
      version: 1;
      scope: 'same-provider' | 'same-model';
      source: ModelRef;
      protocolId: string;
      codecId: string;
      codecVersion: number;
      data: JsonValue;
    };

interface TextContent {
  type: 'text';
  text: string;
  replay?: ReplayMetadata;
}

interface ReasoningContent {
  type: 'reasoning';
  text?: string;
  replay?: ReplayMetadata;
}

interface ImageContent {
  type: 'image';
  mediaType: string;
  source: { type: 'url'; url: string } | { type: 'base64'; data: string };
}

interface ToolCallContent {
  type: 'tool_call';
  id: string;
  name: string;
  status: 'complete' | 'incomplete';
  rawArguments: string;
  arguments?: JsonValue;
  replay?: ReplayMetadata;
}

interface UserMessage {
  role: 'user';
  content: readonly (TextContent | ImageContent)[];
  timestamp?: number;
}

interface AssistantMessage {
  role: 'assistant';
  content: readonly (TextContent | ReasoningContent | ToolCallContent)[];
  model: ModelRef;
  responseModel?: ModelRef;
  responseId?: string;
  replay?: ReplayMetadata;
  status: ResponseStatus;
  finishReason: FinishReason;
  partial: boolean;
  timestamp?: number;
  diagnostics?: readonly AiDiagnostic[];
}

interface ToolResultMessage {
  role: 'tool_result';
  toolCallId: string;
  toolName: string;
  isError: boolean;
  content: readonly (TextContent | ImageContent)[];
  details?: JsonValue;
  addedToolNames?: readonly string[];
  timestamp?: number;
}

type Message = UserMessage | AssistantMessage | ToolResultMessage;

interface AiContext {
  systemPrompt?: string;
  messages: readonly Message[];
  tools?: readonly ToolDefinition[];
}
```

同一请求中的工具名必须唯一。并行工具调用通过不同 `ToolCallContent.id` 关联结果；`rawArguments` 永远保留模型实际产生的 JSON 文本，`arguments` 仅在 `status === 'complete'` 且完整可解析时存在。解析不等于业务校验，未来 Agent 仍须按工具 schema 验证后才能执行。

`ToolResultMessage.addedToolNames` 是 deferred tool 的持久 load point，所有策略都先校验名称存在、标记为 deferred 且在整段 transcript 中最多出现一次。对于有效 `ModelCapabilities.deferredTools === true` 的 native/Kimi emulation，非 deferred 工具初始 active、deferred 工具初始 inactive，按消息顺序只在对应 tool result 之后激活；激活前已出现该工具的 tool call 属于 `invalid_request`。目标不支持 deferred 时由 `ContextNormalizationPolicy.deferredTools` 唯一决定：默认 `eager-fallback` 把所有工具视为初始 active，load point 只保留为 placement hint 并记 diagnostic，不对历史中的提前调用报错；`require-deferred` 则在联网前返回 capability error。Agent 提出 load point，AI package 验证/序列化状态转换并决定不支持目标是否可提前暴露。

Provider 特有的签名、response ID、加密 reasoning 和重放数据只能放入带 envelope version、稳定 `protocolId/codecId/codecVersion` 与 `ReplayScope` 的 metadata。type-only brand 不参与持久分派；Runtime 只按注册的稳定 codec identity 解码，不能从当前目录或模型名猜原协议。`same-provider`/`same-model` 必须记录 source；scope 不匹配、codec 未注册或版本不支持时默认只剥离 replay metadata并产生脱敏 diagnostic，绝不把未验证 `data` 原样发给 Provider。是否连不可读 reasoning block 一并丢弃由显式 context policy 决定。`context` 应用通用重放规则后，再由目标 `ProtocolBinding.contextPolicy` 处理协议特有的 tool ID、签名和历史约束；底层 `context` 模块不导入 Provider 代码。

### 工具

```ts
interface JsonSchema {
  readonly [keyword: string]: JsonValue;
}

interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
  deferred?: boolean;
}

interface ToolValidationIssue {
  instancePath: string;
  keyword: string;
  message: string;
}

type JsonParseResult =
  | Readonly<{ ok: true; value: JsonValue; repaired: boolean }>
  | Readonly<{ ok: false; error: 'invalid_json' | 'too_large' }>;

type ToolValidationResult =
  | Readonly<{ valid: true; value: JsonValue }>
  | Readonly<{ valid: false; issues: readonly ToolValidationIssue[] }>;

declare function parseToolArguments(
  rawArguments: string,
  options?: { maxBytes?: number; repairTruncatedJson?: boolean },
): JsonParseResult;

declare function validateToolArguments(
  tool: ToolDefinition,
  argumentsValue: JsonValue,
): ToolValidationResult;

declare function validateToolCall(
  tools: readonly ToolDefinition[],
  call: ToolCallContent,
): ToolValidationResult;

declare function isContextOverflowError(error: AiError): boolean;
```

公共 schema 方言以 JSON Schema 2020-12 为准。Adapter 必须显式拒绝或安全降级目标 Provider 不支持的关键字，不得静默扩大允许输入。`deferred` 表示工具定义可由支持该能力的协议延迟加载；不支持时严格遵循上述显式 `eager-fallback | require-deferred` 策略。AI package 不执行工具，但必须提供上面的 Agent-facing 纯函数：解析始终保留 `rawArguments`，修复只处理可确定的截断括号/引号且必须标记 `repaired`；无论是否修复，只有完整 JSON 再通过对应工具 schema 后才可执行。校验 issue 必须限长且不得回显 secret-shaped value。

ProtocolAdapter 将明确的 Provider overflow、HTTP overflow 错误和经 curated profile 证明的 silent-overflow 响应统一映射为 `CONTEXT_OVERFLOW`；不能仅凭空文本或 `finishReason: length` 猜测。每个 silent detector 必须是 protocol contract 中带 ID/version 的受信规则，并有正例、反例和临界 token fixture。`isContextOverflowError()` 只检查稳定 code，不解析 message。

### Usage 与成本

```ts
interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheWriteTokensByRetention?: Readonly<
    Partial<Record<'standard' | 'one_hour', number>>
  >;
  totalTokens?: number;
  serviceTier?: string;
  providerReportedCost?: { currency: string; amount: number };
}

interface Cost {
  currency: 'USD';
  input?: number;
  output?: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cacheWriteByRetention?: Readonly<
    Partial<Record<'standard' | 'one_hour', number>>
  >;
  total?: number;
  source: 'computed' | 'provider' | 'mixed';
}

declare function calculateCost(
  model: Readonly<ModelDefinition>,
  usage: Readonly<Usage>,
): Cost | undefined;

declare function estimateContextTokens(context: Readonly<AiContext>): number;

declare function parseRetryAfter(
  value: string | undefined,
  nowMs: number,
): number | undefined;

declare function computeRetryDelay(input: {
  attempt: number;
  policy: RetryPolicy;
  retryAfterMs?: number;
  randomUnit: number;
}): number | undefined;
```

所有 token/cost 字段都用 `undefined` 表示 Provider 未提供或无法可靠计算，0 只表示已知为零。`totalTokens` 若由分项计算必须标记 diagnostic；价格按请求开始时的 model snapshot、实际 input tier、cache-write retention 与已知 service tier 计算。`CacheRetention.long` 是请求偏好，不自动等于某个计费桶；adapter 必须按实际上游语义报告。Anthropic 1 小时 cache write 必须进入 `one_hour` 分桶并使用该模型快照的对应 rate，不能混入普通 cache write；若上游只给总数，则只保留 `cacheWriteTokens`，不伪造分桶。

`serviceTierMultipliers` 的 key 是协议规范化后的 tier 名，倍率必须为有限正数；Usage 报告未知 tier 时，本地 cost 保持 `undefined` 并产生 diagnostic。只有 `providerReportedCost.currency === 'USD'` 才能进入固定 USD 的 `Cost`；其他币种完整保留在 Usage，`Cost` 不做隐式汇率换算。Provider 返回的 USD cost 优先并保留 `source: 'provider' | 'mixed'`。

### 终态响应

```ts
type CompletedFinishReason =
  'stop' | 'length' | 'tool_calls' | 'content_filter';
type FinishReason = CompletedFinishReason | 'error' | 'cancelled';
type ResponseStatus = 'completed' | 'failed' | 'cancelled';

interface AssistantResponseBase {
  requestId: string;
  model: Readonly<ModelDefinition>;
  responseModel?: ModelRef;
  responseId?: string;
  replay?: ReplayMetadata;
  content: readonly (TextContent | ReasoningContent | ToolCallContent)[];
  usage?: Usage;
  cost?: Cost;
  diagnostics?: readonly AiDiagnostic[];
  startedAt: number;
  completedAt: number;
}

type AssistantResponse =
  | (AssistantResponseBase & {
      status: 'completed';
      finishReason: CompletedFinishReason;
      partial: false;
      error?: never;
    })
  | (AssistantResponseBase & {
      status: 'failed';
      finishReason: 'error';
      partial: boolean;
      error: AiError;
    })
  | (AssistantResponseBase & {
      status: 'cancelled';
      finishReason: 'cancelled';
      partial: boolean;
      error: AiError & { category: 'cancelled' };
    });
```

`model` 是请求开始时的目录/价格快照；Provider 实际返回的模型身份、response ID 和可持久重放数据分别进入 `responseModel`、`responseId` 与 assistant/block-level `replay`。`partial` 只表示失败或取消后是否保留了任何输出；成功响应一律为 `false`，因此 `length`/`content_filter` 不会和 transport partial 混淆。

`length` 是已完成的模型响应，但其中可能存在 `status: 'incomplete'` 的截断工具参数；未来 Agent 只有在 `finishReason === 'tool_calls'` 且所有 tool call 都是 `complete`、完整解析并通过 schema 验证时才能执行工具。`error` 与 `cancelled` 分别对应 `failed` 与 `cancelled` 状态，并携带已产生的 partial content。

核心提供 `toAssistantMessage(response)` 纯函数，保留 model/status/finishReason 和可重放 metadata。这样 `context` 能确定性过滤失败、取消或被截断的历史 turn，而不依赖调用方另存隐藏状态。

<a id="runtime-api"></a>

## 公共 Runtime API

```ts
interface CreateAiOptions<TScopeHandle> {
  credentialStore: CredentialStore;
  catalogStore: CatalogStore;
  transport: TransportDriver;
  networkPolicy: NetworkPolicy;
  environment?: EnvironmentSource;
  scopeAuthority: CredentialScopeAuthority<TScopeHandle>;
  ambientAuthPolicy: AmbientAuthPolicy;
  credentialOverridePolicy: CredentialOverridePolicy;
  generationOperationCodec?: GenerationOperationCodec;
  operationCredentialVerifier?: OperationCredentialVerifier;
  generationOperationPolicy?: GenerationOperationPolicy;
  authAuditSink?: AuthAuditSink;
  telemetrySink?: AiTelemetrySink;
  transportObserver?: TransportObserver;
  trustedRequestPolicy?: TrustedRequestPolicy<TScopeHandle>;
  secureRandom?: SecureRandom;
  loopbackCallbackFactory?: (signal: AbortSignal) => Promise<LoopbackCallback>;
  commonDefaults?: CommonStreamRequestDefaults;
  protocolDefaults?: RuntimeProtocolDefaults;
  imageDefaults?: CommonImageRequestDefaults;
  imageProtocolDefaults?: RuntimeImageProtocolDefaults;
  videoDefaults?: CommonVideoRequestDefaults;
  videoProtocolDefaults?: RuntimeVideoProtocolDefaults;
  resourcePolicy?: RuntimeResourcePolicyInput;
}

declare function createAi<TScopeHandle>(
  options: CreateAiOptions<TScopeHandle>,
): AiRuntime<TScopeHandle>;
```

所有“可配置”资源边界只有这一个装配入口；Provider、adapter 和 per-call options 只能收紧，不能扩大。Runtime 先把 partial input 合并为完整冻结策略：

```ts
interface RuntimeResourcePolicy {
  transport: TransportLimits;
  maxMediaBytes: number;
  maxMediaItems: number;
  maxReplayMetadataBytes: number;
  maxRequestMetadataBytes: number;
  streamQueue: { maxEvents: number; maxBytes: number };
  catalog: {
    defaultMaxAgeMs: number;
    maxMaxAgeMs: number;
    staleIfErrorMs: number;
  };
  session: {
    idleTtlMs: number;
    maxSessions: number;
    maxResourcesPerSession: number;
  };
  refresh: {
    leaseMs: number;
    heartbeatMs: number;
    hardDeadlineMs: number;
    waiterDeadlineMs: number;
    minBackoffMs: number;
    maxBackoffMs: number;
  };
  auth: {
    loginDeadlineMs: number;
    interactionDeadlineMs: number;
    maxResponseBytes: number;
  };
}

interface RuntimeResourcePolicyInput {
  transport?: Partial<TransportLimits>;
  maxMediaBytes?: number;
  maxMediaItems?: number;
  maxReplayMetadataBytes?: number;
  maxRequestMetadataBytes?: number;
  streamQueue?: Partial<RuntimeResourcePolicy['streamQueue']>;
  catalog?: Partial<RuntimeResourcePolicy['catalog']>;
  session?: Partial<RuntimeResourcePolicy['session']>;
  refresh?: Partial<RuntimeResourcePolicy['refresh']>;
  auth?: Partial<RuntimeResourcePolicy['auth']>;
}

interface TrustedRequestPolicy<TScopeHandle> {
  allow(input: {
    scope: TScopeHandle;
    provider: Readonly<ProviderSnapshot>;
    capability: AiCapabilityId;
    modelId: string;
  }): Promise<boolean> | boolean;
  responseHeaderAllowlist?: readonly string[];
}
```

第一版默认值与合法范围固定如下；数值均为整数，越界在注册或请求联网前失败：

| 项目                         | 默认值                                                           | 可配置范围/规则                                           |
| ---------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------- |
| request/response/error/frame | 16 MiB / 64 MiB / 256 KiB / 4 MiB                                | 1 KiB–64 MiB / 1 KiB–256 MiB / 1 KiB–1 MiB / 1 KiB–16 MiB |
| 单个媒体、媒体项数           | 20 MiB、16                                                       | 64 KiB–64 MiB、1–64；还受模型 limits 收紧                 |
| replay/请求 metadata         | 256 KiB / 64 KiB                                                 | 1 KiB–1 MiB / 1 KiB–256 KiB，按 canonical UTF-8 JSON 计数 |
| observer queue               | 256 events / 4 MiB                                               | 8–4096 events、64 KiB–32 MiB；任一先到即 backpressure     |
| catalog                      | max-age 1 h、stale-if-error 24 h                                 | max-age 5 s–24 h；stale 0–7 d；远端值只能收紧             |
| session                      | idle 15 min、最多 1000 个 session、每个 64 个资源                | idle 1 min–24 h；session 1–10000；资源 1–256              |
| refresh                      | lease 30 s、heartbeat 10 s、hard/waiter 2 min、backoff 5 s–5 min | heartbeat 小于 lease/2；hard ≥ lease；所有值 1 s–15 min   |
| OAuth                        | login/interaction 10 min、响应 1 MiB                             | deadline 30 s–30 min；响应 16 KiB–4 MiB                   |

公共文本默认值为：`stop=[]`、`toolChoice='auto'`、`reasoning='none'`、`cacheRetention='short'`、总 `timeoutMs=120_000`、retry `{ maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 5_000, jitterRatio: 0.2, retryOn: ['network','rate_limit','timeout','provider_5xx'] }`；`maxOutputTokens` 为 `min(model.maxOutputTokens, 8192)`，temperature/topP 保持未设置。默认 context policy 为图片不支持即 reject、跨 Provider 可读 reasoning 转 text、失败 turn drop、incomplete tool drop、deferred eager fallback、超预算 reject。图片默认总 timeout 600 秒，视频默认总 timeout 1800 秒，二者 poll 默认 2 秒、resume 默认允许目录联网；图片 response format 优先 URL、模型不支持 URL 时使用其首个 output format，视频默认只接受 URL 或受限大小的 base64 输出。

per-call `timeoutMs` 文本允许 1 秒–15 分钟、图片/resume 1 秒–1 小时、视频/resume 1 秒–6 小时；retry attempts 1–5、单次 delay 不超过 30 秒、jitter 0–1；temperature 0–2、topP 0–1、stop 最多 16 项且每项不超过 256 UTF-8 bytes。`maxOutputTokens` 必须为正整数且不超过 model limit。任何 Runtime 默认也要经过同一硬范围，不能因为来自可信配置就跳过验证。

`generationOperationCodec` 与 `operationCredentialVerifier` 对普通文本以及 direct 图片/视频均为可选端口。媒体 model capability 与 binding mode 必须完全一致；只有 `asyncOperation: true` 的模型能指向 resumable binding。带 `credentialOverride` 调用这类模型时，Runtime 必须在启动 adapter 前确认 verifier 已配置；缺失时同步抛出 `AiConfigurationError('OPERATION_CREDENTIAL_VERIFIER_REQUIRED')`。这样不会先创建一个远端付费任务，再发现它无法安全恢复。跨进程序列化还要求持久 `generationOperationCodec`；没有 codec 的异步任务仍可生成有界 TTL 的进程内 ref，但 `serializeOperation()` 明确失败。`generationOperationPolicy` 未提供时使用本文冻结的安全默认值，不能由 Provider 放宽。

```ts
const ai = createAi({
  credentialStore,
  catalogStore,
  transport,
  networkPolicy,
  scopeAuthority,
  ambientAuthPolicy,
  credentialOverridePolicy,
  generationOperationCodec,
});

ai.providers.register(openAiProvider());

const scope = requestContext.aiScopeHandle;
const model = await ai.models.require(
  {
    providerInstanceId: 'openai',
    modelId: 'gpt-5',
  },
  scope,
);
const stream = ai.stream(model, context, { ...options, scope });

for await (const event of stream) {
  // Consume normalized incremental events.
}

const response = await stream.result();
```

Runtime 能力按命名空间组织：

```ts
ai.providers.register();
ai.providers.registerAll(providers);
ai.providers.unregister();
ai.inventory.models.find();
ai.inventory.models.list();
ai.models.find();
ai.models.require();
ai.models.list();
ai.models.refresh();
ai.auth.status();
ai.auth.login();
ai.auth.logout();
ai.stream();
ai.complete();
ai.images.generate();
ai.images.stream();
ai.images.resume();
ai.images.serializeOperation();
ai.images.parseOperation();
ai.images.models.find();
ai.images.models.require();
ai.images.models.list();
ai.images.models.refresh();
ai.videos.generate();
ai.videos.stream();
ai.videos.resume();
ai.videos.serializeOperation();
ai.videos.parseOperation();
ai.videos.models.find();
ai.videos.models.require();
ai.videos.models.list();
ai.videos.models.refresh();
ai.sessions.cleanup();
ai.dispose();
```

关键方法的公共签名固定为：

```ts
declare const modelHandleBrand: unique symbol;
declare const catalogResolutionBrand: unique symbol;

interface CatalogResolutionIdentity {
  capability: AiCapabilityId;
  authSource: 'stored' | 'ambient' | 'override';
  providerRegistrationGeneration: string;
  providerConfigFingerprint: string;
  authBindingFingerprint: string;
  credentialScopeFingerprint: string;
  credentialInstanceId: string;
  credentialIdentityLifetime: CredentialIdentityLifetime;
  catalogVisibilityFingerprint: string;
  catalogDigest: string;
  requestCredentialFingerprint?: string;
}

interface ModelHandle<TProtocol extends string = string> {
  readonly [modelHandleBrand]: true;
  readonly [catalogResolutionBrand]: CatalogResolutionIdentity;
  readonly ref: ModelRef<TProtocol>;
  readonly definition: Readonly<ModelDefinition<TProtocol>>;
}

interface ProvidersApi {
  register(provider: Provider): void;
  registerAll(providers: Iterable<Provider>): void;
  unregister(providerInstanceId: ProviderInstanceId): boolean;
  list(): readonly ProviderSnapshot[];
}

interface ModelListFilter {
  providerInstanceId?: ProviderInstanceId;
  protocol?: string;
  input?: 'text' | 'image';
  supports?:
    | 'streaming'
    | 'reasoning'
    | 'toolCalling'
    | 'parallelToolCalls'
    | 'deferredTools';
}

interface ModelRefreshOptions {
  allowNetwork?: boolean;
  force?: boolean;
  signal?: AbortSignal;
}

interface ModelReadOptions extends ModelRefreshOptions {
  credentialOverride?: RequestCredentialOverride;
}

interface ModelRefreshReport {
  providerInstanceId: ProviderInstanceId;
  source: 'static' | 'fresh' | 'cached' | 'stale' | 'failed';
  models: readonly ModelHandle[];
  errors: readonly AiError[];
}

interface ModelListResult {
  models: readonly ModelHandle[];
  reports: readonly ModelRefreshReport[];
}

interface ModelsApi<TScopeHandle> {
  find<TProtocol extends string>(
    ref: ModelRef<TProtocol>,
    scope: TScopeHandle,
    options?: ModelReadOptions,
  ): Promise<ModelHandle<TProtocol> | undefined>;
  require<TProtocol extends string>(
    ref: ModelRef<TProtocol>,
    scope: TScopeHandle,
    options?: ModelReadOptions,
  ): Promise<ModelHandle<TProtocol>>;
  list(
    scope: TScopeHandle,
    filter?: ModelListFilter,
    options?: ModelReadOptions,
  ): Promise<ModelListResult>;
  refresh(
    providerInstanceId: ProviderInstanceId,
    scope: TScopeHandle,
    options?: ModelRefreshOptions,
  ): Promise<ModelRefreshReport>;
}

interface InventoryModelEntry<TProtocol extends string = string> {
  definition: Readonly<ModelDefinition<TProtocol>>;
  source: 'static' | 'explicit';
  availability: 'unknown';
}

interface ModelInventoryApi {
  find<TProtocol extends string>(
    ref: ModelRef<TProtocol>,
  ): Promise<InventoryModelEntry<TProtocol> | undefined>;
  list(filter?: ModelListFilter): Promise<readonly InventoryModelEntry[]>;
}

interface InventoryApi {
  readonly models: ModelInventoryApi;
}

interface AuthApi<TScopeHandle> {
  status(
    providerInstanceId: ProviderInstanceId,
    scope: TScopeHandle,
    options?: { signal?: AbortSignal },
  ): Promise<AuthStatus>;
  login(
    providerInstanceId: ProviderInstanceId,
    method: 'api_key' | 'oauth' | 'ambient_config',
    scope: TScopeHandle,
    interaction: AuthInteraction,
    options?: { secretScheme?: string; signal?: AbortSignal },
  ): Promise<AuthStatus>;
  logout(
    providerInstanceId: ProviderInstanceId,
    scope: TScopeHandle,
    options?: { revokeRemote?: boolean; signal?: AbortSignal },
  ): Promise<AuthLogoutResult>;
}

type AuthStatus =
  | { status: 'unconfigured' }
  | {
      status: 'ready';
      source: 'stored' | 'ambient';
      method: 'api_key' | 'oauth' | 'ambient_config';
      providerAccountLabel?: string;
    }
  | { status: 'backoff'; retryAt: number; errorCode: string }
  | { status: 'reauth_required'; errorCode: string };

interface AuthLogoutResult {
  local: 'removed' | 'already_empty';
  remote: 'not_requested' | 'revoked' | 'unsupported' | 'failed';
  diagnostics?: readonly AiDiagnostic[];
}

interface SessionsApi<TScopeHandle> {
  cleanup(
    providerInstanceId: ProviderInstanceId,
    scope: TScopeHandle,
    sessionId: string,
  ): Promise<void>;
}

interface AiRuntime<TScopeHandle> {
  readonly providers: ProvidersApi;
  readonly models: ModelsApi<TScopeHandle>;
  readonly inventory: InventoryApi;
  readonly auth: AuthApi<TScopeHandle>;
  readonly images: ImagesApi<TScopeHandle>;
  readonly videos: VideosApi<TScopeHandle>;
  readonly sessions: SessionsApi<TScopeHandle>;
  stream<TProtocol extends string>(
    model: ModelHandle<TProtocol>,
    context: AiContext,
    options: StreamOptions<TProtocol> & { scope: TScopeHandle },
  ): AiResponseStream;
  complete<TProtocol extends string>(
    model: ModelHandle<TProtocol>,
    context: AiContext,
    options: StreamOptions<TProtocol> & { scope: TScopeHandle },
  ): Promise<AssistantResponse>;
  dispose(): Promise<void>;
}
```

上面为冻结 handle 不变量而展示了 `CatalogResolutionIdentity` 和两个 brand，但它们物理上属于 `core/provider-identity.ts` 的包内类型，不是公共命名导出，也没有调用方可用的构造器。`runtime` 负责创建身份，`catalog` 负责提供其中的目录事实，`images` 只依赖 core 中的同一内部 identity；生成的声明通过不可导出的 `unique symbol` 保持 handle 不可伪造。因此这里不会形成 `images → runtime` 或 `catalog → runtime` 的反向依赖。

Runtime 把模型 Provider 与本次 action 传给 `CredentialScopeAuthority.resolve()`；authority 返回的内部 key 仍须与 expected Provider 等值，否则在任何凭据读取前失败为 `CREDENTIAL_SCOPE_MISMATCH`。在 `models.*` 等 control-plane Promise 中它表现为 reject；在 `stream()` 返回后则表现为失败终态，绝不伪装成同步异常。`ModelHandle` 带 runtime 私有 brand 与不可序列化的 `CatalogResolutionIdentity`，普通对象无法伪造；Runtime 总是提取稳定 `ModelRef`，按当前 scope 重新解析目录并校验 handle 的 Provider/config/auth/scope/credential/visibility/digest 身份。仅凭本地 registry 就能发现的 registration generation 失效可在 producer 前同步报 `MODEL_HANDLE_STALE`；需要 authority/store/catalog 才能发现的身份变化必须在 control plane 或流终态报 `MODEL_IDENTITY_CHANGED`，不能伪装成同步检查。Provider subpath 可导出带 type-only `protocolBrand` 的 ref helper，传这种 ref/handle 时 protocol options 获得静态类型；普通动态 ref 在运行时做 schema 验证。Brand 不参与授权，真正授权仍来自 authority。

`models.find/require/list` 全部是 scope-aware async API，统一覆盖静态、explicit、凭据过滤和 Radius/custom discovery；不存在会遗漏动态目录的同步“可用模型” API。无 scope 的 `inventory.models` 只读取已注册 Provider 的 static/explicit inventory，绝不联网、读 CredentialStore、运行账号过滤或返回可调用 handle，`availability` 固定为 `unknown`；它用于登录前的 CLI/配置选择器，不能代替 `models.*`。`ModelReadOptions` 默认 `allowNetwork: true`、`force: false`，`force: true` 与 `allowNetwork: false` 组合直接 reject invalid control-plane request。跨 Provider `list()` 允许部分成功，但必须在 `ModelListResult.reports` 逐一暴露 static/fresh/cached/stale/failed，不能静默吞错。`stream/complete` 只接受已异步解析的 handle，确保首个 `response_start` 与任何失败终态总有确定 model 快照；刷新期间返回的 handle 绑定产生它的完整 catalog/auth identity，不能换一个 scope 重用。图片模型 API 使用相同规则。

需要 request credential override 时，调用方必须在 `models.find/require/list` 与随后的 `stream/complete`（图片对应 models API 与 stream/generate）传入同一 override。lookup 先经 `CredentialOverridePolicy`，以 Runtime 内随机 HMAC key 对 credential material 生成只存在于私有 handle identity 的 `requestCredentialFingerprint`；override 目录只允许进程内 ephemeral cache，禁止 `CatalogStore`、session 和 ambient fallback。带 override 的 chat/image `list()` 强制要求 `filter.providerInstanceId`，否则在 auth/network 前 reject，避免把同一 secret 按多个 Provider 默认 scheme 尝试；find/require 已由 ref 唯一限定 Provider。推理时缺失 override、类型/scheme/secret 指纹不同或换 Runtime 都在联网前产生失败终态；普通 stored/ambient handle 也不能临时切换成 override。该指纹不可导出、不可反推出 secret，Runtime dispose 时销毁 key；它只保护当前 Runtime 内的 model handle，不进入可序列化 operation。异步图片 operation 另用后文的持久 `OperationCredentialProof`，不得复用这个进程内指纹。

`registerAll()` 只批量注册调用方传入的 iterable。`@duoduo/ai/providers/all` 显式导出 `builtinProviders()`；只有调用方导入该 subpath 并把 `result.providers` 传入时，已具备必需非秘密配置的 Provider 和目录 shard 才进入依赖图。Qwen 的显式 region、self-hosted gateway base URL 等缺失时进入 `result.unconfigured`，不能构造带猜测配置的 Provider。Runtime 根入口绝不偷偷发现或注册内建 Provider。

`complete()` 必须用非 `async` wrapper 直接执行 `const stream = ai.stream(...); return stream.result()`，不另建一套网络请求，并保留与 `stream()` 完全相同的同步 throw 边界。所有需要认证的调用显式携带宿主授权过的 scope handle；服务端不得把“当前用户”放在全局 runtime 状态中，也不得信任裸 subject ID。公共 `stream()` 接受统一选项，将协议特有参数放在 `protocolOptions` 中：

```ts
ai.stream(model, context, {
  scope,
  sessionId: 'conversation-456',
  temperature: 0.7,
  reasoning: 'high',
  signal,
  protocolOptions: {
    serviceTier: 'priority',
  },
});
```

协议选项使用 declaration merging 扩展，不维护一个中央巨型联合：

```ts
export interface ProtocolOptionsMap {}
export interface ProtocolCompatibilityMap {}

type ProtocolOptions<TProtocol extends string> =
  TProtocol extends keyof ProtocolOptionsMap
    ? ProtocolOptionsMap[TProtocol]
    : Readonly<Record<string, JsonValue>>;

type ProtocolCompatibility<TProtocol extends string> =
  TProtocol extends keyof ProtocolCompatibilityMap
    ? ProtocolCompatibilityMap[TProtocol]
    : Readonly<Record<string, JsonValue>>;
```

各 protocol subpath 通过 `declare module '@duoduo/ai/protocols'` 为自己的 key 同时扩展 `ProtocolOptionsMap` 与 `ProtocolCompatibilityMap`。当调用方持有精确的 `ModelDefinition<TProtocol>` 时获得完整类型；动态目录的 schema 仍在运行时验证。每个 protocol subpath 还必须导出轻量 contract，包含 options parser/validator/分层 merge、compatibility parser/validator 和 package defaults；scalar/union/array 整体替换，`undefined` 表示该层缺席，禁止通用递归 deep merge。Compatibility 只来自受信 Provider binding，不能来自目录 metadata、user override 或 per-call options。

```ts
type ToolChoice = 'auto' | 'none' | 'required' | { type: 'tool'; name: string };

type ReasoningLevel =
  'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
type CacheRetention = 'none' | 'short' | 'long';

interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
  retryOn: readonly ('network' | 'rate_limit' | 'timeout' | 'provider_5xx')[];
}

type RequestCredentialOverride =
  | { type: 'api_key'; secret: SecretValue; scheme?: string }
  | { type: 'bearer_token'; secret: SecretValue; scheme?: string }
  | { type: 'provider_secret'; secret: SecretValue; scheme: string };

interface ContextNormalizationPolicy {
  unsupportedImage: 'reject' | 'placeholder';
  crossProviderReasoning: 'preserve-readable' | 'as-text' | 'drop';
  failedTurn: 'drop' | 'preserve-readable';
  incompleteToolCall: 'drop' | 'as-text';
  deferredTools: 'eager-fallback' | 'require-deferred';
  tokenBudget: 'reject' | 'truncate-oldest-safe-turns';
}

interface CommonStreamRequestDefaults {
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  stop?: readonly string[];
  toolChoice?: ToolChoice;
  reasoning?: ReasoningLevel;
  cacheRetention?: CacheRetention;
  timeoutMs?: number;
  retry?: false | RetryPolicy;
  contextPolicy?: ContextNormalizationPolicy;
}

interface StreamRequestDefaults<
  TProtocol extends string = string,
> extends CommonStreamRequestDefaults {
  protocolOptions?: ProtocolOptions<TProtocol>;
}

type RuntimeProtocolDefaults = Readonly<{
  [TProtocol in keyof ProtocolOptionsMap]?: Partial<
    ProtocolOptionsMap[TProtocol]
  >;
}>;

interface StreamOptions<
  TProtocol extends string = string,
> extends StreamRequestDefaults<TProtocol> {
  signal?: AbortSignal;
  sessionId?: string;
  credentialOverride?: RequestCredentialOverride;
  metadata?: Readonly<Record<string, JsonValue>>;
  trustedRequest?: TrustedRequestCustomization;
}

interface TrustedRequestCustomization {
  headers?: Readonly<Record<string, string | null>>;
  transformHeaders?(
    headers: Readonly<Record<string, string>>,
    context: { providerInstanceId: string; protocol: string; modelId: string },
  ):
    | Readonly<Record<string, string | null>>
    | Promise<Readonly<Record<string, string | null>>>;
  transformPayload?(
    payload: JsonValue,
    context: { providerInstanceId: string; protocol: string; modelId: string },
  ): JsonValue | undefined | Promise<JsonValue | undefined>;
  onResponse?(response: {
    status: number;
    headers: Readonly<Record<string, string>>;
    requestId?: string;
  }): void | Promise<void>;
}

interface ResolvedStreamOptions<TProtocol extends string = string> {
  signal: AbortSignal;
  sessionId?: string;
  maxOutputTokens: number;
  temperature?: number;
  topP?: number;
  stop: readonly string[];
  toolChoice: ToolChoice;
  reasoning: ReasoningLevel;
  cacheRetention: CacheRetention;
  timeoutMs: number;
  retry: false | RetryPolicy;
  contextPolicy: ContextNormalizationPolicy;
  protocolOptions: ProtocolOptions<TProtocol>;
  metadata?: Readonly<Record<string, JsonValue>>;
}
```

公共字段的合并顺序为：`ProtocolAdapter.contract.requestDefaults` → `ProtocolBinding.requestDefaults` → `ModelDefinition.requestDefaults` 与选中 `ModelProtocolProfile.protocolDefaults` → Runtime `commonDefaults`/匹配当前 protocol 的 `protocolDefaults` → per-call options；后者覆盖前者。`ModelDefinition` 只携带 core common defaults和稳定 `protocolProfileId`，避免 core 反向依赖 protocol declaration map；模型特有的 typed protocol options/compatibility/reasoning map 由 Provider binding profile 维护。`protocolOptions` 由 contract 在各自 schema 内按同一顺序独立合并，不能覆盖 endpoint、auth、timeout、retry、model ID 或公共字段。所有值随后通过 common schema、model capability/limits 和 protocol schema；硬安全上限只能拒绝或收紧，不能被 options 放宽。

`timeoutMs` 覆盖 scope 解析、认证/刷新、context、连接和读取到终态的总 deadline；单次重试必须共享剩余预算。`cacheRetention` 默认 `short`：`none` 禁止包主动放 cache marker，`short` 使用协议普通 ephemeral cache，`long` 是可降级偏好；binding 不支持 long 时回退 short 并产生 `CACHE_RETENTION_DOWNGRADED` diagnostic，不伪装已获得长缓存。`RequestCredentialOverride` 仍需授权 scope，并经过宿主 `CredentialOverridePolicy`，只对当前请求有效。override 默认禁用目录持久缓存、session 复用和 ambient fallback。`ContextNormalizationPolicy` 固定图片不支持时的 reject/placeholder、replay scope、incomplete turn 与 token-budget 策略，不允许 adapter 自行猜测。

`trustedRequest` 保留 PI 的 headers/transformHeaders/payload/response 调试与修改能力，但属于显式 TCB，不是可从 HTTP/Agent tool 参数反序列化的普通数据。未配置 `TrustedRequestPolicy` 或 policy 拒绝时，在序列化/联网前进入非重试失败终态 `REQUEST_CUSTOMIZATION_FORBIDDEN`。静态 `headers` 先合入，`transformHeaders` 随后只看到非 protected header；两者的结果都在 auth 合并前规范化。protected/auth/signature/host/content-length header 不能新增、覆盖或删除，冲突必须失败而不是静默忽略。`transformPayload` 在 protocol 生成 JSON 后、签名与发送前执行；返回值重新经过 protocol payload schema、prototype/深度/byte limits，不能改变 endpoint/model/auth 字段。`onResponse` 在消费 body 前调用，只看到 policy allowlist 中的 header value；默认 allowlist 为空，永不暴露 `set-cookie`、认证 challenge 或 secret-shaped header。hook 失败成为稳定的非重试 invalid-request error，不能触发另一份请求。

## 快速开始

下面是 Node.js 本地开发的最小显式装配。它展示完整控制面：应用自己读取环境变量并包装 secret、注册 Provider、按 scope 解析 model handle，再调用 Runtime。包导入本身不会读取环境变量、注册 Provider 或发请求。

实现完成后把示例保存为 `packages/ai/examples/quickstart.ts`，从仓库根运行：

```text
pnpm install
pnpm --filter @duoduo/ai build
OPENAI_API_KEY=... OPENAI_MODEL=... \
  pnpm --filter @duoduo/ai example:quickstart
```

`package.json` 必须提供这个脚本，consumer compile fixture 编译同一示例；示例环境变量只在进程内作为 request override，退出后不会落盘。需要跨命令持久化时使用 CLI 章节的 `duoduo-ai auth login`，不要把 `.env` 当 CredentialStore。

```ts
import { createAi, secret } from '@duoduo/ai';
import { InMemoryCredentialStore } from '@duoduo/ai/auth';
import { createLocalScopeAuthority } from '@duoduo/ai/auth/node';
import { InMemoryCatalogStore } from '@duoduo/ai/catalog';
import { openAiProvider } from '@duoduo/ai/providers/openai';
import {
  createAllowlistNetworkPolicy,
  createFetchTransportDriver,
} from '@duoduo/ai/transport/node';

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const local = createLocalScopeAuthority({
  tenantId: 'local',
  subjectId: 'developer',
});

const ai = createAi({
  credentialStore: new InMemoryCredentialStore(),
  catalogStore: new InMemoryCatalogStore(),
  transport: createFetchTransportDriver(),
  networkPolicy: createAllowlistNetworkPolicy({
    httpsHosts: ['api.openai.com'],
  }),
  scopeAuthority: local.authority,
  ambientAuthPolicy: { allow: () => false },
  credentialOverridePolicy: {
    allow: (_scope, provider, override) =>
      provider.id === 'openai' && override.type === 'api_key',
  },
});

ai.providers.register(openAiProvider());

const credentialOverride = {
  type: 'api_key' as const,
  secret: secret(requireEnvironment('OPENAI_API_KEY')),
};

try {
  const model = await ai.models.require(
    {
      providerInstanceId: 'openai',
      modelId: requireEnvironment('OPENAI_MODEL'),
    },
    local.scope,
    { credentialOverride },
  );

  const response = await ai.complete(
    model,
    {
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: '只回复 pong' }],
        },
      ],
    },
    {
      scope: local.scope,
      credentialOverride,
    },
  );

  if (response.status !== 'completed') {
    throw new Error(`${response.error.code}: ${response.error.message}`);
  }

  console.log(response.content);
} finally {
  await ai.dispose();
}
```

为保证这个示例只依赖公共 export map，第一版必须提供以下零副作用首方装配件：

| 导出                             | 归属             | 语义                                                                                 |
| -------------------------------- | ---------------- | ------------------------------------------------------------------------------------ |
| `InMemoryCredentialStore`        | `auth`           | `identityLifetime: 'process-local'`；权威 revision/clock、完整 lease/CAS；仅本地开发 |
| `createLocalScopeAuthority()`    | `auth/node`      | 返回 opaque scope/authority；`fingerprintLifetime: 'process-local'`，禁止序列化任务  |
| `InMemoryCatalogStore`           | `catalog`        | 进程内实现 store-authoritative refresh ticket/TTL；仅测试与本地开发                  |
| `createFetchTransportDriver()`   | `transport/node` | 基于 Node 22 fetch 的 manual-redirect driver，不内置全局代理或环境读取               |
| `createAllowlistNetworkPolicy()` | `transport/node` | 默认拒绝，逐 host/origin/purpose 放行；未列出的 HTTP、私网和 redirect 一律拒绝       |

生产部署必须替换内存 store 和 local authority：CredentialStore 使用 `CredentialRecordSealer + AEAD/KMS`，CatalogStore 使用共享持久后端，scope authority 从已认证请求上下文产生 handle，并让 scope fingerprint keyring、operation codec keyring 与 verifier keyring 跨实例一致。只有这些端口确实共享且通过 contract test 时才能声明 `cross-runtime`；错误声明属于部署配置错误，不能靠重试修复。共享服务默认禁止 ambient auth；如果允许 request override，应按 tenant、Provider 和 scheme 收窄 policy。应用还应在 `finally`/shutdown hook 中 `dispose()`，并把 Provider origin、OAuth issuer、catalog/media 目的分别列入 NetworkPolicy，而不是允许任意 HTTPS。

API-key 登录而非 per-request override 时，调用方通过 `ai.auth.login(providerId, 'api_key', scope, interaction)` 让 `AuthInteraction.prompt({ type: 'secret', ... })` 收集 key，并由 CredentialStore 持久化；后续 `models.require()`/`complete()` 不再传 override。OAuth 使用同一个入口选择 `'oauth'`。图片调用先通过 `ai.images.models.require()` 获取 `ImageModelHandle`，再调用 `images.stream()`/`generate()`；任务式结果按“图片流与任务恢复”章节处理。

<a id="provider-protocol"></a>

## Provider 与 ProtocolAdapter

```ts
type ProviderConfigurationValue =
  | Readonly<{ kind: 'json'; value: JsonValue }>
  | Readonly<{ kind: 'url'; value: string }>
  | Readonly<{ kind: 'origin'; value: string }>;

interface ProviderIdentityDescriptor {
  version: 1;
  configuration: Readonly<Record<string, ProviderConfigurationValue>>;
}

interface DerivedOriginPolicyDescriptor {
  id: string;
  version: number;
  configuration: Readonly<Record<string, ProviderConfigurationValue>>;
}

interface AuthBindingDescriptor {
  version: 1;
  allowedOrigins: readonly string[];
  issuer?: string;
  audience?: string;
  derivedOriginPolicy?: DerivedOriginPolicyDescriptor;
}

interface ProviderContractSource {
  kind: 'pi' | 'official' | 'fixture';
  locator: string;
  digest?: string;
}

interface ProviderProtocolManifest {
  capability: AiCapabilityId;
  protocol: string;
  profileIds: readonly string[];
  authSchemes: readonly string[];
  endpointBranchIds: readonly string[];
  requestFixtureIds: readonly string[];
  streamFixtureIds: readonly string[];
  errorFixtureIds: readonly string[];
  sources: readonly ProviderContractSource[];
}

interface ProviderContractManifest {
  schemaVersion: 1;
  providerKind: string;
  bindings: readonly ProviderProtocolManifest[];
}

interface ProviderCapabilityMap {
  chat: ChatProviderBinding;
  images: ImageProviderBinding;
  videos: VideoProviderBinding;
}

type ProviderCapabilities = Partial<ProviderCapabilityMap>;

interface Provider {
  id: string;
  kind: string;
  name: string;
  identity: ProviderIdentityDescriptor;
  contractManifest: ProviderContractManifest;
  auth: ProviderAuth;
  capabilities: ProviderCapabilities;
}

interface ProviderSnapshot {
  id: ProviderInstanceId;
  kind: string;
  name: string;
  registrationGeneration: string;
  configFingerprint: string;
  authPolicyFingerprint: string;
}

interface ChatProviderBinding {
  catalogCompatibilityVersion: string;
  modelSource: ModelSource;
  protocols: readonly ProtocolBinding[];
  filterModels?(
    models: readonly ModelDefinition[],
    context: ModelFilterContext,
  ): readonly ModelDefinition[];
}
```

`kind` 是内建 Provider 种类，例如 `qwen`、`openai`、`doubao`、`kling` 或某个综合平台；`id` 是运行时注册实例的唯一标识。工厂默认使用 `kind` 作为 `id`，但允许调用方同时注册 `qwen-cn`、`qwen-sg` 或多个企业网关实例。所有模型定义的 `providerInstanceId` 始终引用实例 `id`，避免请求被路由到错误账号、渠道或区域。Provider 可以只提供一种 capability，也可以同时提供 chat/images/videos；认证只定义一次。未来新增领域同时通过 declaration merging 扩展 core 的 `AiCapabilityMap` 和 provider 层的 `ProviderCapabilityMap`，通用 registry/catalog key 只依赖前者，不形成 core → providers 反向依赖。

Provider 不能提交自己算好的 opaque fingerprint。Runtime 先按 tagged kind 规范化 `identity.configuration`：`json` 使用 RFC 8785/JCS（UTF-8、有限数值、对象 key 排序），`url` 要求无 userinfo/fragment 的绝对 URL并规范 hostname/default port，`origin` 还要求 path/query 为空；字段名排序后计算 `SHA-256(canonical(['@duoduo/ai/provider-config',1,kind,id,configuration]))` 的 base64url 值。Provider 因而不能把 URL 混成 Runtime 无法识别的普通字符串。`configuration` 只含影响 region/workspace/base URL/routing/catalog/profile 的非秘密值；不含函数、时间、随机数、环境变量实际值或 `SecretValue`。contract suite 以 factory schema 的字段清单证明每个安全相关 option 均被覆盖，并用 secret canary 证明它不会进入 descriptor。

`authPolicyFingerprint` 同样由 Runtime 从 `ProviderAuth.binding.descriptor` 计算：`SHA-256(canonical(['@duoduo/ai/auth-policy',1,kind,id,normalizedDescriptor]))`。动态 callback 永不参与序列化；其 `id/version/configuration` 参与 descriptor，callback 行为不兼容变化必须递增 version。登录/解析 credential 后得到的具体 `AuthBinding.fingerprint` 是另一个值，绑定该 credential 实际允许的 origin/issuer/audience；handle、session、credential record 与 operation 使用后者，ProviderSnapshot 使用前者，二者不得混称。

重复注册同一 `id` 直接失败；必须先 unregister，再注册才会得到新的随机/单调 `registrationGeneration`。同一 Provider 的每个 capability namespace 内 protocol ID 必须唯一，重复项在注册时失败；不同 capability 可以合法复用同名 ID。每个 model.protocol 必须在所属 capability 中恰好匹配一个 binding。`ProviderSnapshot` 只含非秘密、冻结的路由身份，进入请求、catalog/session key 和进程内 handle；旧请求继续使用旧快照，新请求只见新 generation。`registrationGeneration` 不得进入可持久化 operation claims，因为它无法跨 Runtime 重算；媒体任务改用稳定的 `providerOperationBindingFingerprint`。

`contractManifest` 是 checked-in、strict-schema、无秘密的机器可读注册表。每个矩阵 binding 必须列出所有认证/endpoint 分支、完整 profile ID、request/stream/error fixture ID 和精确来源；空数组不允许用来跳过真实分支。PI parity 的来源映射固定为：模型/profile 数据来自 pinned commit 的 `src/models.generated.ts` 与 `src/providers/*.models.ts`，Provider/auth/endpoint 来自 `src/providers/*.ts`，协议 wire 来自 `src/api/*.ts`，OAuth 来自 `src/auth/oauth/*.ts`，工具/overflow/testing 来自 `src/utils/{validation,overflow}.ts` 与 `src/providers/faux.ts`。Qwen、豆包、Kling 与新增视频 binding 只使用本文链接的官方文档和经审查 fixture。Productization gate 生成“矩阵行 ↔ manifest binding ↔ fixture file”报告，任何缺失都失败。

`await ai.models.find(ref, scope)` 返回 scope-bound、只读的已验证 handle 或 `undefined`，`require()` 对不可见/缺失模型 reject typed control-plane error。`ModelRef` 只用于这些异步解析 API；推理入口只接受 Runtime 返回的 branded handle，不接受 ref 或调用方构造的裸 `ModelDefinition`。

```ts
interface ResolvedRequestAuth {
  headers?: Readonly<Record<string, string | SecretValue>>;
  query?: Readonly<Record<string, string | SecretValue>>;
  forbiddenHeaders?: readonly string[];
  signing?: BoundSigningCapability;
  endpointHints?: Readonly<EndpointHints>;
}

declare const signingCapabilityBrand: unique symbol;

interface BoundSigningCapability {
  readonly [signingCapabilityBrand]: true;
  readonly authBindingFingerprint: string;
}

interface EndpointContext<TProtocol extends string = string> {
  provider: Readonly<ProviderSnapshot>;
  model: Readonly<ModelDefinition<TProtocol>>;
  endpointHints?: Readonly<EndpointHints>;
  providerState?: JsonValue;
  options: Readonly<ResolvedStreamOptions<TProtocol>>;
  signal: AbortSignal;
}

interface HeaderContext<
  TProtocol extends string = string,
> extends EndpointContext<TProtocol> {
  endpoint: URL;
}

interface ProtocolBinding<TProtocol extends string = string> {
  protocol: TProtocol;
  loadAdapter(): Promise<ProtocolAdapter<TProtocol>>;
  replayCodecs?: readonly ProtocolReplayCodecSet<TProtocol>[];
  resolveEndpoint(context: EndpointContext<TProtocol>): Promise<URL> | URL;
  resolveHeaders?(
    context: HeaderContext<TProtocol>,
  ):
    | Promise<Readonly<Record<string, string>>>
    | Readonly<Record<string, string>>;
  requestDefaults?: Readonly<StreamRequestDefaults<TProtocol>>;
  defaultProfile: Readonly<ModelProtocolProfile<TProtocol>>;
  profiles?: Readonly<Record<string, ModelProtocolProfile<TProtocol>>>;
  resolveDiscoveredModelProfile?(
    context: Readonly<{
      model: ModelDefinition<TProtocol>;
      providerState?: JsonValue;
    }>,
  ): string | Promise<string>;
  contextPolicy?: ContextPolicy<ProtocolCompatibility<TProtocol>>;
  retrySafety: RetrySafety;
}

type ReasoningWireValue = string | number | boolean | null;
type ReasoningLevelMap = Readonly<
  Partial<Record<ReasoningLevel, ReasoningWireValue>>
>;

interface ModelProtocolProfile<TProtocol extends string = string> {
  id: string;
  compatibility: Readonly<ProtocolCompatibility<TProtocol>>;
  reasoningLevelMap?: ReasoningLevelMap;
  protocolDefaults?: Readonly<ProtocolOptions<TProtocol>>;
}

type RetrySafety =
  | Readonly<{ mode: 'before-dispatch-only' }>
  | Readonly<{ mode: 'idempotent' }>
  | Readonly<{
      mode: 'idempotency-key';
      headerName: string;
      keyVersion: number;
    }>;

interface ProtocolAdapter<TProtocol extends string = string> {
  id: TProtocol;
  contract: ProtocolContract<TProtocol>;
  run(
    request: ProtocolRequest<TProtocol>,
    sink: ProtocolEventSink,
  ): Promise<ProtocolTerminal>;
}

interface ProtocolContract<TProtocol extends string = string> {
  requestDefaults?: Readonly<StreamRequestDefaults<TProtocol>>;
  parseOptions(input: unknown): ProtocolOptions<TProtocol>;
  mergeOptions(
    layers: readonly (ProtocolOptions<TProtocol> | undefined)[],
  ): ProtocolOptions<TProtocol>;
  parseCompatibility(input: unknown): ProtocolCompatibility<TProtocol>;
}

interface ProtocolTerminalBase {
  usage?: Usage;
  responseModelId?: string;
  responseId?: string;
  replay?: ReplayMetadata;
  diagnostics?: readonly AiDiagnostic[];
}

type ProtocolTerminal =
  | (ProtocolTerminalBase & {
      status: 'completed';
      finishReason: CompletedFinishReason;
    })
  | (ProtocolTerminalBase & { status: 'failed'; error: AiError })
  | (ProtocolTerminalBase & {
      status: 'cancelled';
      error: AiError & { category: 'cancelled' };
    });

type StripSequence<T> = T extends { sequence: number }
  ? Omit<T, 'sequence'>
  : T;
type ProtocolContentEvent = StripSequence<
  Exclude<
    AiStreamEvent,
    | { type: 'response_start' }
    | { type: 'response_end' }
    | { type: 'response_error' }
  >
>;

interface ProtocolEventSink {
  publish(event: ProtocolContentEvent): Promise<void>;
}

interface ProtocolRequest<TProtocol extends string = string> {
  provider: Readonly<ProviderSnapshot>;
  model: Readonly<ModelDefinition<TProtocol>>;
  context: Readonly<PreparedContext>;
  compatibility: Readonly<ProtocolCompatibility<TProtocol>>;
  reasoningLevelMap?: ReasoningLevelMap;
  options: Readonly<ResolvedStreamOptions<TProtocol>>;
  transport: RequestTransport;
  resources: ResourceLoader;
  signal: AbortSignal;
  session?: SessionHandle;
}
```

Provider 不自行实现通用流协议。`ProtocolBinding` 明确绑定 adapter、完整 operation URL、headers、默认参数和逐模型 profile，一个 Provider 可按 `model.protocol` 路由到多个 adapter；表格中的 base endpoint 必须由 resolver 与协议 route 确定性拼成最终 URL，adapter 不再追加 path/query。`ResolvedRequestAuth` 只存在于 Runtime 的认证装配阶段，永远不传给 adapter；endpoint resolver 只能接收认证层产生的非秘密、带类型 `endpointHints`（GitHub Copilot 的账号 endpoint 即走此通道），并用当前 binding 的 endpoint policy 校验 origin/audience，不能读取原始 credential 或任意 token metadata。

每个模型最终必须解析到一个完整 `ModelProtocolProfile`：`defaultProfile` 与 `profiles` 构成 profile registry，record key 必须等于内部 `profile.id` 且全局唯一，default 不能在 profiles 中重复。静态/explicit 条目携带受信 `protocolProfileId`，动态条目由 `resolveDiscoveredModelProfile()` 基于已验证模型字段和 `providerState` 选择；resolver 不接收 raw credential、auth header 或 scope。未命中 profile、重复 ID、未知 key、profile schema 失败均使目录 materialization 失败。missing reasoning key 表示使用协议默认映射，`null` 表示明确不支持；若 `ModelCapabilities.thinkingLevels` 宣称支持但映射为 null，注册失败。Runtime 把 profile 的 compatibility、reasoning map 和 protocol defaults 作为 catalog digest/handle identity 的一部分；任何不兼容映射变化必须递增 `catalogCompatibilityVersion`。这样同一 Together/OpenCode/OpenRouter binding 可安全表达 Kimi、DeepSeek、GPT-OSS、MiniMax 等不同模型的 wire 行为。

Runtime 在 endpoint policy 通过后生成唯一的内部 `FinalRequestTarget`，并消耗掉认证 query/header。query key 区分大小写：auth query 与 resolver URL 已有同名 key 一律 fail closed，adapter 不得追加、删除或覆盖 query。header name 按 ASCII 大小写不敏感规范化为小写，先合入 protocol/provider binding headers，再处理 `forbiddenHeaders`，最后合入 auth headers；同一层 casing 重复或 auth 与已有同名 header 都直接报配置错误，不通过 secret reveal 比较“是否相等”。auth 产生的 header 以及 `authorization`、`proxy-authorization`、`x-api-key`、`api-key`、`cf-aig-authorization` 都是 protected，adapter/transport hook 不得覆盖或删除。`forbiddenHeaders` 会在认证合并前移除 binding/ambient 值并锁定禁止后续加入，Cloudflare Gateway 用它禁止 `authorization` 与 `x-api-key`。Transport 只可按受控策略补充 trace/user-agent 等非 protected header。

`ProtocolRequest` 因而只拿到已绑定 `FinalRequestTarget` 的 request-scoped `RequestTransport` 和冻结的 compatibility profile，看不到或修改 endpoint/auth material。协议需要的 content type、version 或 beta header必须由 protocol/binding resolver 预先声明。签名在 body 与最终 URL/header 均确定后由可信 Transport seam 施加；adapter 永远拿不到 CredentialStore、refresh token 或 reveal 权限。`compatibility` 不能被调用方 options 覆盖，并在装配时通过对应 protocol schema 后才进入 request。

`BoundSigningCapability` 是不可调用的 opaque token，只能由 Transport 在 NetworkPolicy 通过后使用；创建时已绑定 auth fingerprint、允许 origin、service/region/audience 和过期时间。Adapter 不能借 AWS/Google ambient credential 签任意 URL，也不能扩展 capability 的受众。

公共 `AiResponseStream` 只由 Runtime 创建和拥有。Adapter 的 `run()` 只能向 attempt-local `ProtocolEventSink` 写文本/reasoning/tool 增量并返回判别式 `ProtocolTerminal`，不能产生公共 `response_start`、`response_end` 或 `response_error`。预期的 Provider payload failure、远端 cancelled 和成功 diagnostics 必须通过 terminal 表达；throw/reject 只保留给 bug、transport exception 和 abort，由 Runtime 规范化。Runtime 负责 block 状态机、聚合、Usage/Cost、唯一终态与错误映射。

自定义兼容服务通过工厂创建，无需修改核心注册表：

```ts
createOpenAiCompatibleProvider({
  id: 'internal-gateway',
  baseUrl: 'https://models.example.com/v1',
  auth: apiKeyAuth({ environmentVariable: 'INTERNAL_GATEWAY_API_KEY' }),
  models: [],
});
```

<a id="call-flow"></a>

## 统一调用流

```text
ai.stream()
  → 查找并验证 ModelDefinition
  → 查找所属 Provider
  → 解析 API Key / OAuth / ambient credential
  → 必要时按已授权 CredentialScopeKey/auth identity singleflight，以 lease + CAS 刷新 token
  → 规范化跨 Provider 消息历史
  → 根据 model.protocol 选择 ProtocolBinding 并解析 endpoint/header
  → 延迟加载 ProtocolAdapter
  → adapter 构建厂商请求
  → Transport 执行 fetch / SSE / WebSocket
  → adapter 解析厂商事件
  → 输出统一 AiStreamEvent
  → 汇总 AssistantResponse、Usage、Cost 与 Diagnostics
```

Runtime 在调用开始时获取一份不可变 Provider、Model 和 Context 快照。流执行期间的目录刷新或 Provider 重注册不得改变已发起请求的语义。

Runtime 在 logical call 开始时只发一个 `response_start`。认证、adapter 懒加载或 attempt 在首个内容块公开前失败时，只有同时满足 retry policy、transport phase 与 binding `RetrySafety` 才能创建新的内部 sink/attempt，丢弃前一 attempt 的未公开 metadata；首个 text/reasoning/tool start 一旦进入公共 stream 就锁定该 attempt，之后禁止隐式重试。只有最终 attempt 的 terminal 被折叠为公共终态，因此重试不会泄漏重复 start/end。

## 流协议

```ts
type AiStreamEvent =
  | {
      type: 'response_start';
      sequence: number;
      requestId: string;
      startedAt: number;
      model: Readonly<ModelDefinition>;
    }
  | {
      type: 'text_start' | 'reasoning_start';
      sequence: number;
      itemId: string;
      contentIndex: number;
    }
  | {
      type: 'tool_call_start';
      sequence: number;
      itemId: string;
      contentIndex: number;
      toolCallId: string;
      name?: string;
    }
  | {
      type: 'text_delta' | 'reasoning_delta';
      sequence: number;
      itemId: string;
      contentIndex: number;
      delta: string;
    }
  | {
      type: 'tool_call_delta';
      sequence: number;
      itemId: string;
      contentIndex: number;
      argumentsDelta: string;
      nameDelta?: string;
    }
  | {
      type: 'text_end';
      sequence: number;
      itemId: string;
      contentIndex: number;
      replay?: ReplayMetadata;
    }
  | {
      type: 'reasoning_end';
      sequence: number;
      itemId: string;
      contentIndex: number;
      replay?: ReplayMetadata;
    }
  | {
      type: 'tool_call_end';
      sequence: number;
      itemId: string;
      contentIndex: number;
      toolCall: ToolCallContent;
    }
  | {
      type: 'response_end';
      sequence: number;
      response: Extract<AssistantResponse, { status: 'completed' }>;
    }
  | {
      type: 'response_error';
      sequence: number;
      response: Exclude<AssistantResponse, { status: 'completed' }>;
    };

interface AiResponseStream extends AsyncIterable<AiStreamEvent> {
  result(): Promise<AssistantResponse>;
  abort(reason?: string): void;
}
```

流状态机必须保证：

1. `response_start` 恰好一次且为首事件；只有无需异步工作的纯同步编程错误可在返回 stream 前抛出，因此不产生事件。scope、目录、认证、session、adapter load 等 producer 启动后的失败一律产生失败终态。
2. `response_end` 与 `response_error` 互斥，且必须恰好出现一个。
3. 每个内容块都有稳定且唯一的 `itemId` 与 `contentIndex`；index 按逻辑块首次出现从 0 单调递增且不复用。不同块可交错，但同一块严格按 start → delta\* → end 排序；Runtime 独占文本聚合，`text_end`/`reasoning_end` 只携带经校验、限长和冻结的 block-level replay metadata，不携带第二份文本真相，`tool_call_end` 则携带完整的结构化工具块。无可读 delta 的加密 reasoning 可以 start → end(replay)。成功终态前所有已开始块必须结束，错误/取消终态则隐式关闭仍开放的块且不得伪造正常 end。
4. tool call 增量可以携带未完成 JSON 和分段 name；`tool_call_end` 必须携带完整的已收集 `rawArguments`，且 `toolCall.id === toolCallId`。正常 `tool_calls`/`stop` 终止要求成功解析为 `status: 'complete'`，否则以 protocol error 终止；`length`/`content_filter` 可关闭为 `status: 'incomplete'`。并行 tool call 依靠不同 `itemId` 区分。
5. `response_end` 携带唯一成功快照；`response_error` 携带相同聚合器产生的失败/取消 partial response。UI、日志和未来 Agent 看到的是同一个对象语义。
6. `result()` 可在迭代前、迭代中或迭代后调用，多次调用返回同一 Promise。运行阶段失败与取消 resolve 为失败终态，不 reject；只有参数形状、伪造 handle、runtime 已 dispose 等能在任何 Promise/IO 前确定的编程错误可由 `stream()` 同步抛出。
7. 一个 stream 最多有一个 AsyncIterator；第二个 iterator 立即抛出 `STREAM_ALREADY_OBSERVED`。`result()` 独立聚合，不从 iterator 队列抢事件。
8. producer 在第一次 `next()` 或 `result()` 时惰性启动。若 `result()` 先启动且还没有 iterator，stream 永久进入 unobserved drain 模式，不创建事件队列，因此 `complete()` 永不因无人消费而死锁；此后申请 iterator 立即抛出 `STREAM_OBSERVATION_CLOSED`，不存在缺少 `response_start`/block start 的 suffix observer。若 iterator 先取得观察权，它从 `response_start` 开始观察完整序列，期间调用 `result()` 不改变观察模式。
9. iterator 的 `return()`（包括 `for await` 提前 `break`）永久关闭事件订阅，producer 切回 drain 模式并继续完成 `result()`，不能再附加新 iterator；只有 `abort()` 或传入的 `AbortSignal` 才取消底层请求。取得 iterator 后又既不消费也不 `return()` 属于调用方违反契约，背压可暂停 producer。
10. 内部 writer 使用可等待的 `publish(event): Promise<void>`。观察队列达到上限时 adapter 等待消费者腾出容量；只允许对相邻、同 `itemId`、同类型 delta 做无损字符串合并，不得丢弃或重排控制事件、tool-call 终态或错误。
11. 流拥有明确的内部 `close()` / `fail()` 通道，所有 detached task 必须显式处理 rejection。终态之后的 Provider 事件记为脱敏 diagnostic 并丢弃，不能改变结果。

## 错误协议

```ts
interface AiDiagnostic {
  code: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  details?: Readonly<Record<string, JsonValue>>;
}

interface AiError {
  code: string;
  category:
    | 'auth'
    | 'rate_limit'
    | 'network'
    | 'timeout'
    | 'provider'
    | 'protocol'
    | 'invalid_response'
    | 'invalid_request'
    | 'unsupported_capability'
    | 'internal'
    | 'cancelled';
  message: string;
  retryable: boolean;
  providerInstanceId?: string;
  protocol?: string;
  status?: number;
  requestId?: string;
  retryAfterMs?: number;
  diagnostics?: readonly AiDiagnostic[];
}

declare class AiConfigurationError extends Error {
  readonly code: string;
  readonly details?: Readonly<Record<string, JsonValue>>;
}

declare class AiControlPlaneError extends Error {
  readonly code: string;
  readonly error: AiError;
}
```

错误分为：

- 同步编程错误：重复 Provider、注册时无效模型定义、明显非法的参数形状、伪造 handle、已 dispose Runtime 等无需 authority/IO 即可判断的错误。这些同步 registry/`stream()` 操作直接抛出 `AiConfigurationError`。
- 流运行错误：scope authority、动态模型解析、认证/OAuth 刷新、session acquisition、adapter load、限流、网络、超时、返回数据校验与取消。`stream()` 返回后，它们一律通过 `response_error` 与失败终态响应呈现，不再依赖消费者捕获后台 Promise 异常。
- control-plane 错误：`models.*`、`auth.*`、`sessions.*`、operation serialize/parse/resume preflight 等 Promise API 没有流终态，因而以带 `AiError` cause/code 的 `AiControlPlaneError` reject；abort 使用 `CANCELLED` reject。`models.refresh()` 仅把单个 Provider discovery 失败收进 `ModelRefreshReport.errors`，但 authority、调用参数、store 整体不可用和 abort 仍 reject。`auth.status` 的 `unconfigured/backoff/reauth_required` 是成功读取到的业务状态，不是异常；store/权限失败才 reject。

`invalid_request` 表示调用方可修正的 schema/options/context 问题，`unsupported_capability` 表示目标模型/协议不支持所请求功能；两者固定 `retryable: false`，未来 Agent 不应通过盲目重试同一模型处理。上游 payload/事件不合约仍属于 `protocol` 或 `invalid_response`。

图片 operation 的错误分类固定：override + `asyncOperation: true`/resumable model 缺 verifier 是调用 `images.stream()` 时可确定的同步 `AiConfigurationError`；direct model 不要求 verifier，也永远拿不到 operation sink。没有持久 codec 并不妨碍进程内 operation，只让 `serializeOperation()` 以及随后对 external ref 的 `resume()` reject `OPERATION_NOT_PERSISTABLE`；`parseOperation()` 仍只做长度/外形包装。环境变量、内存 store、process-local ambient/verifier 等 auth identity 在 serialize 时 reject `OPERATION_AUTH_NOT_PERSISTABLE`，process-local scope authority 则 reject `OPERATION_SCOPE_NOT_PERSISTABLE`。token 外形错误在 parse 报 `OPERATION_TOKEN_INVALID`；codec 完整性、claims schema、过期或 binding 不匹配只在 resume preflight 成为非重试 `AiControlPlaneError`，其内部 category 为 `invalid_request`。恢复 override 缺失或不匹配为非重试 `auth`；codec/verifier/scope-fingerprint key 暂不可用仍 fail closed，并按 typed result 保留 retryable，绝不在未校验身份时轮询 Provider operation。

原始 Provider 错误仅保留经限长、脱敏和结构化后的诊断信息。API Key、OAuth token、Cookie、Authorization header 和完整敏感 prompt 不得进入错误、日志或 telemetry。

### 稳定错误码

`code` 是机器分支依据，`message` 只供人阅读且不承诺稳定。第一版至少冻结下表；实现可以在同一语义下增加更细 diagnostics，但不能复用已有 code 表示另一件事，也不能要求调用方解析 message/HTTP body。

| 阶段                  | 稳定 code                                                                                                                                                                                                                                                                                                                                                                                                                | 固定语义                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 配置/同步调用         | `RUNTIME_DISPOSED`, `PROVIDER_ALREADY_REGISTERED`, `PROVIDER_INVALID`, `PROTOCOL_BINDING_INVALID`, `PROTOCOL_REPLAY_CODEC_CONFLICT`, `MODEL_HANDLE_INVALID`, `MODEL_HANDLE_STALE`, `REQUEST_OPTIONS_INVALID`, `RUNTIME_POLICY_INVALID`, `OPERATION_CREDENTIAL_VERIFIER_REQUIRED`                                                                                                                                         | `AiConfigurationError`；未启动任何异步 producer/Provider 请求                                |
| scope/auth            | `CREDENTIAL_SCOPE_MISMATCH`, `AUTH_UNCONFIGURED`, `AUTH_METHOD_UNSUPPORTED`, `AUTH_BINDING_MISMATCH`, `AMBIENT_AUTH_FORBIDDEN`, `CREDENTIAL_OVERRIDE_FORBIDDEN`, `CREDENTIAL_STORE_CORRUPT`, `CREDENTIAL_CODEC_KEY_UNAVAILABLE`, `REFRESH_LEASE_LOST`, `REAUTH_REQUIRED`                                                                                                                                                 | category `auth`；store corruption/key unavailable 不得降级为未登录                           |
| catalog/model         | `MODEL_NOT_FOUND`, `MODEL_NOT_VISIBLE`, `MODEL_IDENTITY_CHANGED`, `CATALOG_UNAVAILABLE`, `CATALOG_STORE_CORRUPT`, `CATALOG_NETWORK_DISABLED`                                                                                                                                                                                                                                                                             | control-plane reject 或流失败；不可见与不存在可对外统一 message，code 仅给已授权宿主         |
| transport/provider    | `NETWORK_POLICY_DENIED`, `REDIRECT_FORBIDDEN`, `NETWORK_ERROR`, `REQUEST_TIMEOUT`, `RATE_LIMITED`, `PAYLOAD_TOO_LARGE`, `PROVIDER_ERROR`                                                                                                                                                                                                                                                                                 | category 分别为 network/timeout/rate_limit/provider；retryable 由明确状态与 attempt 阶段决定 |
| protocol/capability   | `PROTOCOL_VIOLATION`, `INVALID_RESPONSE`, `UNSUPPORTED_CAPABILITY`, `CONTEXT_INVALID`, `CONTEXT_OVERFLOW`, `TOOL_CALL_INVALID`, `REQUEST_CUSTOMIZATION_FORBIDDEN`                                                                                                                                                                                                                                                        | Provider 返回不合约、模型不支持或请求上下文无效；后四类永不盲目重试                          |
| stream observer       | `STREAM_ALREADY_OBSERVED`, `STREAM_OBSERVATION_CLOSED`                                                                                                                                                                                                                                                                                                                                                                   | iterator 使用错误；不改变 producer 已有终态                                                  |
| image operation       | `OPERATION_NOT_AVAILABLE`, `OPERATION_NOT_PERSISTABLE`, `OPERATION_AUTH_NOT_PERSISTABLE`, `OPERATION_SCOPE_NOT_PERSISTABLE`, `OPERATION_TOKEN_INVALID`, `OPERATION_EXPIRED`, `OPERATION_BINDING_MISMATCH`, `OPERATION_CREDENTIAL_REQUIRED`, `OPERATION_CREDENTIAL_MISMATCH`, `OPERATION_CODEC_KEY_UNAVAILABLE`, `OPERATION_CREDENTIAL_KEY_UNAVAILABLE`, `OPERATION_SCOPE_KEY_UNAVAILABLE`, `OPERATION_MODEL_UNAVAILABLE` | detach/serialize/parse/resume 的精确 preflight 失败；在安全校验前不发 operation poll         |
| cancellation/internal | `CANCELLED`, `INTERNAL_ERROR`                                                                                                                                                                                                                                                                                                                                                                                            | cancelled 可预期；未知异常统一脱敏为 internal、非重试，并保留仅限安全诊断的 correlation ID   |

Provider HTTP code/message 只能进入受限 `diagnostics`，公共 code 由统一映射表产生：401/403 通常映射 auth，429 映射 rate limit，受支持的 5xx 映射 provider/network；但 Provider 明确的 payload schema 优先于仅看状态码。相同错误无论出现在 Promise control plane、文本流还是图片流，code/category/retryable 都保持一致，只改变承载方式。`INTERNAL_ERROR` 不包含 stack、原始 cause、request body 或 secret；开发模式如需 stack，只能交给进程内受信 sink，不能进入公共响应。

## 取消、超时与重试

- 同一 `AbortSignal` 贯穿认证、目录刷新、transport、SSE/WebSocket 解析和 Provider hook。
- “尚未产生可见输出”只是必要条件，不是充分条件；还必须满足 binding 的 `RetrySafety` 与 transport failure phase。
- 已经输出文本、reasoning 或 tool call 后不进行隐式重试，防止重复内容和重复工具调用。
- 重试遵循 `Retry-After` 与可配置最大延迟；服务端要求的延迟超过上限时立即以可重试错误终止，让上层向用户显示。
- 取消是协作式的，但 adapter 必须把 signal 传给底层 SDK 或 transport，不得只在上层更改状态。

`not_dispatched` 可按 retry policy 重试；`response_received` 只有明确 429/受支持临时状态且 binding 是 `idempotent` 或 `idempotency-key` 才重试；`dispatch_unknown` 只有这两种安全模式才重试。`before-dispatch-only` 在 request bytes 可能离开进程后绝不隐式重试，即使还没有输出。`idempotency-key` 由 Runtime 以 request ID + keyVersion 派生，同一逻辑请求所有 attempt 相同，并作为 protected header 在 payload 确定后加入；Provider 未官方承诺该 key 时不得声明此模式。异步图片 task create 默认 `before-dispatch-only`，poll GET 为 `idempotent`，cancel 最多一次且不重试 uncertain dispatch。

## 认证与 OAuth

### 认证模型

`ProviderAuth` 可组合：

- 显式请求 API Key
- 持久化 API Key Credential
- 环境变量或 ambient credential
- OAuth login / refresh / credential-to-request 转换
- AWS profile、Google ADC 等 Provider 特有 ambient auth

解析优先级为：显式请求覆盖 > 持久化 Credential > ambient/environment。一旦存在持久化 Credential，其类型不匹配或刷新失败时不得悄然回退到环境变量，避免请求使用错误账号。

```ts
declare const secretValueBrand: unique symbol;

interface SecretValue {
  readonly [secretValueBrand]: true;
  toString(): '[REDACTED]';
  toJSON(): '[REDACTED]';
}

declare function secret(value: string): SecretValue;

interface SealedCredentialEnvelope {
  version: number;
  keyId: string;
  ciphertext: string;
}

interface CredentialAad {
  domain: '@duoduo/ai/credential-record';
  schemaVersion: 1;
  storeNamespace: string;
  canonicalScope: string;
  state: 'empty' | 'active';
  revision: CredentialRevision;
  credentialInstanceId: string | null;
  authBindingFingerprint: string | null;
}

interface CredentialCodec {
  seal(
    plaintext: Uint8Array,
    aad: Uint8Array,
    signal?: AbortSignal,
  ): Promise<CredentialSealResult>;
  open(
    envelope: SealedCredentialEnvelope,
    aad: Uint8Array,
    signal?: AbortSignal,
  ): Promise<CredentialOpenResult>;
}

type CredentialSealResult =
  | Readonly<{ status: 'sealed'; envelope: SealedCredentialEnvelope }>
  | Readonly<{ status: 'key_unavailable'; retryable: boolean }>;

type CredentialOpenResult =
  | Readonly<{ status: 'opened'; plaintext: Uint8Array }>
  | Readonly<{ status: 'invalid' }>
  | Readonly<{ status: 'key_unavailable'; retryable: boolean }>;

type Credential =
  | {
      type: 'api_key';
      secret: SecretValue;
      scheme: string;
      metadata?: Readonly<Record<string, JsonValue>>;
    }
  | {
      type: 'oauth';
      accessToken: SecretValue;
      refreshToken: SecretValue;
      expiresAt: number;
      providerAccountId?: string;
      metadata?: Readonly<Record<string, JsonValue>>;
    }
  | {
      type: 'ambient_config';
      config: Readonly<Record<string, string | SecretValue>>;
    };

type AuthPrompt = { signal?: AbortSignal } & (
  | { type: 'text'; message: string; placeholder?: string }
  | { type: 'secret'; message: string; placeholder?: string }
  | {
      type: 'select';
      message: string;
      options: readonly {
        id: string;
        label: string;
        description?: string;
      }[];
    }
  | { type: 'manual_code'; message: string; placeholder?: string }
);

type AuthEvent =
  | { type: 'info' | 'progress'; message: string }
  | { type: 'auth_url'; url: string; instructions?: string }
  | {
      type: 'device_code';
      userCode: string;
      verificationUri: string;
      intervalSeconds?: number;
      expiresAt?: number;
    };

interface AuthInteraction {
  signal?: AbortSignal;
  openBrowser?(url: URL): Promise<'opened' | 'unavailable'>;
  prompt(prompt: AuthPrompt): Promise<string>;
  notify(event: AuthEvent): Promise<void> | void;
}

interface AuthHttpRequest {
  method: 'GET' | 'POST';
  url: URL;
  headers?: Readonly<Record<string, string | SecretValue>>;
  body?:
    | {
        type: 'form';
        fields: Readonly<Record<string, string | SecretValue>>;
      }
    | {
        type: 'json';
        fields: Readonly<Record<string, JsonValue | SecretValue>>;
      }
    | { type: 'bytes'; data: Uint8Array };
  redirect: 'error' | 'same-origin';
  maxResponseBytes: number;
  signal: AbortSignal;
}

interface AuthHttpTransport {
  send(request: AuthHttpRequest): Promise<HttpByteResponse>;
}

interface AuthNetworkPolicy {
  authorize(
    url: URL,
    context: {
      purpose: 'discovery' | 'authorize' | 'device' | 'token' | 'revoke';
      issuer?: string;
      redirectFrom?: URL;
    },
    signal: AbortSignal,
  ): Promise<void>;
}

interface Clock {
  now(signal?: AbortSignal): Promise<number>;
}

interface SecureRandom {
  bytes(length: number): Uint8Array;
}

interface LoopbackCallback {
  readonly redirectUri: string;
  waitForRedirect(input: {
    expectedState: string;
    deadlineAt: number;
    signal: AbortSignal;
  }): Promise<URL>;
  close(): Promise<void>;
}

interface SecretCredentialSource {
  environmentVariable: string;
  scheme: string;
}

interface SecretAuthContext {
  provider: Readonly<ProviderSnapshot>;
  source: 'request' | 'stored' | 'environment';
  scheme: string;
  transport: AuthHttpTransport;
  networkPolicy: AuthNetworkPolicy;
  clock: Clock;
  signal: AbortSignal;
}

interface EnvironmentSource {
  get(name: string): string | undefined;
}

interface SecretAuthResolution {
  requestAuth: ResolvedRequestAuth;
  catalogAuth: CatalogAuthView;
  providerAccountLabel?: string;
  hardExpiresAt?: number;
  bindingFacts?: AuthBindingFacts;
}

interface SecretAuth {
  sources: readonly SecretCredentialSource[];
  defaultStoredScheme: string;
  resolve(
    secret: SecretValue,
    context: SecretAuthContext,
  ): Promise<SecretAuthResolution> | SecretAuthResolution;
}

interface AmbientAuthResolution {
  requestAuth: ResolvedRequestAuth;
  credentialInstanceId: string;
  credentialIdentityLifetime: CredentialIdentityLifetime;
  catalogAuth: CatalogAuthView;
  providerAccountLabel?: string;
  bindingFacts?: AuthBindingFacts;
}

interface AmbientAuth {
  configure?(
    interaction: AuthInteraction,
    context: {
      provider: Readonly<ProviderSnapshot>;
      signal: AbortSignal;
    },
  ): Promise<Credential & { type: 'ambient_config' }>;
  resolve(context: {
    provider: Readonly<ProviderSnapshot>;
    config?: Readonly<Record<string, string | SecretValue>>;
    signal: AbortSignal;
  }): Promise<AmbientAuthResolution | undefined>;
}

interface AuthBindingFacts {
  allowedOrigins?: readonly string[];
  issuer?: string;
  audience?: string;
}

interface AuthOriginPolicy {
  descriptor: DerivedOriginPolicyDescriptor;
  resolve(
    input: Readonly<{
      provider: ProviderSnapshot;
      descriptor: AuthBindingDescriptor;
      facts?: AuthBindingFacts;
      endpointHints?: EndpointHints;
      catalogAuth: CatalogAuthView;
      signal: AbortSignal;
    }>,
  ): Promise<AuthBindingFacts> | AuthBindingFacts;
}

interface AuthBindingPolicy {
  descriptor: AuthBindingDescriptor;
  derivedOriginPolicy?: AuthOriginPolicy;
}

interface ProviderAuth {
  binding: AuthBindingPolicy;
  secrets?: SecretAuth;
  oauth?: OAuthFlow;
  ambient?: AmbientAuth;
}

interface OAuthCredentialResult {
  credential: OAuthCredential;
  catalogAuth: CatalogAuthView;
  providerAccountLabel?: string;
  bindingFacts?: AuthBindingFacts;
}

interface OAuthFlow {
  refreshSkewMs: number;
  login(
    interaction: AuthInteraction,
    context: AuthFlowContext,
  ): Promise<OAuthCredentialResult>;
  refresh(
    credential: OAuthCredential,
    context: AuthFlowContext,
  ): Promise<OAuthCredentialResult>;
  toRequestAuth(
    credential: OAuthCredential,
  ): Promise<ResolvedRequestAuth> | ResolvedRequestAuth;
  revoke?(credential: OAuthCredential, context: AuthFlowContext): Promise<void>;
}

interface AuthFlowContext {
  provider: Readonly<ProviderSnapshot>;
  signal: AbortSignal;
  transport: AuthHttpTransport;
  networkPolicy: AuthNetworkPolicy;
  clock: Clock;
  random: SecureRandom;
  loopbackCallback?: LoopbackCallback;
}

interface AmbientAuthPolicy {
  allow(
    scope: CredentialScopeKey,
    provider: Readonly<ProviderSnapshot>,
  ): Promise<boolean> | boolean;
}

interface CredentialOverridePolicy {
  allow(
    scope: CredentialScopeKey,
    provider: Readonly<ProviderSnapshot>,
    override: Readonly<Pick<RequestCredentialOverride, 'type' | 'scheme'>>,
  ): Promise<boolean> | boolean;
}
```

`AuthPrompt.select` 必须有 2–20 个唯一非空 option ID，`prompt()` 返回所选 ID；`manual_code` 用于 loopback callback 与手动粘贴竞态，callback 先完成时 Runtime abort 该 prompt 的独立 signal。OpenAI Codex 与 Radius 的 browser/device 选择必须使用 `select`，不能靠调用方解析自由文本。`notify()` 是结构化、可国际化的 UI 事件；secret、完整 callback URL query 和 token 不得放入 message。

CredentialCodec 的判别结果是稳定错误映射的唯一来源：`key_unavailable` → `CREDENTIAL_CODEC_KEY_UNAVAILABLE` 并保留 retryable，`invalid` → 非重试 `CREDENTIAL_STORE_CORRUPT`；codec throw 仅表示 driver bug/abort，由 Runtime 规范化为 internal/cancelled。sealer 禁止解析 exception message、KMS 文案或 key ID 来决定分支。

注册时必须验证 `AuthBindingPolicy`：descriptor 有 `derivedOriginPolicy` 时 callback 必须存在且 descriptor 的 id/version/configuration 完全相等；没有 descriptor 时禁止偷偷提供 callback。Runtime 规范化静态 origins 与解析结果，拒绝 HTTP（明确 local development policy 除外）、userinfo、fragment、非 origin path 及重复项，再计算 `AuthBinding.fingerprint = SHA-256(canonical(['@duoduo/ai/auth-binding',1,providerKind,providerInstanceId,sortedOrigins,issuer??null,audience??null,authPolicyFingerprint]))`。Provider callback 只能从已经过 schema 的公开 facts/endpoint hints 派生，不能拿 raw credential；函数行为变化必须提升 descriptor version。

静态 Provider 使用 descriptor origins；Copilot token hint 与 Radius discovery 通过 `bindingFacts + derivedOriginPolicy` 得到 credential-specific binding。refresh 只允许在同 issuer/audience 下更新经 policy 验证的 origin 集，并须生成新的 credential instance、catalog identity 与 session cleanup；issuer 或 audience 变化直接进入 `REAUTH_REQUIRED`，绝不能把旧 refresh token 发给新 issuer。Radius gateway 配置变化和 Copilot hostname 派生分别有合法/非法/NetworkPolicy 拒绝 fixture。

`ambient_config` 只保存 project、region、profile 或受控 credential-file reference 等配置，不把 SDK 临时 access token 复制进 store；`auth.login(..., 'ambient_config')` 只在 Provider 实现 `AmbientAuth.configure()` 时可用，否则明确返回 unsupported。Provider 通过 `SecretCredentialSource` 声明环境变量名及 scheme，Runtime 通过显式 `EnvironmentSource` 读取；浏览器默认空实现，Node preset 才封装 `process.env`，Provider 模块导入时绝不读取环境。`defaultStoredScheme` 用于普通 API-key login，其他声明过的 scheme 可由 `secretScheme`/request override 显式选择，未声明 scheme 在联网前拒绝。

环境变量中的 API key 在公共身份上归一为 `authSource: 'ambient'`、`AuthStatus.source: 'ambient'` 与 `method: 'api_key'`，但它不是可持久 credential。Runtime 用自己的随机 HMAC key 对 domain-separated tuple `['@duoduo/ai/environment-credential', 1, variableName, scheme, secretBytes]` 生成仅进程内的 `credentialInstanceId`，并标记 `credentialIdentityLifetime: 'process-local'`；明文和普通 hash 都不得进入 handle/cache。环境值在同一 Runtime 内变化会产生新 identity，旧 handle/session 立即失效。此身份只允许 ephemeral catalog cache，禁止写 `CatalogStore`、跨 Runtime session 或 serialized operation；带环境 key 的异步图片任务仍可用进程内 ref 恢复，但 `serializeOperation()` 必须 reject `OPERATION_AUTH_NOT_PERSISTABLE`。需要跨进程目录或任务恢复时，宿主必须把 key 通过 API-key login 写入 CredentialStore，或提供声明 `cross-runtime` 且具有稳定非秘密 identity 的受信 AmbientAuth；不能把“所有机器碰巧配置相同 env”当作身份协议。

scheme 决定完整认证转换而不只是 header 名：Anthropic 的 API key 与 bearer OAuth token 是两个 scheme；GitHub 的 `COPILOT_GITHUB_TOKEN` 是 `github-token-exchange`，`SecretAuth.resolve()` 必须通过限权 `AuthHttpTransport` 换取短期 Copilot token，并同时返回 endpoint hint、visible model IDs 与 visibility fingerprint；普通 key scheme 则直接产生 request auth。这样环境 secret、持久 API key 与 per-request override 共用同一转换路径，不会把所有变量误当成同一种 bearer。显式请求覆盖仅存在于该次调用的 options，永不自动持久化。

外部输入通过 `secret(value)` 转成 opaque `SecretValue`；只有包内 auth record serializer、`AuthHttpTransport` 的 secret-aware form/JSON materialization、模型 Transport 发送边界，以及包内 `OperationCredentialVerifier` wrapper 可 reveal/重建。后者只为异步 operation 生成/验证 keyed proof，并只把无歧义 canonical bytes 交给明确受信的 digest driver。外部 CredentialCodec 只处理已编码的 record bytes；序列化、inspection 和 diagnostics 默认输出 `[REDACTED]`。OAuth flow 不得先把 refresh/device/client secret 拼成普通 string body；必须把字段作为 `SecretValue` 交给 AuthHttpTransport。URL diagnostics 永不记录 query string，Provider metadata 只能使用公开 schema，不能把 secret 塞进普通字符串字段。

Runtime 从受信 `TransportDriver + NetworkPolicy` 派生限权的 `AuthHttpTransport/AuthNetworkPolicy`，从 `CredentialStore.now()` 派生权威 `Clock`，默认用 WebCrypto 实现 `SecureRandom`；测试可注入 deterministic random，每次 Node browser login 的 loopback listener 由 `CreateAiOptions.loopbackCallbackFactory(signal)` 独立创建并在终态关闭，factory 本身也受总 deadline/取消约束。OAuth flow 因而不能自行创建网络、时钟、随机数或监听器，所有端口都有明确所有者与取消边界。

多租户 Runtime 的 `AmbientAuthPolicy` 默认拒绝环境变量、AWS role 和 ADC，避免任意新 scope 消费宿主共享生产账号；宿主必须显式选择 shared-service policy。`LocalScopeAuthority` 的单用户 CLI preset 才默认允许 ambient auth。

OAuth authorize/discovery/token/device 请求全部使用 `AuthFlowContext.transport`，继承 proxy、timeout、响应上限、取消和 NetworkPolicy，禁止 flow 内裸 `fetch`。动态 endpoint 只允许 HTTPS 并校验 issuer/host；token、refresh 和 device-code POST 对任何 3xx 都失败，绝不重放含 refresh token/device code 的 body/query；普通 discovery GET 也只能按 policy 同源跳转。Node-only loopback callback 只绑定 loopback，校验独立高熵 state、单次消费和 deadline；Web/CLI 交互仍由 `AuthInteraction` 注入。

### CredentialStore

```ts
interface CredentialScopeKey {
  tenantId: string;
  subjectId: string;
  providerInstanceId: ProviderInstanceId;
  credentialSlotId?: string;
}

interface AuthBinding {
  version: 1;
  fingerprint: string;
  providerKind: string;
  allowedOrigins: readonly string[];
  issuer?: string;
  audience?: string;
}

type CredentialRevision = string;

type OAuthCredential = Extract<Credential, { type: 'oauth' }>;

interface RefreshLease {
  leaseId: string;
  ownerId: string;
  acquiredAt: number;
  expiresAt: number;
  hardDeadlineAt: number;
  takeoverNotBefore: number;
}

type CredentialAuthState =
  | { status: 'ready' }
  | { status: 'backoff'; retryAt: number; errorCode: string }
  | { status: 'reauth_required'; errorCode: string };

type EmptyCredentialRecord = Readonly<{
  state: 'empty';
  revision: CredentialRevision;
}>;

type ActiveCredentialRecord = Readonly<{
  state: 'active';
  revision: CredentialRevision;
  credential: Credential;
  credentialInstanceId: string;
  catalogAuth: CatalogAuthView;
  authBinding: AuthBinding;
  authState: CredentialAuthState;
  refreshLease?: RefreshLease;
}>;

type CredentialRecord = EmptyCredentialRecord | ActiveCredentialRecord;

type CredentialRecordUpdate =
  | { state: 'empty' }
  | {
      state: 'active';
      credential: Credential;
      credentialInstanceId: string;
      catalogAuth: CatalogAuthView;
      authBinding: AuthBinding;
      authState: CredentialAuthState;
    };

type PersistedCredentialHeader =
  | Readonly<{
      state: 'empty';
      revision: CredentialRevision;
      credentialInstanceId: null;
      authBindingFingerprint: null;
    }>
  | Readonly<{
      state: 'active';
      revision: CredentialRevision;
      credentialInstanceId: string;
      authBindingFingerprint: string;
    }>;

interface PersistedCredentialRecord {
  format: '@duoduo/ai/credential-record';
  schemaVersion: 1;
  header: PersistedCredentialHeader;
  sealedPayload: SealedCredentialEnvelope;
}

interface CredentialRecordSealer {
  seal(
    scope: CredentialScopeKey,
    record: CredentialRecord,
    signal?: AbortSignal,
  ): Promise<PersistedCredentialRecord>;
  open(
    scope: CredentialScopeKey,
    persisted: PersistedCredentialRecord,
    signal?: AbortSignal,
  ): Promise<CredentialRecord>;
}

declare function createCredentialRecordSealer(options: {
  codec: CredentialCodec;
  storeNamespace: string;
}): CredentialRecordSealer;

type CredentialCasResult =
  | Readonly<{ status: 'applied'; record: CredentialRecord }>
  | Readonly<{ status: 'conflict'; current: CredentialRecord }>;

interface RefreshLeaseHandle {
  readonly leaseId: string;
  readonly ownerId: string;
  readonly revision: CredentialRevision;
  readonly credentialInstanceId: string;
  readonly authBindingFingerprint: string;
  readonly expiresAt: number;
  readonly hardDeadlineAt: number;
  readonly takeoverNotBefore: number;
}

type RefreshLeaseAcquireResult =
  | Readonly<{
      status: 'acquired';
      record: ActiveCredentialRecord;
      lease: RefreshLeaseHandle;
    }>
  | Readonly<{
      status: 'not_acquired';
      reason: 'lease_held' | 'backoff';
      current: CredentialRecord;
      retryAt: number;
    }>
  | Readonly<{
      status: 'not_acquired';
      reason: 'revision_changed' | 'reauth_required' | 'not_oauth';
      current: CredentialRecord;
      retryAt?: never;
    }>;

type RefreshLeaseRenewResult =
  | Readonly<{
      status: 'renewed';
      record: ActiveCredentialRecord;
      lease: RefreshLeaseHandle;
    }>
  | Readonly<{ status: 'lost'; current: CredentialRecord }>;

interface RefreshRecordUpdate {
  credential?: OAuthCredential;
  catalogAuth?: CatalogAuthView;
  authState: CredentialAuthState;
}

type RefreshLeaseFinishResult =
  | Readonly<{ status: 'applied'; record: ActiveCredentialRecord }>
  | Readonly<{ status: 'lost'; current: CredentialRecord }>;

interface CredentialStore {
  readonly identityLifetime: CredentialIdentityLifetime;
  read(
    scope: CredentialScopeKey,
    signal?: AbortSignal,
  ): Promise<CredentialRecord>;
  compareAndSet(
    scope: CredentialScopeKey,
    expectedRevision: CredentialRevision,
    next: CredentialRecordUpdate,
    signal?: AbortSignal,
  ): Promise<CredentialCasResult>;
  acquireRefreshLease(
    scope: CredentialScopeKey,
    expectedRevision: CredentialRevision,
    request: { ownerId: string; maxDurationMs: number },
    signal?: AbortSignal,
  ): Promise<RefreshLeaseAcquireResult>;
  renewRefreshLease(
    scope: CredentialScopeKey,
    lease: RefreshLeaseHandle,
    signal?: AbortSignal,
  ): Promise<RefreshLeaseRenewResult>;
  finishRefresh(
    scope: CredentialScopeKey,
    lease: RefreshLeaseHandle,
    next: RefreshRecordUpdate,
    signal?: AbortSignal,
  ): Promise<RefreshLeaseFinishResult>;
  waitForChange?(
    scope: CredentialScopeKey,
    afterRevision: CredentialRevision,
    options: { notAfter: number },
    signal?: AbortSignal,
  ): Promise<CredentialRecord>;
  now(signal?: AbortSignal): Promise<number>;
}

interface CredentialScopeAuthority<TScopeHandle> {
  readonly fingerprintLifetime: CredentialIdentityLifetime;
  resolve(
    handle: TScopeHandle,
    request: {
      expectedProviderInstanceId: ProviderInstanceId;
      action:
        | 'use'
        | 'inspect_auth'
        | 'manage_auth'
        | 'refresh_catalog'
        | 'cleanup_session'
        | 'resume_operation';
    },
    signal: AbortSignal,
  ): Promise<CredentialScopeKey>;
  fingerprint(scope: CredentialScopeKey, signal?: AbortSignal): Promise<string>;
  verifyFingerprint(
    scope: CredentialScopeKey,
    fingerprint: string,
    signal?: AbortSignal,
  ): Promise<CredentialScopeFingerprintVerification>;
}

type CredentialScopeFingerprintVerification =
  | Readonly<{ status: 'match' }>
  | Readonly<{ status: 'mismatch' }>
  | Readonly<{ status: 'key_unavailable'; retryable: boolean }>;

declare const localScopeHandleBrand: unique symbol;
interface LocalScopeHandle {
  readonly [localScopeHandleBrand]: true;
}

declare function createLocalScopeAuthority(options: {
  tenantId: string;
  subjectId: string;
  credentialSlotId?: string;
}): Readonly<{
  scope: LocalScopeHandle;
  authority: CredentialScopeAuthority<LocalScopeHandle>;
}>;
```

`CredentialScopeKey` 是 store 内部 key，不是授权凭证。公共 Runtime 泛型化为 `AiRuntime<TScopeHandle>`，只接受宿主选择的 opaque handle；每次操作都经注入的 `CredentialScopeAuthority.resolve()` 完成 action-level 鉴权并绑定预期 Provider。推理只需 `use`，status 需 `inspect_auth`，login/logout/revoke 需 `manage_auth`，目录、session 与 operation 各用对应 action；“能使用共享 key”不等于“能替换或删除 key”。服务端必须让 handle 携带已认证 principal/context，禁止把 HTTP 请求里的 tenant/subject/slot 字段直接当 handle；CLI 才使用明确的单用户 `LocalScopeAuthority`。`CredentialStore.identityLifetime` 与 authority 的 `fingerprintLifetime` 是可验证部署能力：内存实现必须声明 `process-local`；只有共享持久 store/clock 与跨实例 keyring 才能声明 `cross-runtime`。Runtime 不根据类名、文件路径或“看起来用了 KMS”猜持久性。

scope 各分量必须非空、有长度上限、Unicode 规范化与无歧义 canonical encoding。`credentialSlotId` 是宿主选择的 opaque slot，不要求登录前知道厂商真实账号 ID；OAuth credential 中的厂商身份另命名为 `providerAccountId`。`fingerprint()` 使用带版本、domain separation 和轮换 key ID 的 keyed HMAC，不使用普通 hash，也不把原始 tenant/user 标识写进 catalog key。输出 envelope 包含非秘密 key ID；`verifyFingerprint()` 按该 ID 做 constant-time 校验，用于跨进程 operation 恢复，不能简单拿当前 active-key fingerprint 做字符串比较。支持持久 operation 的部署必须让 authority keyring 跨实例一致，并至少在 operation `maxTtlMs + 2 × allowedClockSkewMs` 内保留旧验证 key；未知/撤销 key 返回 typed `key_unavailable`，不得当作 scope mismatch 或尝试所有 key。key 轮换可以让新 catalog cache 使用新 key，同时不破坏仍未过期的旧 operation。

`AuthBinding` 将持久凭据绑定到 Provider kind、认证 issuer/audience、允许的请求 origin 和影响认证的配置。Provider 用相同实例 ID 重新注册但 binding fingerprint 变化时，旧凭据不得解析或发送，必须重新登录/保存；同一 fingerprint 的纯代码重载可以复用。GitHub credential-specific endpoint 必须落在 `allowedOrigins` 或由 binding 的受控派生规则验证，Radius 动态 OAuth 配置也必须验证 issuer/origin。

Store 的 CAS 必须对同一 scope 跨进程线性化。revision 只由 store 生成、永不复用；credential、auth state、lease acquire/renew/finish、login/logout 的任一语义变化都推进 revision。`read()` 即使从未保存过也返回并持久物化一个带 revision 的 sealed empty tombstone；logout 总是 CAS 写入新 tombstone，不物理删除。`compareAndSet()` 冲突返回当前记录而不是含糊的 `undefined`，且通用 CAS 不接受调用方构造 lease，所以在途 login/refresh 不能绕过 fencing 或在 logout 后复活凭据。

OAuth 刷新采用“进程内 singleflight + 持久 refresh lease + CAS”：

1. 对 active OAuth revision 做二次读取，并调用 store 的 `acquireRefreshLease()`；store 使用权威时钟生成 lease ID、expiry、安全窗和不可续展的 hard deadline。
2. 只有通过 store 对 scope、revision、lease ID、owner、credential instance 与 auth binding 全部验证的当前 owner 可以联网刷新；其他进程通过带 `notAfter` 的 `waitForChange()` 或可取消退避等待，避免 owner 崩溃后因 revision 不变而永久阻塞。公开 store seam 使用普通 readonly string/handle，不能依赖 TypeScript brand 代替运行时 fencing。
3. owner 串行 heartbeat `renewRefreshLease()`；每次使用返回的新 handle，丢 lease 或超过 hard deadline 立即 abort。
4. owner 用 `finishRefresh()` 原子写回 rotated credential/auth state 并清 lease；lease/revision/owner/credential instance/auth binding 任一不匹配都返回 lost，丢弃本地结果并重读。
5. login、credential replacement 或 logout 用普通 CAS 推进 revision 并清 lease，使旧 owner 永远无法 commit；takeover 只允许达到持久化 `takeoverNotBefore` 后发生，`lease_held.retryAt` 必须返回该值。

该 lease 阻止 rotating refresh token 被多个进程同时使用；不能只在锁外并发刷新后靠 CAS 决胜。进程内 singleflight 使用独立 internal controller，每个 waiter 的 signal 只让该 waiter detach；仅全部 waiter 取消、lease 丢失或 runtime dispose 时才 abort 底层刷新。singleflight key 包含 scope、credential revision 和 auth-binding fingerprint。

lease 的 acquisition/renew/finish 都在 store 的同一线性化 seam 内使用 `CredentialStore.now()`；调用方只能给最大 duration，不能给绝对时间。`takeoverNotBefore` 在 acquire 时持久化，renew 不得缩短，且至少满足 `hardDeadlineAt + allowedClockSkewMs + abortPropagationGraceMs`，因此进程重启或滚动升级不能按新配置过早抢占。hard deadline 限制 heartbeat 不能无限延长 refresh。普通失败或取消由 owner `finishRefresh()` 清 lease：临时错误保留旧 credential 并写有界 backoff，永久 `invalid_grant` 写 `reauth_required`；该状态可封存 token 供显式 revoke，但 Runtime 不得再调用 `toRequestAuth` 或 fallback ambient。只有进程崩溃才等待 takeover 时刻。

跨系统无法消除的残余窗口是：远端已旋转 refresh token、owner 尚未 CAS 落库便进程崩溃。下一次旧 token 会得到 `invalid_grant` 并进入 `reauth_required`，绝不能回退 ambient 或循环刷新；故障注入测试必须覆盖这个窗口。

每次 login/API-key replacement 生成新的非秘密 `credentialInstanceId`，refresh 保留它；OAuth/secret/ambient resolver 都必须返回标准 `CatalogAuthView`，账号可见模型集合变化时更新其中的 fingerprint/visible IDs。`AmbientAuthResolution` 必须显式声明 identity lifetime：`cross-runtime` 的 ID 只能由稳定、非秘密且账号/role/project 敏感的身份材料产生，并由 fixture 证明跨实例一致；做不到时必须标记 `process-local`，只能服务当前 Runtime 的请求、ephemeral catalog/session 和进程内 operation，禁止持久目录或序列化任务。环境变量 secret 始终走前述 Runtime HMAC 的 process-local 分支，不能由 Provider 自称稳定。GitHub login、refresh 与 GitHub-token exchange 因而共享同一目录过滤通道，不能把可见模型藏在任意 metadata。session key 同时包含 credential instance 与 auth-binding/Provider registration generation，因此 slot 换账号后绝不会复用旧 WebSocket 或 response affinity。显式 per-request credential override 使用 request-scoped identity，默认禁用持久目录缓存和 session 复用。

核心提供 `InMemoryCredentialStore`。持久 store 使用包提供的 `createCredentialRecordSealer()`：该 wrapper 独占 `SecretValue` reveal/重建、完整 record schema 与 canonical encoding，宿主的文件/DB store 只调用 seal/open 并持久化 `PersistedCredentialRecord`，不需要公开 reveal。底层可注入的 `CredentialCodec` 只负责 AEAD bytes，因而 KMS/HSM adapter 也无需理解 Credential。outer header 只有构造 AAD 所需的 state、revision、credential instance 与 auth-binding fingerprint，唯一权威语义是 sealed payload 内的完整记录，包括 auth state、lease、AuthBinding、visibility 与 empty tombstone。AAD 使用无歧义 canonical tuple `['@duoduo/ai/credential-record', 1, storeNamespace, canonicalScope, state, revision, credentialInstanceId, authBindingFingerprint]`；scope 从 sealer 的调用实参重算，deployment 级 `storeNamespace` 防止同 KMS key 下跨环境剪贴。

读取先对 outer record 做限长/严格 schema 校验，再用 header 重建 AAD 解封，并校验 payload 的 state/revision/credential instance/auth-binding fingerprint 与 header 完全相等。empty 不得含 active 字段；lease 只允许 active OAuth，时间必须是安全整数且 `acquiredAt < expiresAt <= hardDeadlineAt <= takeoverNotBefore`，并满足 store 配置的最小安全窗。任何 envelope、key、schema 或一致性失败都返回明确的 `CREDENTIAL_STORE_CORRUPT` / `CREDENTIAL_CODEC_KEY_UNAVAILABLE`，不得当作 empty 或 fallback ambient。普通 JSON serialization 仍只得到 `[REDACTED]`，不得当作持久化方案。

文件 store 还必须实现真正的 per-scope 跨进程锁，并在锁内重读 revision 后 CAS；目录权限 0700、文件 0600，拒绝 symlink/错误 owner，使用同目录临时文件、`fsync` 文件与目录后原子替换。data/lock/temp 文件名只能是 domain-separated HMAC(canonical scope) 的 base64url/hex 安全字母，不能拼接 raw tenant/subject/slot；平台允许时使用 dirfd/openat + no-follow。每 tenant 有 credential-slot quota。第一版禁止 tombstone compaction；AEAD 能防篡改/跨 scope 剪贴，却不能单独阻止攻击者把同一 scope 的整个旧文件回滚，需要该威胁模型的宿主必须使用外部单调 ledger 或事务数据库/KMS store。

### OAuth 范围

PI AI 当前内建 OAuth 的准确基线为：

| Provider         | 登录流程                                                           | 刷新与请求转换                                                              |
| ---------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `anthropic`      | Authorization Code + PKCE，loopback callback，并支持手动粘贴回调   | refresh-token grant；access token 转请求认证                                |
| `openai-codex`   | Browser PKCE 或 device code                                        | refresh-token grant；保留 account ID，转换为 Codex 请求认证                 |
| `github-copilot` | GitHub device code，可配置 Enterprise domain                       | 长期 GitHub token 换短期 Copilot token；同时刷新可用模型过滤和账号 endpoint |
| `xai`            | RFC 8628 device code                                               | refresh-token grant；access token 转请求认证                                |
| `radius`         | 从 gateway 动态发现 OAuth 配置，再选择 Browser PKCE 或 device code | 刷新前重取 gateway 配置；access token 转请求认证                            |

上述五个 Provider 全部实现 login、refresh 和 credential-to-request 转换，并在每次 login/refresh 的 `OAuthCredentialResult` 返回标准 `CatalogAuthView`；不做账号过滤的 flow 使用稳定 `all-models` fingerprint，GitHub 则返回真实 visible IDs/fingerprint。刷新必须完整透传调用的 `AbortSignal`；device code poller 支持服务端 interval、`slow_down`、deadline 和取消。OAuth UI 通过 provider-neutral `AuthInteraction` 端口注入，包不直接依赖 CLI 或 Web UI。

Credential 保存服务端真实 `expiresAt`；Runtime 使用 `CredentialStore.now()` 与 flow 的 `refreshSkewMs` 判断提前刷新，避免跨机本地时钟漂移。Runtime 注入 `AuthFlowContext.clock` 时也以同一 store-authoritative clock 为源，token 响应只有 `expires_in` 时用该时钟计算 hard expiry。基线 skew 固定为 Anthropic/GitHub Copilot/xAI 5 分钟、Radius 1 分钟、OpenAI Codex 0；Provider fixture 验证边界时刻，不能在登录时偷偷改写真实 expiry。

`logout()` 的不可妥协语义是先持有 active record 的受控内存快照，以 CAS 写本地 empty tombstone并清理相关 session；这是 local disconnect，不默认声称远端 token 已撤销。调用方设置 `revokeRemote` 且 Provider 实现 `OAuthFlow.revoke()` 时，Runtime 只用 CAS 前的快照做 best-effort 远端 revoke，绝不在 tombstone 后尝试从 store 重读 token，并返回 `remote: 'revoked' | 'unsupported' | 'failed'`；远端失败不回滚本地 logout，进程在 tombstone 后崩溃也可能来不及 revoke。需要可靠撤销审计的宿主必须注入持久 revocation queue，不能把此布尔选项当成强保证。

Google Gemini 使用 API Key；Google Vertex 使用 API Key 或 Google ADC，由 Google SDK 管理临时 token；Amazon Bedrock 使用 bearer token 或完整 AWS credential chain，由 AWS SDK 管理临时凭据。它们属于 ambient/SDK auth，不包装成 `OAuthCredential`。默认 AWS chain 必须支持标准 shared config/default profile、ECS、Web Identity 和实例角色，不要求用户额外声明 `AWS_PROFILE`；这是有意修正 PI 当前 availability probe 对 default profile/instance role 检测不完整的问题，而不是对其现状的照抄。

## 模型目录

### 静态目录

内建 Provider 包含经生成且可审查的 provider-local catalog shard。根入口不导入总目录；单个 Provider 只导入自己的 shard，`providers/all` 才导入全部 Provider。

目录数据必须经过 runtime schema 验证，且对不可从上游稳定获得的能力、价格和上下文限制支持手工 override。生成器产物带完整 sources、generatedAt、manifest/output digest 和 schemaVersion，便于审计和回滚。

每个 shard 必须由可审查 manifest 生成：

```ts
interface CatalogShardManifest {
  schemaVersion: 1;
  providerKind: string;
  sources: readonly CatalogShardSource[];
  transformVersion: number;
  filterId: string;
  curatedOverrideFile: string;
  curatedOverrideDigest: string;
}

interface CatalogShardSource {
  source:
    | { kind: 'models.dev'; providerKey: string }
    | { kind: 'build-time-api'; url: string }
    | { kind: 'curated-official'; references: readonly string[] }
    | { kind: 'runtime'; discoveryId: string };
  retrievedAt: string;
  sourceDigest: string;
  pin: Readonly<{
    snapshotFile: string;
    etag?: string;
    lastModified?: string;
  }>;
}

interface CatalogShardArtifact {
  schemaVersion: 1;
  providerKind: string;
  generatedAt: string;
  manifestDigest: string;
  curatedOverrideDigest: string;
  outputDigest: string;
  models: readonly JsonValue[];
}
```

`sources` 非空且按 transform 的读取顺序排列；每个输入独立记录规范化前原始内容的 digest 和仓库内只读 snapshot locator，HTTP validator 仅作审计而不是 pin。单来源 shard 也使用长度为一的数组。`nvidia` manifest 必须同时记录 pinned models.dev 与官方 `/models` 两项，交集算法及排序属于版本化 transform，任何一项缺失都不能生成 shard。curated override 另有自身内容 digest，最终产物记录 manifest digest 与 output digest，因而多来源生成仍可重复、可审计。

每个 Provider 的布局固定为 `src/providers/<kind>/catalog/{manifest.json,sources/*,overrides.json,catalog.generated.json}`。所有文件使用 UTF-8、LF、末尾单换行和 lexicographic key/model ordering；semantic `outputDigest` 计算时排除 `generatedAt`，包含 schema、Provider、完整模型/profile 数据、manifest 与 override digest。generator 先在临时目录写 artifact，重新读取并严格验证所有 digest 后才原子替换；package runtime 只读取 committed artifact，不读取 manifest source。manifest/artifact TypeScript interface、JSON Schema 和 fixture 必须由同一 schema module 生成，避免正文与产物漂移。

第一版 source routing 固定如下：

| 来源                                 | Provider shards                                                                                                                                                                                                                                                   | 过滤/覆盖规则                                                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| pinned `models.dev/api.json`         | `amazon-bedrock`, `anthropic`, `cerebras`, 两个 Cloudflare、`fireworks`, `github-copilot`, 两个 Google、`groq`, `huggingface`, `kimi-coding`, 两个 MiniMax、`mistral`, 两个 Moonshot、`nvidia`, `openai`, 两个 OpenCode、`together`, `xai`, 四个 Xiaomi、两个 ZAI | 保留 wire protocol 已实现的模型；不因“不支持工具”而删除纯文本模型；能力/价格/limits 再经官方 curated override |
| build-time authenticated/public list | `openrouter` 使用官方 `/api/v1/models`；`vercel-ai-gateway` 使用 `/v1/models`；`nvidia` 用官方 `/models` 与 models.dev 取交集                                                                                                                                     | 固化原始响应 digest；协议/安全字段由本地映射，不信任远端字段                                                  |
| curated official snapshot            | `ant-ling`, `deepseek`, `openai-codex`；`azure-openai-responses` 从 OpenAI 能力目录投影但部署由用户配置；额外 `qwen`、`doubao`                                                                                                                                    | 每条必须带官方 reference、首次/最后验证日期和 fixture；未知价格保持 undefined，不填 0                         |
| runtime                              | `radius`                                                                                                                                                                                                                                                          | `/v1/config` 动态发现并持久缓存，无伪静态 fallback                                                            |

OpenRouter 图片目录从同一 build-time snapshot 的图片能力生成；Qwen 与豆包图片模型来自各自 curated official shard。网络只在显式 `pnpm --filter @duoduo/ai catalog:update` 中发生，普通 install/build/test 使用已提交 snapshot。严格更新模式任一必需 source 失败即整体失败，不写半成品；生成 diff 必须显示新增/删除、能力、limits、价格和全部 source digest。

`S/E` 的 explicit 语义也固定：`additionalModels` 是 Provider factory 配置的一部分，按注册顺序追加但不写入 CatalogStore；ID 与静态/其他 explicit 重复时直接报错。修改已有模型只能走字段白名单 `modelOverrides`，不能借 additional model 覆盖 protocol/auth/endpoint。Qwen explicit model 必须选择已注册 binding；豆包 explicit 项必须声明上游 Model ID 或 Endpoint ID，二者都只序列化到请求 body 的 `model` 字段，不进入 URL/header。Provider config fingerprint 覆盖全部 explicit 项与 override。

### 动态目录

```ts
interface ModelDiscoveryContext {
  provider: Readonly<ProviderSnapshot>;
  authIdentity: Readonly<CatalogAuthView>;
  transport: RequestTransport;
  previousProviderState?: JsonValue;
  signal: AbortSignal;
}

interface ModelDiscoveryTargetContext {
  provider: Readonly<ProviderSnapshot>;
  endpointHints?: Readonly<EndpointHints>;
  previousProviderState?: JsonValue;
  signal: AbortSignal;
}

interface ModelFilterContext {
  provider: Readonly<ProviderSnapshot>;
  authIdentity: Readonly<CatalogAuthView>;
  signal: AbortSignal;
}

interface ModelSource {
  staticModels(): readonly ModelDefinition[];
  resolveDiscoveryEndpoint?(
    context: ModelDiscoveryTargetContext,
  ): Promise<URL> | URL;
  resolveDiscoveryHeaders?(
    context: ModelDiscoveryTargetContext & { endpoint: URL },
  ):
    | Promise<Readonly<Record<string, string>>>
    | Readonly<Record<string, string>>;
  discover?(context: ModelDiscoveryContext): Promise<ModelDiscoveryResult>;
}

interface DiscoveredModel {
  id: string;
  name?: string;
  protocol: string;
  capabilities?: Partial<ModelCapabilities>;
  limits?: Partial<ModelLimits>;
  pricing?: ModelPricing;
  providerMetadata?: Readonly<Record<string, JsonValue>>;
}

interface ModelDiscoveryResult {
  models: readonly DiscoveredModel[];
  providerState?: JsonValue;
  sourceRevision?: string;
  cacheMaxAgeMs: number;
}

interface CatalogCacheKey {
  capability: AiCapabilityId;
  providerInstanceId: ProviderInstanceId;
  providerCatalogBindingFingerprint: string;
  providerConfigFingerprint: string;
  authBindingFingerprint: string;
  credentialScopeFingerprint: string;
  credentialInstanceId: string;
  catalogVisibilityFingerprint: string;
  schemaVersion: number;
}

interface CachedCatalog {
  payload: JsonValue;
  storeRevision: string;
  discoveredAt: number;
  expiresAt: number;
  sourceRevision?: string;
  digest: string;
}

interface CatalogRefreshTicket {
  refreshGeneration: string;
  startedAt: number;
}

interface CatalogWriteValue {
  payload: JsonValue;
  ttlMs: number;
  sourceRevision?: string;
  digest: string;
}

type CatalogCommitResult =
  | { status: 'written'; record: CachedCatalog }
  | { status: 'superseded'; record?: CachedCatalog };

interface CatalogStore {
  read(
    key: CatalogCacheKey,
    signal?: AbortSignal,
  ): Promise<CachedCatalog | undefined>;
  beginRefresh(
    key: CatalogCacheKey,
    signal?: AbortSignal,
  ): Promise<CatalogRefreshTicket>;
  commitRefresh(
    key: CatalogCacheKey,
    ticket: CatalogRefreshTicket,
    value: CatalogWriteValue,
    signal?: AbortSignal,
  ): Promise<CatalogCommitResult>;
  delete(key: CatalogCacheKey, signal?: AbortSignal): Promise<void>;
  now(signal?: AbortSignal): Promise<number>;
}
```

`CatalogStore.payload` 是 capability owner 编码的版本化 `JsonValue`，store 不导入聊天或图片模型类型；`catalog`/`images` 各自在读写边界做严格 codec 校验，避免 `catalog ↔ images` 类型环。带 `discover()` 的 source 必须同时提供 discovery endpoint resolver（header resolver 可选），Runtime 先用同一 protected query/header/NetworkPolicy 算法绑定 `RequestTransport`，再调用 discover；缺少成对 resolver 在 Provider 注册时失败。`ModelDiscoveryContext` 只暴露最小无秘密 `CatalogAuthView`，不把 Credential 或 `ResolvedRequestAuth` 交给远端 source。`cacheMaxAgeMs` 由受信 source 返回并受 Runtime 上下限约束。远端 `DiscoveredModel` 不携带 compatibility/reasoning/profile 逃生口；受信 binding resolver 在 schema 验证后为它选择已注册 profile。

每个 chat/images binding 声明稳定的 `catalogCompatibilityVersion`。Runtime 以确定性 canonical encoding 计算 `providerCatalogBindingFingerprint = SHA-256(['@duoduo/ai/catalog-binding', 1, providerKind, providerInstanceId, capability, providerConfigFingerprint, catalogCompatibilityVersion])`。它不含随机 `registrationGeneration`，因此多个进程和重启后的 Runtime 能命中同一持久缓存；目录 payload schema、discovery routing/state 解释或安全过滤规则发生不兼容变化时必须递增 compatibility version。Runtime-local generation 仍留在 model handle 与 session 身份中，防止旧对象在同一进程被重注册实例复用。恢复持久 cache 后仍须重新验证 envelope、payload schema、digest、auth/visibility 与当前 binding，稳定 key 不等于跳过校验。

Runtime 支持：

- 从 `CatalogStore` 恢复同一 capability、稳定 Provider catalog binding、Provider/auth 配置、已授权 scope、credential instance 和可见性代的上一次成功目录。
- 按 `CatalogCacheKey` singleflight 并发刷新，刷新失败时保留上一次有效结果，并单独返回 provider-scoped errors。
- 按当前认证身份过滤账号可见模型，绝不在用户、credential replacement、区域、workspace、base URL 或账号之间复用目录。
- 通过 `allowNetwork`、`force` 和 `AbortSignal` 控制缓存恢复、强制刷新与取消。

`beginRefresh()` 在线性化 store 内推进该 key 的单调 refresh generation，并用 store-authoritative clock 盖章 `startedAt`；`commitRefresh()` 只接受当前 generation，较早的慢请求得到 `superseded`，不能覆盖较晚刷新。调用方只提交 `ttlMs`，store 验证其范围并以自己的 `now()` 生成 `discoveredAt/expiresAt`、新 `storeRevision` 后返回完整 record；调用方不得伪造时间。opaque `sourceRevision` 只用于条件请求与审计，不要求通用 store 猜测厂商排序；防 stale write 完全依赖 refresh ticket fencing。`expiresAt` 只控制是否应后台/显式刷新，过期缓存仍可在网络失败时作为标记 stale 的 last-known-good 返回。`ModelRefreshReport` 必须逐 Provider 返回 `static | fresh | cached | stale | failed` 和脱敏错误：无 discovery 的静态/explicit shard 是 static，成功网络发现是 fresh，未过期命中是 cached，过期 last-known-good 是 stale，无可用快照才是 failed；不能把部分成功伪装为全局成功。

缓存键只保存非秘密、带 domain separation 的 HMAC/稳定 ID；API Key、access token、refresh token 和原始 scope/credential 不进入 key 或缓存内容。Provider 配置指纹至少覆盖 region、workspace、gateway/base URL 和影响模型可见性的非秘密选项。refresh 保留 credential instance；login、API-key replacement、logout、catalog compatibility/config 或 available-model metadata 改变都会换 key。同配置、同 compatibility version 的纯 Runtime 重注册只换进程内 generation，允许复用重新校验后的持久 cache；不兼容实现必须显式递增 version，不能依赖随机 miss。只有位于 `cross-runtime` CredentialStore 的 stored credential，或声明且验证为 `cross-runtime` 的 ambient identity，能读写持久 `CatalogStore`；内存 store、环境变量、`process-local` ambient 和显式 per-request key 只使用当前 Runtime 的 ephemeral cache。环境 key 轮换会改变进程内 keyed identity，不能复用旧 handle/session/catalog。

目录合并是字段级、确定性的流水线：

1. 生成的静态 upstream baseline。
2. 运行时 discovery 的可见性与远端元数据。
3. 包内经审查的 curated override。
4. 宿主显式 user override。

远端 raw 响应不得直接决定 `providerInstanceId`、protocol binding/profile、endpoint、认证、header 或其他安全敏感字段；受信任的 `ModelSource` 代码必须把 protocol 映射到已注册 binding，并由 binding resolver 选择 profile，在返回前校验任何 routing state。Radius 的 `config.baseUrl` 是唯一基线例外路径：它先经过 gateway origin、AuthBinding 与 NetworkPolicy 校验，作为非秘密 `providerState` 缓存，恢复时再次校验，endpoint resolver 才可使用。User override 只能修改显示名、能力、limits、pricing 和非敏感 metadata，不能修改 protocol/profile/reasoning map。要新增静态目录外模型，必须通过 Provider 工厂的 `additionalModels` 提供，且 protocol/profile 必须属于该 Provider 已注册 binding，再经过完整 schema 验证。

第一版明确冻结以下策略，避免把不存在的远端 API 写成承诺：

- `radius`：必须实现运行时动态发现、持久缓存和失败回退，是内建基线中唯一强制动态目录。
- `github-copilot`：静态目录加 credential 返回的 available model IDs 过滤，不算动态 discovery。
- `openrouter`：构建时生成静态目录；运行时不强制联网刷新，可通过 `additionalModels` 扩展。
- `qwen`：构建时生成的区域化静态目录加 `additionalModels`；在验证稳定、可授权的官方 list endpoint 前不承诺运行时 discovery。
- `doubao`：静态目录加显式 Model ID/Endpoint ID；不推测不存在的通用运行时模型列表。
- 自定义 OpenAI-compatible/企业网关：可注入自己的 `ModelSource.discover()`。

## 上下文转换

`context` 模块在进入 ProtocolAdapter 前只执行可由核心类型表达、与具体 wire payload 无关的规范化：

```ts
interface ToolCallIdMap {
  toProvider(publicId: string): string;
  fromProvider(providerId: string): string | undefined;
}

interface ContextPolicyInput<
  TCompatibility = Readonly<Record<string, JsonValue>>,
> {
  context: Readonly<AiContext>;
  sourceModels: readonly ModelRef[];
  targetProvider: Readonly<ProviderSnapshot>;
  targetModel: Readonly<ModelDefinition>;
  normalization: Readonly<ContextNormalizationPolicy>;
  compatibility: Readonly<TCompatibility>;
  signal: AbortSignal;
}

interface PreparedContext {
  context: Readonly<AiContext>;
  toolCallIds: ToolCallIdMap;
  diagnostics: readonly AiDiagnostic[];
}

interface ContextPolicy<TCompatibility = Readonly<Record<string, JsonValue>>> {
  prepare(
    input: ContextPolicyInput<TCompatibility>,
  ): Promise<PreparedContext> | PreparedContext;
}
```

- 对不支持图片的模型，按显式策略拒绝请求或降级为占位文本。
- 按 `ReplayScope` 去除不能跨模型重放的加密 reasoning 与厂商签名。
- 将可读 reasoning 在跨 Provider 时按显式策略保留或转为普通文本。
- 为缺少结果的历史 tool call 补入合成错误结果，保证厂商对话约束。
- 过滤失败或取消的不完整 assistant turn；`length`/`content_filter` 中的 incomplete tool block 默认移除，保留其他安全内容。
- 在统一 maxTokens 进入 adapter 前估算上下文并预留安全边界。

tool call ID 字符集/长度、Provider 签名要求、payload 字段、role 命名、tool schema 形式和 reasoning 参数映射属于目标 `ProtocolBinding.contextPolicy` 与 ProtocolAdapter。Policy 接收不可变上下文并返回 `PreparedContext`，其规范化消息、diagnostics 与 tool-call-ID 对照表作为整体注入 `ProtocolRequest.context`，不修改原历史；通用 `context` 不认识 Provider ID。

## 传输层

`transport` 以注入接口为核心，默认使用 Web Platform `fetch`、Web Streams 和 `AbortSignal`，在 Node.js 22 直接运行。

```ts
type TransportBody = string | Uint8Array | ReadableStream<Uint8Array>;
type TransportResponseMode = 'bytes' | 'json' | 'stream';

interface TransportLimits {
  maxRequestBytes: number;
  maxResponseBytes: number;
  maxErrorBytes: number;
  maxFrameBytes: number;
}

interface BoundTransportRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: TransportBody;
  responseMode: TransportResponseMode;
  signal: AbortSignal;
}

interface TransportResponse extends HttpByteResponse {}

type TransportFailurePhase =
  'not_dispatched' | 'response_received' | 'dispatch_unknown';

declare const transportDriverFailureBrand: unique symbol;

interface TransportDriverFailure {
  readonly [transportDriverFailureBrand]: true;
  phase: TransportFailurePhase;
  code: 'network' | 'timeout' | 'aborted' | 'invalid_response';
  status?: number;
  retryAfterMs?: number;
}

declare function createTransportDriverFailure(
  input: Omit<TransportDriverFailure, typeof transportDriverFailureBrand>,
): TransportDriverFailure;

interface TransportSocket {
  readonly incoming: AsyncIterable<string | Uint8Array>;
  send(data: string | Uint8Array, signal?: AbortSignal): Promise<void>;
  close(code?: number, reason?: string): Promise<void>;
}

interface RequestTransport {
  send(request: BoundTransportRequest): Promise<TransportResponse>;
  openSocket?(request: {
    protocols?: readonly string[];
    signal: AbortSignal;
  }): Promise<TransportSocket>;
}

interface ResourceLoader {
  load(request: {
    url: URL;
    allowedMediaTypes: readonly string[];
    maxBytes: number;
    timeoutMs: number;
    signal: AbortSignal;
  }): Promise<{
    finalUrl: URL;
    mediaType: string;
    bytes: Uint8Array;
  }>;
}

declare const finalRequestTargetBrand: unique symbol;

interface FinalRequestTarget {
  readonly [finalRequestTargetBrand]: true;
  endpoint: URL;
  protectedQuery: Readonly<Record<string, string | SecretValue>>;
  headers: Readonly<Record<string, string | SecretValue>>;
  signing?: BoundSigningCapability;
  limits: TransportLimits;
}

interface MaterializedTransportRequest {
  url: URL;
  method: BoundTransportRequest['method'];
  headers: Readonly<Record<string, string>>;
  body?: TransportBody;
  responseMode: TransportResponseMode;
  redirect: 'manual';
  limits: TransportLimits;
  signal: AbortSignal;
}

interface TransportDriver {
  send(request: MaterializedTransportRequest): Promise<TransportResponse>;
  openSocket?(
    request: Omit<MaterializedTransportRequest, 'responseMode' | 'redirect'> & {
      protocols?: readonly string[];
    },
  ): Promise<TransportSocket>;
  dispose?(): Promise<void>;
}

interface NetworkPolicy {
  authorize(
    request: {
      url: URL;
      purpose: 'model' | 'catalog' | 'oauth' | 'media';
      redirectFrom?: URL;
    },
    signal: AbortSignal,
  ): Promise<void>;
}

interface TransportObservation {
  requestId: string;
  providerInstanceId: ProviderInstanceId;
  protocol: string;
  method: string;
  origin: string;
  pathname: string;
  headerNames: readonly string[];
  requestBytes?: number;
  responseStatus?: number;
  responseBytes?: number;
  payloadShape?: readonly string[];
  elapsedMs?: number;
  attempt: number;
}

interface TransportObserver {
  onRequest?(event: Readonly<TransportObservation>): Promise<void> | void;
  onPayloadSummary?(
    event: Readonly<TransportObservation>,
  ): Promise<void> | void;
  onResponse?(event: Readonly<TransportObservation>): Promise<void> | void;
}
```

`TransportDriver` 是宿主可替换且明确受信任的裸网络驱动，只接收 transport 模块已 materialize 的字符串 header/URL；ProtocolAdapter 从不直接拿 driver。driver 对预期网络失败必须 reject package-branded `TransportDriverFailure`，准确报告 bytes 是否可能发出；普通 Error 一律按 `dispatch_unknown`、非重试 internal 处理，Runtime 不解析错误文案。所有 HTTP driver 必须使用 `redirect: 'manual'` 并原样返回 3xx，自动 follow 属 contract violation；模型 request facade 默认拒绝 redirect，Auth wrapper 仅可按显式 same-origin policy 逐跳重新授权且 token POST 永远拒绝。Runtime 创建的 `RequestTransport` 已绑定不可变 `FinalRequestTarget`，先执行 `NetworkPolicy`，再在 transport 内部唯一允许的 seam reveal `SecretValue`、注入 protected query、消费 `BoundSigningCapability`，最后把 materialized request 交给 driver。签名后的 URL/header 再做一次 origin/protected-field invariant 校验。第三方 driver 能看到线上必需的明文凭据，属于可信计算基，不得记录或转发；它没有 API 可重新 reveal 其他 secret 或签任意 target。

Runtime 还从同一 driver/policy 构造无认证的 `ResourceLoader` 并注入协议请求，专门处理必须下载后上传的 URL 图片；它逐跳以 `purpose: 'media'` 授权 manual redirect，绝不继承模型/auth header，校验最终媒体类型、deadline 与 byte limit 后才返回 bytes。没有通过 policy 的私网、HTTP、跨域 redirect 或超限资源在上传前失败。URL 可被上游直接引用时 adapter 不下载，避免无意义 SSRF 面。

能力包含：

- JSON/HTTP 请求与响应元数据。
- 可测试的 SSE parser，正确处理 CRLF、多行 data、comment、断包与 UTF-8 边界。
- WebSocket 传输、连接超时、取消和有序关闭。
- 指数退避、jitter、`Retry-After` 和最大重试延迟。
- 可注入代理和 Provider 环境。
- 可选 `TransportObserver` 的 request/payload-summary/response hook；只接收上面的冻结 allowlist，不接收 URL query、header value、raw body/prompt/tool result，sink 失败只产生内部 diagnostic。
- 统一 HTTP 状态、request ID、限流和 Provider error body 解析。
- 默认只允许 HTTPS endpoint；localhost/HTTP、自定义代理和私网目标必须由宿主 `NetworkPolicy` 显式授权。重定向不自动携带认证跨 origin，必须重新通过 endpoint/header resolver。
- 对 header/body、SSE frame、累计流字节、Base64 图片和错误 body 设置可配置硬上限，超限以 `PAYLOAD_TOO_LARGE` 或 protocol error 终止。
- URL 图片默认原样交给支持 URL 的 Provider，不由核心下载；协议确需上传时必须通过受 `NetworkPolicy`、媒体类型、大小和超时限制的资源加载端口，防止 SSRF。

核心与大多数兼容协议优先使用原生 transport，避免为每个薄 Provider 安装完整 SDK。AWS Bedrock、Google ADC 或其他需要签名/特殊 transport 的能力可使用官方 SDK，但必须放在按需延迟加载边界后。

<a id="security-model"></a>

## 安全与威胁模型

保护对象包括：API/OAuth/ambient credential、租户与 credential slot 身份、prompt/图片/tool result、Provider routing、模型可见性、operation token/proof、目录与价格快照。宿主传入的数据、远端 Provider 响应、运行时 discovery、URL 媒体、serialized operation 和持久 store 文件都按不可信输入处理；包内建 Provider/protocol 代码经过审查，但仍只获得完成职责所需的窄端口。

可信计算基固定为：宿主进程与 `CredentialScopeAuthority`、Credential/Catalog store 实现、package-owned record/operation wrapper 及其 AEAD/MAC driver、`NetworkPolicy`、最终 `TransportDriver`、受控 ambient SDK credential provider，以及显式安装的 telemetry sink。`TransportDriver` 能看到将要发送的 credential，`OperationCredentialDigestDriver` 能看到 canonical credential bytes，ProtocolAdapter 能看到规范化 prompt/tool 内容，图片 adapter 能看到图片输入；这些权限是功能所需，必须在部署审查中单独列出。custom Provider/model source/adapter 不是 sandbox：虽然拿不到 reveal/store，它仍能看到请求内容并能通过已绑定 transport 向获准 origin 发送，因此只应加载可信代码。

| 威胁                           | 主要控制                                                                                                                       | 残余边界                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| 伪造 tenant/user/slot          | opaque scope handle、每 action authority resolve、expected Provider 等值校验、keyed scope fingerprint                          | authority 自身若错误授权，AI package 无法恢复业务身份真相                                           |
| 跨租户/跨账号 confused deputy  | scope/auth/config/credential/visibility 全身份 handle 与 cache key；session 加 credential instance/generation                  | 宿主若故意让多个主体共享同一 scope/slot，即视为显式共享账号                                         |
| credential 泄漏                | `SecretValue`、无公开 reveal、secret-aware auth/transport seam、sealed record、日志/错误脱敏、最小 endpoint allowlist          | 最终 network driver、KMS/MAC driver 与远端 Provider 必然处于明文路径                                |
| SSRF/redirect credential 转发  | protected final target、manual redirect、逐跳 NetworkPolicy、auth query/header 冲突失败、无认证 ResourceLoader                 | 被 allowlist 的合法 Provider 自身若被攻陷，属于上游供应链风险                                       |
| 动态目录/metadata 投毒         | 远端字段白名单、protocol/endpoint/auth 不可远程覆盖、payload codec/digest、stable binding fingerprint、last-known-good fencing | 已审查的 Provider transform 若逻辑错误仍可能产生错误模型能力，应由 fixture 与人工 catalog diff 捕获 |
| refresh token 并发旋转/复活    | store-authoritative clock、lease/heartbeat/hard deadline、revision CAS、sealed tombstone、防 ABA                               | 远端旋转成功但本地 commit 前崩溃只能进入 reauth；文件整体回滚需外部单调 ledger                      |
| operation token 窃取/篡改/重放 | AEAD sealed claims、scope verify、auth/binding/model/TTL 校验、override keyed proof、稳定 key ID 轮换                          | token 在 TTL 内仍按 credential 等级存储；远端不支持 cancel 时本地 abort 不能撤销任务                |
| 内存/网络资源耗尽              | request/response/frame/media/queue 上限、总 deadline、背压、单 observer、重试锁定、session TTL/dispose                         | 宿主仍需全局并发、租户 quota 与进程级内存限制                                                       |
| 日志/telemetry 二次泄漏        | 默认不采集 prompt/tool result/raw URL query/header/token，字段 allowlist、限长 diagnostic、sink failure 隔离                   | 显式启用内容采集的宿主承担数据治理、访问控制和保留期限                                              |

安全失败统一 fail closed：store/codec/schema/key/binding/policy 不确定不能解释成“没有配置”并 fallback；Provider 返回的 endpoint、header、protocol、tool schema 或 model capability 不能扩大本地信任。所有 canonical encoding 都包含 domain/version/长度边界，比较 secret-derived digest 使用 constant-time seam。测试中的 fake secret、record、operation token 和抓包 fixture 也按敏感数据处理，禁止提交真实 credential 或由真实账号可复用的响应头。

## Session 资源生命周期

AI session 只管理协议级可释放资源，不保存业务消息或 Agent 状态。内部身份为 `{ CredentialScopeKey, credentialInstanceId, authBindingFingerprint, providerRegistrationGeneration, sessionId }`，避免不同用户、同 slot 换账号、Provider 重注册或认证配置变化时共享连接/response affinity。

```ts
interface SessionResource<T> {
  value: T;
  dispose(): Promise<void> | void;
}

interface SessionLease<T> {
  value: T;
  release(): Promise<void>;
}

interface SessionHandle {
  acquire<T>(
    resourceKey: string,
    create: () => Promise<SessionResource<T>>,
    signal?: AbortSignal,
  ): Promise<SessionLease<T>>;
  getAffinity(key: string): JsonValue | undefined;
  setAffinity(key: string, value: JsonValue): void;
}
```

`SessionHandle` 由 runtime 创建并注入 `ProtocolRequest`。Adapter 可通过它按 `{ providerInstanceId, protocol, resourceKey }` 获取或创建 WebSocket、缓存句柄、response-ID affinity 等资源，并注册幂等 `dispose()`。资源采用引用计数：

- `ai.sessions.cleanup(providerInstanceId, scopeHandle, sessionId)` 先通过 authority 授权，再将对应 session 标为 closing，禁止新 acquisition；现有请求释放最后一个引用后执行 dispose。
- `cleanup()` 可重复调用，资源 dispose 最多一次；单个 dispose 失败会进入脱敏 diagnostics，但不会阻止其余资源释放。
- 可配置 idle TTL/LRU 只作为自动 cleanup 策略，不改变显式生命周期。
- `ai.dispose()` 拒绝新请求，取消 runtime 自有后台任务，清理所有 session 与 transport 资源，并可重复调用。
- 没有 `sessionId` 的请求不得写入全局 session cache；需要临时资源时随请求终态立即释放。
- login/API-key replacement/logout 会主动 cleanup 旧 credential instance；外部 store 变化即使未通知当前 runtime，也因 identity 不匹配而不能命中旧资源，最终由 TTL/dispose 回收。

测试覆盖并发 acquisition、cleanup 与在途请求竞态、TTL、部分 dispose 失败、重复 cleanup 和 runtime dispose。该模块不提供消息持久化、会话分支或 Agent steering。

## ProtocolAdapter 范围

完整协议基线包含：

- `openai-responses`
- `openai-chat-completions`
- `openai-codex-responses`
- `azure-openai-responses`
- `anthropic-messages`
- `google-generative-ai`
- `google-vertex`
- `bedrock-converse-stream`
- `mistral-conversations`
- `pi-messages`
- `dashscope`（Qwen 原生能力）
- `ark-responses`（仅放置已由官方 fixture 证实、无法由通用 OpenAI Responses profile 表达的方舟事件与 thinking 差异）

协议 adapter 必须覆盖：

- 消息、system/developer role 和多模态内容转换。
- tool schema、tool choice、延迟工具和 tool result。
- reasoning/thinking level、budget、签名、加密重放与展示策略。
- 流式文本、reasoning、部分 JSON tool call 和终态。
- token usage、cache read/write、reasoning token 和成本。
- 上下文缓存、session affinity 和 Provider response ID。
- 统一 stop reason、取消、错误与诊断。

OpenAI-compatible 方言差异不放入全局巨型 flags 对象。默认行为收敛在 protocol；只有被至少两个真实 Provider 复用的差异才提升为有类型 compatibility profile，单一 Provider 的差异保留在其装配模块。

<a id="text-protocol-matrix"></a>

### 文本协议 wire 与类型矩阵

PI 基线实际包含 10 个文本 wire adapter；本包将 PI 的 `openai-completions` 稳定命名为 `openai-chat-completions`，再新增 `dashscope` 与 `ark-responses`，合计 12 个。SDK 型协议不猜测 SDK 内部 URL：规范冻结 SDK operation/client 配置，并要求 fixture transport 记录最终 method/URL/header/body。

| Protocol                  | 冻结 operation / route                                                                | 核心能力与特殊状态                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `openai-responses`        | `POST {baseUrl}/responses`                                                            | Responses item、developer role、deferred tool search、reasoning summary/encrypted replay、service tier、usage/ID |
| `openai-chat-completions` | `POST {baseUrl}/chat/completions`                                                     | 文本/并行 tool JSON、十种 thinking 方言、OpenRouter/Vercel routing、cache/usage/session affinity                 |
| `openai-codex-responses`  | `https://chatgpt.com/backend-api/codex/responses`；SSE 或 WS/WSS                      | Codex OAuth header、WS cache、`previous_response_id`、verbosity、zstd SSE、reasoning                             |
| `azure-openai-responses`  | Azure root 规范化到 `{host}/openai/v1` 后执行 Responses；deployment 仍在 body `model` | API version/deployment resolver、prompt cache key、Responses encrypted reasoning 回填                            |
| `anthropic-messages`      | Anthropic SDK `messages.create({ stream: true })`；最终 URL 由 fixture 固化           | 多模态、tool use/result/reference、adaptive/budget thinking、redacted signature、cache control                   |
| `google-generative-ai`    | `@google/genai` `models.generateContentStream`                                        | Gemini 多模态/function call、thinking budget/level、thought signature、response ID                               |
| `google-vertex`           | 同一 SDK operation，client 固定 `vertexai: true`、project/location、API `v1`          | Gemini 语义加 Vertex API-key/ADC resource scope                                                                  |
| `bedrock-converse-stream` | AWS SDK `ConverseStreamCommand`                                                       | Converse tool use、Claude thinking/signature、cache point、request metadata、bearer/SigV4                        |
| `mistral-conversations`   | Mistral SDK `chat.stream`                                                             | tool ID 规范化、prompt mode、reasoning、prompt cache、usage/response ID                                          |
| `pi-messages`             | `POST {baseUrl}/messages`，debug 时可信 resolver 加 `?debug=1`                        | PI Context/options、block content signature、rewrite diagnostic、usage/response ID                               |
| `dashscope`               | curated `nativeRoute` 选择 text-generation 或 multimodal-generation                   | Qwen 原生文本/多模态；第一版仅映射 common options，route 绝不能成为 caller option                                |
| `ark-responses`           | 默认 `POST https://ark.cn-beijing.volces.com/api/v3/responses`                        | 处理 Ark Responses 事件与 common reasoning 到 `thinking.type` 的固定映射；第一版无任意 caller extension 字段     |

公共 common options 已拥有 temperature、max output、tool choice、reasoning、cache retention、session、timeout/retry。协议 subpath 只增加真实 wire 差异：

```ts
type NoProtocolFields = Readonly<Record<string, never>>;
type ServiceTier = 'auto' | 'default' | 'flex' | 'priority';
type OpenAiCodexTransport = 'sse' | 'websocket' | 'websocket-cached' | 'auto';

interface OpenAiResponsesProtocolOptions {
  reasoningSummary?: 'auto' | 'detailed' | 'concise' | null;
  serviceTier?: ServiceTier;
}

interface OpenAiCodexResponsesProtocolOptions {
  reasoningSummary?: 'auto' | 'concise' | 'detailed' | 'off' | 'on' | null;
  serviceTier?: ServiceTier;
  textVerbosity?: 'low' | 'medium' | 'high';
  transport?: OpenAiCodexTransport;
  websocketConnectTimeoutMs?: number;
}

interface AzureOpenAiResponsesProtocolOptions {
  reasoningSummary?: 'auto' | 'detailed' | 'concise' | null;
}

interface AnthropicMessagesProtocolOptions {
  thinkingEnabled?: boolean;
  thinkingBudgetTokens?: number;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  thinkingDisplay?: 'summarized' | 'omitted';
  interleavedThinking?: boolean;
}

interface GoogleThinkingOptions {
  enabled: boolean;
  budgetTokens?: number;
  level?: 'minimal' | 'low' | 'medium' | 'high';
}

interface GoogleGenerativeAiProtocolOptions {
  thinking?: GoogleThinkingOptions;
}

interface GoogleVertexProtocolOptions {
  thinking?: GoogleThinkingOptions;
}

interface BedrockConverseProtocolOptions {
  thinkingBudgets?: Partial<
    Record<'minimal' | 'low' | 'medium' | 'high', number>
  >;
  interleavedThinking?: boolean;
  thinkingDisplay?: 'summarized' | 'omitted';
  requestMetadata?: Readonly<Record<string, string>>;
}

interface MistralConversationsProtocolOptions {
  promptMode?: 'reasoning';
  reasoningEffort?: 'none' | 'high';
}

interface PiMessagesProtocolOptions {
  debug?: boolean;
}

declare module '@duoduo/ai/protocols' {
  interface ProtocolOptionsMap {
    'openai-responses': OpenAiResponsesProtocolOptions;
    'openai-chat-completions': NoProtocolFields;
    'openai-codex-responses': OpenAiCodexResponsesProtocolOptions;
    'azure-openai-responses': AzureOpenAiResponsesProtocolOptions;
    'anthropic-messages': AnthropicMessagesProtocolOptions;
    'google-generative-ai': GoogleGenerativeAiProtocolOptions;
    'google-vertex': GoogleVertexProtocolOptions;
    'bedrock-converse-stream': BedrockConverseProtocolOptions;
    'mistral-conversations': MistralConversationsProtocolOptions;
    'pi-messages': PiMessagesProtocolOptions;
    dashscope: NoProtocolFields;
    'ark-responses': NoProtocolFields;
  }
}
```

以下字段全部是受信 Provider binding 的 compatibility，不能由 per-call options、目录 raw metadata 或 user model override 修改：

```ts
type SessionAffinityFormat = 'openai' | 'openai-nosession' | 'openrouter';

type OpenAiChatThinkingFormat =
  | 'openai'
  | 'openrouter'
  | 'deepseek'
  | 'together'
  | 'zai'
  | 'qwen'
  | 'chat-template'
  | 'qwen-chat-template'
  | 'string-thinking'
  | 'ant-ling';

type ChatTemplateKwargValue =
  | JsonPrimitive
  | Readonly<{
      $var: 'thinking.enabled' | 'thinking.effort';
      omitWhenOff?: boolean;
    }>;

interface OpenRouterRoutingProfile {
  allow_fallbacks?: boolean;
  require_parameters?: boolean;
  data_collection?: 'deny' | 'allow';
  zdr?: boolean;
  enforce_distillable_text?: boolean;
  order?: readonly string[];
  only?: readonly string[];
  ignore?: readonly string[];
  quantizations?: readonly string[];
  sort?: string | Readonly<{ by?: string; partition?: string | null }>;
  max_price?: Readonly<{
    prompt?: number | string;
    completion?: number | string;
    image?: number | string;
    audio?: number | string;
    request?: number | string;
  }>;
  preferred_min_throughput?:
    number | Readonly<Partial<Record<'p50' | 'p75' | 'p90' | 'p99', number>>>;
  preferred_max_latency?:
    number | Readonly<Partial<Record<'p50' | 'p75' | 'p90' | 'p99', number>>>;
}

interface VercelGatewayRoutingProfile {
  only?: readonly string[];
  order?: readonly string[];
}

interface OpenAiChatCompatibility {
  supportsStore?: boolean;
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  supportsUsageInStreaming?: boolean;
  maxTokensField?: 'max_completion_tokens' | 'max_tokens';
  requiresToolResultName?: boolean;
  requiresAssistantAfterToolResult?: boolean;
  requiresThinkingAsText?: boolean;
  requiresReasoningContentOnAssistantMessages?: boolean;
  thinkingFormat?: OpenAiChatThinkingFormat;
  chatTemplateKwargs?: Readonly<Record<string, ChatTemplateKwargValue>>;
  openRouterRouting?: Readonly<OpenRouterRoutingProfile>;
  vercelGatewayRouting?: Readonly<VercelGatewayRoutingProfile>;
  zaiToolStream?: boolean;
  supportsStrictMode?: boolean;
  cacheControlFormat?: 'anthropic';
  sendSessionAffinityHeaders?: boolean;
  deferredToolsMode?: 'kimi';
  sessionAffinityFormat?: SessionAffinityFormat;
  supportsLongCacheRetention?: boolean;
}

interface OpenAiResponsesCompatibility {
  supportsDeveloperRole?: boolean;
  sessionAffinityFormat?: SessionAffinityFormat;
  supportsLongCacheRetention?: boolean;
  supportsToolSearch?: boolean;
}

interface AnthropicMessagesCompatibility {
  supportsEagerToolInputStreaming?: boolean;
  supportsLongCacheRetention?: boolean;
  sendSessionAffinityHeaders?: boolean;
  supportsCacheControlOnTools?: boolean;
  supportsTemperature?: boolean;
  forceAdaptiveThinking?: boolean;
  allowEmptySignature?: boolean;
  supportsToolReferences?: boolean;
}

interface DashScopeCompatibility {
  wireVersion: 1;
  nativeRoute:
    'text-generation/generation' | 'multimodal-generation/generation';
  supportsIncrementalOutput: boolean;
  supportsThinking: boolean;
  supportsTools: boolean;
}

interface ArkResponsesCompatibility {
  wireVersion: 'ark-v3';
  thinkingField: 'thinking.type';
  supportsPreviousResponseId: boolean;
  supportsFunctionTools: boolean;
}

declare module '@duoduo/ai/protocols' {
  interface ProtocolCompatibilityMap {
    'openai-responses': OpenAiResponsesCompatibility;
    'openai-chat-completions': OpenAiChatCompatibility;
    'openai-codex-responses': OpenAiResponsesCompatibility;
    'azure-openai-responses': OpenAiResponsesCompatibility;
    'anthropic-messages': AnthropicMessagesCompatibility;
    'google-generative-ai': NoProtocolFields;
    'google-vertex': NoProtocolFields;
    'bedrock-converse-stream': NoProtocolFields;
    'mistral-conversations': NoProtocolFields;
    'pi-messages': NoProtocolFields;
    dashscope: DashScopeCompatibility;
    'ark-responses': ArkResponsesCompatibility;
  }
}
```

`dashscope.nativeRoute` 的类型值是规范化标识，resolver 再映射到本文 Qwen 章节冻结的完整 `/services/aigc/...` path；它来自 curated model binding，不接受 caller input。`ark-responses` 第一版只允许 common reasoning 与 function tools，Ark-specific wire 字段由固定 compatibility + adapter 映射；未纳入 core tool model 的 Ark 内置工具、独立上下文缓存 API 和任何未经 fixture 固化的字段明确不在第一版，不得用 `Record<string, unknown>` 暴露透传逃生口。Azure 的 API version/resource/base URL/deployment、Vertex 的 project/location、Bedrock 的 region/profile/auth，以及 Qwen/豆包 region/base URL 都属于 Provider factory/auth/endpoint resolver，禁止塞入 protocol options。

### 协议 replay codec

opaque replay 不能只靠匿名 JSON 默契。相关 protocol subpath 必须导出自己的 data 联合与只读 codec；Runtime 在写入和读回历史时都验证 metadata envelope version、protocol/codec identity、payload version、长度、source 与 scope：

```ts
interface ProtocolReplayDecoder<TProtocol extends string> {
  readonly protocolId: TProtocol;
  readonly codecId: string;
  readonly codecVersion: number;
  readonly scope: ReplayScope;
  decode(input: unknown): JsonValue;
}

interface ProtocolReplayCodec<TProtocol extends string, TData> {
  readonly protocolId: TProtocol;
  readonly codecId: string;
  readonly codecVersion: number;
  readonly scope: ReplayScope;
  parse(input: unknown): TData;
  encode(data: TData): JsonValue;
}

interface ProtocolReplayCodecSet<TProtocol extends string> {
  readonly protocolId: TProtocol;
  readonly codecId: string;
  readonly currentVersion: number;
  readonly scope: ReplayScope;
  readonly current: ProtocolReplayDecoder<TProtocol>;
  readonly legacyDecoders: readonly ProtocolReplayDecoder<TProtocol>[];
}

declare function defineProtocolReplayCodecSet<
  TProtocol extends string,
  TData,
>(input: {
  current: ProtocolReplayCodec<TProtocol, TData>;
  legacyDecoders?: readonly ProtocolReplayDecoder<TProtocol>[];
}): ProtocolReplayCodecSet<TProtocol>;

type ResponsesReplayData =
  | Readonly<{
      kind: 'response-item';
      itemId: string;
      phase?: 'analysis' | 'final';
      encryptedContent?: string;
    }>
  | Readonly<{
      kind: 'tool-item';
      itemId: string;
      callId: string;
    }>;

type OpenAiChatReplayData = Readonly<{
  kind: 'reasoning';
  format: OpenAiChatThinkingFormat;
  id?: string;
  encryptedData?: string;
  readableText?: string;
}>;

type SignatureReplayData = Readonly<{
  kind:
    | 'anthropic-thinking'
    | 'anthropic-redacted-thinking'
    | 'google-thought'
    | 'bedrock-thinking'
    | 'pi-content';
  signature: string;
  opaqueData?: string;
}>;
```

Responses/Codex/Azure 各导出绑定自身 protocol ID 的 `ProtocolReplayCodec<TProtocol, ResponsesReplayData>`；OpenAI Chat 导出 `ProtocolReplayCodec<'openai-chat-completions', OpenAiChatReplayData>`；Anthropic、Google、Vertex、Bedrock 与 PI Messages 各导出收窄到自身 `kind` 的 `SignatureReplayData` codec。每个 protocol subpath 还用 `defineProtocolReplayCodecSet()` 导出轻量 codec set，Provider binding 显式挂到 `replayCodecs`，因此 Runtime 不依赖全局自动注册或加载重 SDK。Runtime 以 `(protocolId, codecId, codecVersion)` 建 registry：同一 exported set 被多个 Provider 重复引用是幂等的；相同 tuple 指向不同对象/decoder 则在 Provider 注册时同步失败 `PROTOCOL_REPLAY_CODEC_CONFLICT`。unregister 只减少 binding 引用，已注册 decoder 保留到 Runtime dispose，保证在途请求和旧 transcript 不因 Provider 热重载改变解释。

`codecId` 使用 package-scoped 稳定字符串，`codecVersion` 是 payload schema version，共享 data 类型不等于共享 identity。`current` 的版本必须等于 `currentVersion`，供 adapter encode 和 Runtime decode；`legacyDecoders` 只读旧 payload，不得用于新 metadata，版本必须唯一且小于 current。decoder 的 protocol/codec/scope 必须与 set 完全一致，所有 parse/decode 都执行限长严格 schema。上述 opaque/encrypted/signature 字段默认 `same-model`，不得进入 diagnostics；Mistral 和第一版 DashScope/Ark 没有已证实的 opaque replay 就只保留普通可读 content，不创建空 metadata。任何协议新增不兼容 replay shape 都要递增 current version、保留支持窗口内的旧 decoder，并提供旧 fixture 读取、duplicate-key 冲突与未知 codec/version 安全剥离测试；不能通过当前 ModelRef 或目录状态猜 codec。

<a id="provider-coverage"></a>

## Provider 覆盖

### PI AI 基线

生产 Provider 目标包含：

```text
amazon-bedrock
ant-ling
anthropic
azure-openai-responses
cerebras
cloudflare-ai-gateway
cloudflare-workers-ai
deepseek
fireworks
github-copilot
google
google-vertex
groq
huggingface
kimi-coding
minimax
minimax-cn
mistral
moonshotai
moonshotai-cn
nvidia
openai
openai-codex
opencode
opencode-go
openrouter
radius
together
vercel-ai-gateway
xai
xiaomi
xiaomi-token-plan-cn
xiaomi-token-plan-ams
xiaomi-token-plan-sgp
zai
zai-coding-cn
```

`faux` 作为 testing provider，不进入生产 `providers/all`。

“功能范围对齐 PI AI”按下面的 parity ledger 验收，不按文件名相似度验收：

| PI 能力面                                     | `@duoduo/ai` 冻结承载                                          | 有意差异                                                               |
| --------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Model、thinking map、compat、cost             | ModelDefinition + binding-owned per-model profile + Usage/Cost | 不暴露可变全局 model object；profile 进入 catalog identity             |
| stream/complete、tool/reasoning/replay        | Runtime stream state machine、ProtocolAdapter、replay codec    | adapter 不创建公共终态，不执行工具                                     |
| API key、ambient、5 个 OAuth                  | ProviderAuth、AuthBindingPolicy、CredentialStore               | scope-aware sealed store；不采用 PI plaintext auth file                |
| static/available/dynamic models               | inventory + scope-aware ModelsApi + Radius discovery           | “库存”和“当前账号可用”明确分 API                                       |
| OpenRouter Images                             | ordered image content/output、response ID、token/cache cost    | 复用更严格的图片 handle 与 transport 边界                              |
| headers/onPayload/onResponse/transformHeaders | `trustedRequest` + TrustedRequestPolicy                        | protected auth/signing 字段不可覆盖；response headers 默认不暴露 value |
| tool validation/JSON repair/overflow helpers  | core 纯函数与 `CONTEXT_OVERFLOW`                               | repair 后仍须 schema validation；silent detector 必须版本化            |
| faux provider/testing helpers                 | `@duoduo/ai/testing` scripted FIFO/controller/contract suites  | runner-neutral、无生产全局注册                                         |
| CLI                                           | Node binary + injectable `runCli()`                            | 使用 sealed store/key source，不复制 `auth.json` 明文格式              |
| legacy global API/compat aliases              | 不提供                                                         | 明确非目标；由新的 Runtime/Provider 注册边界替代                       |

任何 PI pinned commit 中属于上表前九项的行为，如果 manifest/source audit 找到而本文没有承载位置，视为 spec bug，必须先扩展 typed contract 再实现；不能塞进 `providerMetadata`、`Record<string, unknown>` 或未记录 hook。反之，PI 的 legacy aliases、导入副作用和 plaintext credential 不是要复刻的行为。

实现仓库必须提供 dev-only `scripts/parity/extract-pi.ts`，输入只接受显式 `--pi-root` 且验证 HEAD 等于固定 commit，输出 checked-in `src/providers/_generated/pi-parity.generated.json`。每条记录至少包含 `{ providerKind, modelId, protocolId, protocolProfileId, compatibility, reasoningLevelMap, capabilities, limits, pricing, sourceFile }`；对象 key/model 按字典序，未知函数/枚举/兼容字段直接失败，不用 `eval`，sourceFile 必须落在 `packages/ai/src/{models.generated.ts,providers,api,auth,utils}`。相同输入连跑两次 digest 必须相同。运行时/构建只消费已经转换成各 Provider shard/profile 的 committed 产物，不 import 这个 parity 文件；当 `vendor/pi` 不存在时 `parity:check` 验证 committed source commit/digest，当存在时还重跑并 diff。这样逐模型 flags 有确定迁移路径，同时不把 vendor 变成依赖。

### 规范 Provider 矩阵

下表是第一版实现与契约测试的冻结矩阵，不是示例清单。`S` 表示生成后固化的静态目录，`S/F` 表示静态目录加凭据过滤，`D/P` 表示运行时动态发现并持久缓存，`S/E` 表示静态目录加 Provider factory 的显式模型。表内 `openai-chat` 指本包的 `openai-chat-completions` protocol ID。

| Provider instance kind   | Protocol binding                                                                                                  | 认证                                                            | 默认 endpoint / resolver                                                          | 目录 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---- |
| `amazon-bedrock`         | `bedrock-converse-stream`                                                                                         | bearer 或 AWS ambient chain                                     | model/显式 region resolver，默认 `us-east-1`，EU-prefixed 模型默认 `eu-central-1` | S    |
| `ant-ling`               | `openai-chat`                                                                                                     | `ANT_LING_API_KEY`                                              | `https://api.ant-ling.com/v1`                                                     | S    |
| `anthropic`              | `anthropic-messages`                                                                                              | `ANTHROPIC_OAUTH_TOKEN`、`ANTHROPIC_API_KEY` 或 Anthropic OAuth | `https://api.anthropic.com`                                                       | S    |
| `azure-openai-responses` | `azure-openai-responses`                                                                                          | `AZURE_OPENAI_API_KEY`                                          | 显式 base URL → `AZURE_OPENAI_BASE_URL` → resource-name resolver                  | S    |
| `cerebras`               | `openai-chat`                                                                                                     | `CEREBRAS_API_KEY`                                              | `https://api.cerebras.ai/v1`                                                      | S    |
| `cloudflare-ai-gateway`  | `anthropic-messages`, `openai-chat`, `openai-responses`                                                           | Cloudflare key + account/gateway ID                             | 按协议解析 Gateway `/anthropic`、`/compat`、`/openai`                             | S    |
| `cloudflare-workers-ai`  | `openai-chat`                                                                                                     | Cloudflare key + account ID                                     | Cloudflare accounts AI `/v1` resolver                                             | S    |
| `deepseek`               | `openai-chat`                                                                                                     | `DEEPSEEK_API_KEY`                                              | `https://api.deepseek.com`                                                        | S    |
| `fireworks`              | `anthropic-messages`, `openai-chat`                                                                               | `FIREWORKS_API_KEY`                                             | `https://api.fireworks.ai/inference`                                              | S    |
| `github-copilot`         | `anthropic-messages`, `openai-chat`, `openai-responses`                                                           | `COPILOT_GITHUB_TOKEN` 或 GitHub device OAuth                   | credential proxy/Enterprise endpoint → individual endpoint                        | S/F  |
| `google`                 | `google-generative-ai`                                                                                            | `GEMINI_API_KEY`                                                | Google Generative Language `v1beta`                                               | S    |
| `google-vertex`          | `google-vertex`                                                                                                   | Google API key 或 ADC                                           | project/location resolver                                                         | S    |
| `groq`                   | `openai-chat`                                                                                                     | `GROQ_API_KEY`                                                  | `https://api.groq.com/openai/v1`                                                  | S    |
| `huggingface`            | `openai-chat`                                                                                                     | `HF_TOKEN`                                                      | `https://router.huggingface.co/v1`                                                | S    |
| `kimi-coding`            | `anthropic-messages`                                                                                              | `KIMI_API_KEY`                                                  | `https://api.kimi.com/coding`                                                     | S    |
| `minimax`                | `anthropic-messages`                                                                                              | `MINIMAX_API_KEY`                                               | `https://api.minimax.io/anthropic`                                                | S    |
| `minimax-cn`             | `anthropic-messages`                                                                                              | `MINIMAX_CN_API_KEY`                                            | `https://api.minimaxi.com/anthropic`                                              | S    |
| `mistral`                | `mistral-conversations`                                                                                           | `MISTRAL_API_KEY`                                               | `https://api.mistral.ai`                                                          | S    |
| `moonshotai`             | `openai-chat`                                                                                                     | `MOONSHOT_API_KEY`                                              | `https://api.moonshot.ai/v1`                                                      | S    |
| `moonshotai-cn`          | `openai-chat`                                                                                                     | `MOONSHOT_API_KEY`                                              | `https://api.moonshot.cn/v1`                                                      | S    |
| `nvidia`                 | `openai-chat`                                                                                                     | `NVIDIA_API_KEY`                                                | `https://integrate.api.nvidia.com/v1`                                             | S    |
| `openai`                 | `openai-responses`                                                                                                | `OPENAI_API_KEY`                                                | `https://api.openai.com/v1`                                                       | S    |
| `openai-codex`           | `openai-codex-responses`                                                                                          | OpenAI Codex OAuth                                              | `https://chatgpt.com/backend-api`                                                 | S    |
| `opencode`               | `anthropic-messages`, `google-generative-ai`, `openai-chat`, `openai-responses`                                   | `OPENCODE_API_KEY`                                              | 按协议解析 Zen base URL                                                           | S    |
| `opencode-go`            | `anthropic-messages`, `openai-chat`                                                                               | `OPENCODE_API_KEY`                                              | 按协议解析 Zen Go base URL                                                        | S    |
| `openrouter`             | `openai-chat`, `openrouter-images`                                                                                | `OPENROUTER_API_KEY`                                            | `https://openrouter.ai/api/v1`                                                    | S    |
| `radius`                 | `pi-messages`                                                                                                     | `RADIUS_API_KEY` 或 gateway-discovered OAuth                    | gateway option，默认 `https://radius.pi.dev`，再解析远端模型 endpoint             | D/P  |
| `together`               | `openai-chat`                                                                                                     | `TOGETHER_API_KEY`                                              | `https://api.together.ai/v1`                                                      | S    |
| `vercel-ai-gateway`      | `anthropic-messages`                                                                                              | `AI_GATEWAY_API_KEY`                                            | `https://ai-gateway.vercel.sh`                                                    | S    |
| `xai`                    | `openai-chat`, `openai-responses`, `xai-images`, `xai-videos`                                                     | `XAI_API_KEY` 或 xAI device OAuth                               | `https://api.x.ai/v1`                                                             | S    |
| `xiaomi`                 | `openai-chat`                                                                                                     | `XIAOMI_API_KEY`                                                | `https://api.xiaomimimo.com/v1`                                                   | S    |
| `xiaomi-token-plan-ams`  | `openai-chat`                                                                                                     | `XIAOMI_TOKEN_PLAN_AMS_API_KEY`                                 | `https://token-plan-ams.xiaomimimo.com/v1`                                        | S    |
| `xiaomi-token-plan-cn`   | `openai-chat`                                                                                                     | `XIAOMI_TOKEN_PLAN_CN_API_KEY`                                  | `https://token-plan-cn.xiaomimimo.com/v1`                                         | S    |
| `xiaomi-token-plan-sgp`  | `openai-chat`                                                                                                     | `XIAOMI_TOKEN_PLAN_SGP_API_KEY`                                 | `https://token-plan-sgp.xiaomimimo.com/v1`                                        | S    |
| `zai`                    | `openai-chat`                                                                                                     | `ZAI_API_KEY`                                                   | `https://api.z.ai/api/coding/paas/v4`                                             | S    |
| `zai-coding-cn`          | `openai-chat`                                                                                                     | `ZAI_CODING_CN_API_KEY`                                         | `https://open.bigmodel.cn/api/coding/paas/v4`                                     | S    |
| `qwen`                   | `openai-chat`, `openai-responses`, `anthropic-messages`, `dashscope`, `dashscope-images`, `dashscope-image-tasks` | `DASHSCOPE_API_KEY`                                             | region/workspace-aware Alibaba Model Studio resolver                              | S/E  |
| `doubao`                 | `openai-responses`, `openai-chat`（compat mode）, `ark-responses`, `ark-images`, `ark-video-tasks`                | `ARK_API_KEY`                                                   | region/base URL resolver，默认北京 Ark `/api/v3`                                  | S/E  |
| `kling`                  | `kling-video-tasks`                                                                                               | Kling Open Platform credential scheme                           | 官方 Open Platform resolver；实现时由 pinned contract 固定                        | S/E  |
| `self-hosted-generation` | `duoduo-generation-v1`                                                                                            | `DUODUO_GENERATION_GATEWAY_KEY` 或受信 ambient service identity | 显式 owned gateway base URL；禁止公共互联网自动发现                               | D/P  |

每个表格行都必须有 Provider 注册/认证/endpoint/目录契约；该行列出的每个 protocol binding 至少有一组序列化请求 fixture 与流解析 fixture。每个认证分支和 endpoint 分支另有 resolver fixture，因此不能以“Provider 能 import”代替真实接入。目录生成器从同一 registry manifest 生成文档、CLI 选择器和测试参数，避免 OAuth 或 Provider 清单漂移。

以下多分支 resolver 是规范的一部分：

- **Bedrock**：region 优先级为 inference-profile ARN → per-call/provider explicit region → `AWS_REGION` → `AWS_DEFAULT_REGION` → selected AWS profile/shared config → curated model default region。`AWS_BEARER_TOKEN_BEDROCK` 是 bearer 分支；access-key pair、ECS、Web Identity、default profile 和 instance role 走绑定 service/region 的 ambient signing capability。custom endpoint 不从 hostname 猜 region，必须由前述分支解析。
- **Azure OpenAI**：base URL 为 explicit → `AZURE_OPENAI_BASE_URL` → `AZURE_OPENAI_RESOURCE_NAME` 构造 `https://{resource}.openai.azure.com/openai/v1` → curated model fallback；API version 为 explicit → `AZURE_OPENAI_API_VERSION` → `v1`；deployment 为 explicit → `AZURE_OPENAI_DEPLOYMENT_NAME` → `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` 的 model entry → model ID。deployment map 是逗号分隔的严格 `modelId=deploymentName` 列表：entry 与等号两侧都 trim，空 entry 跳过；不是恰好一个等号或任一侧为空的 entry 作为畸形项跳过并产生不含原值的配置诊断；重复 model ID 由最后一个有效 entry 覆盖。解析后为空不是错误，继续落到 model ID；所有这些分支都有 fixture。
- **Cloudflare Workers AI**：`https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1`。**AI Gateway** 分别解析 `https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/anthropic`、`/compat`、`/openai`；`CLOUDFLARE_API_KEY` 只成为 `cf-aig-authorization: Bearer …`，并明确移除 `Authorization` 与 `x-api-key`，避免下游 key 混淆。
- **Google**：Gemini Developer API 固定 `https://generativelanguage.googleapis.com/v1beta`。Vertex 的 `GOOGLE_CLOUD_API_KEY` 分支不要求 project/location；ADC 分支从 explicit → `GOOGLE_CLOUD_PROJECT`/`GCLOUD_PROJECT` 与 `GOOGLE_CLOUD_LOCATION` 解析，并支持 `GOOGLE_APPLICATION_CREDENTIALS`、workload identity/default ADC。ADC 区域请求由官方 SDK 解析到 `{location}-aiplatform.googleapis.com`，fixture 断言传给 SDK 的完整 client config 与最终 transport URL。
- **OpenCode**：Anthropic binding 使用 `https://opencode.ai/zen`，其他 binding 使用 `https://opencode.ai/zen/v1`；Go 分别使用 `/zen/go` 与 `/zen/go/v1`。
- **Radius**：gateway 默认 `https://radius.pi.dev`；模型/endpoint 从 `/v1/config` 发现，OAuth 配置从 `/v1/oauth` 发现，返回的受信任 `config.baseUrl` 经 auth/network policy 验证后成为模型 endpoint。
- **GitHub Copilot**：完成 GitHub token → Copilot token 交换后，从 Copilot token 的分号字段读取首个 `proxy-ep=...`。值必须是无 scheme、userinfo、port、path、query、fragment 的规范 DNS hostname；只把开头的 `proxy.` 替换为 `api.`，其他 hostname 不改，再构造 HTTPS origin。优先级为有效 token hint → `https://copilot-api.{enterpriseDomain}` → `https://api.individual.githubcopilot.com`。hint 缺失才允许 fallback；字段存在但语法非法时返回脱敏 Provider 配置错误，合法 origin 被当前 AuthBinding/NetworkPolicy 拒绝时返回 `auth_binding_mismatch`，两者都不得携带 token 尝试其他 origin。`enterpriseDomain` 也必须先通过同一 hostname 规范化与 endpoint policy。解析结果只作为绑定 credential instance 的 `endpointHints`，不能被调用方直接覆盖。

这些优先级中的每个叶子都是测试参数；自定义 base URL 必须通过 AuthBinding/NetworkPolicy，不能绕过 resolver。

复杂 Provider 的 public factory config 也属于冻结 API；endpoint/auth 字段不能临时塞进 `protocolOptions`：

```ts
interface AdditionalModelInput<TProtocol extends string> {
  id: string;
  upstreamModelId: string;
  name: string;
  publisher?: string;
  family?: string;
  protocol: TProtocol;
  protocolProfileId: string;
  capabilities: ModelCapabilities;
  limits: ModelLimits;
  requestDefaults?: Readonly<CommonStreamRequestDefaults>;
  pricing?: ModelPricing;
  providerMetadata?: Readonly<Record<string, JsonValue>>;
}

type ModelOverrideInput = Partial<
  Pick<ModelDefinition, 'name' | 'capabilities' | 'limits' | 'pricing'>
>;

interface AzureOpenAiProviderOptions {
  id?: ProviderInstanceId;
  baseUrl?: URL;
  resourceName?: string;
  apiVersion?: string;
  deploymentName?: string;
  deploymentMap?: Readonly<Record<string, string>>;
  additionalModels?: readonly AdditionalModelInput<'azure-openai-responses'>[];
  modelOverrides?: Readonly<Record<string, ModelOverrideInput>>;
}

interface GoogleVertexProviderOptions {
  id?: ProviderInstanceId;
  authMode?: 'auto' | 'api-key' | 'adc';
  project?: string;
  location?: string;
  baseUrl?: URL;
  additionalModels?: readonly AdditionalModelInput<'google-vertex'>[];
  modelOverrides?: Readonly<Record<string, ModelOverrideInput>>;
}

interface BedrockProviderOptions {
  id?: ProviderInstanceId;
  authMode?: 'auto' | 'bearer' | 'aws';
  region?: string;
  profile?: string;
  baseUrl?: URL;
  additionalModels?: readonly AdditionalModelInput<'bedrock-converse-stream'>[];
  modelOverrides?: Readonly<Record<string, ModelOverrideInput>>;
}
```

`AdditionalModelInput` 不含 `providerInstanceId` 和任何安全字段；调用方不能注入 endpoint/auth/compatibility/reasoning map/providerState，只能从该 binding 已注册且公开允许选择的 profile ID 中选一个，未知 ID 在注册时失败。API key、bearer 与 AWS/ADC credential 本身不属于 factory options，仍由 auth scheme/store/environment/ambient resolver 提供。`baseUrl` 是显式非秘密配置，但必须进入 config/auth policy fingerprint 并经过 NetworkPolicy。

### 额外一等 Provider

#### Qwen

`@duoduo/ai/providers/qwen` 面向 Alibaba Cloud Model Studio / DashScope，提供区域参数、workspace/base URL 配置、`DASHSCOPE_API_KEY` 认证、模型目录与：

- OpenAI-compatible Chat Completions
- OpenAI-compatible Responses
- Anthropic-compatible Messages
- DashScope 原生协议

```ts
type QwenRegion =
  | 'cn-beijing'
  | 'ap-southeast-1'
  | 'us-east-1'
  | 'cn-hongkong'
  | 'ap-northeast-1'
  | 'eu-central-1';

type QwenProtocolPreference =
  | 'openai-chat-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'dashscope';

interface QwenAdditionalModelInput extends AdditionalModelInput<QwenProtocolPreference> {
  nativeRouteId?: 'text-generation' | 'multimodal-generation';
}

interface QwenAdditionalImageModelInput {
  id: string;
  upstreamModelId: string;
  name: string;
  protocol: 'dashscope-images' | 'dashscope-image-tasks';
  protocolProfileId: string;
  capabilities: ImageModelCapabilities;
  limits: ImageModelLimits;
  inputDefaults: Readonly<{ count: number; size: ImageSize }>;
  pricing?: ImageModelPricing;
  imageRouteId: 'wan-multimodal-sync' | 'wan-image-task';
}

interface QwenProviderOptions {
  id?: ProviderInstanceId;
  region: QwenRegion;
  endpointMode?: 'shared' | 'workspace';
  workspaceId?: string;
  baseUrl?: URL;
  protocolPreference?: QwenProtocolPreference;
  additionalModels?: readonly QwenAdditionalModelInput[];
  additionalImageModels?: readonly QwenAdditionalImageModelInput[];
  modelOverrides?: Readonly<Record<string, ModelOverrideInput>>;
}
```

`baseUrl` 是高级显式 override，不取消 region/workspace/API-key 数据边界校验；`endpointMode: 'workspace'` 必须有 workspaceId，shared 禁止携带它。`nativeRouteId` 只允许映射到包内 curated route 表，未提供时只有兼容协议模型可新增，不能传任意 path。

同一 Provider 实例中的每个模型仍只有一个确定的 `protocol`。工厂选项 `protocolPreference` 在生成模型快照时决定兼容模型的 binding，默认 `openai-chat-completions`；可显式选择 `openai-responses`、`anthropic-messages` 或 `dashscope`。只能由原生接口表达的模型/能力固定为 `dashscope`，不会被 preference 强行改写。需要同时比较不同协议时，调用方注册不同实例 ID，例如 `qwen-chat` 与 `qwen-native`，从而保持 `ModelRef` 无歧义。

Qwen pay-as-you-go resolver 不用模糊 region 字符串：

| Region           | shared host                          | workspace-dedicated host                         |
| ---------------- | ------------------------------------ | ------------------------------------------------ |
| `cn-beijing`     | `dashscope.aliyuncs.com`             | `{workspaceId}.cn-beijing.maas.aliyuncs.com`     |
| `ap-southeast-1` | `dashscope-intl.aliyuncs.com`        | `{workspaceId}.ap-southeast-1.maas.aliyuncs.com` |
| `us-east-1`      | `dashscope-us.aliyuncs.com`          | 当前不支持                                       |
| `cn-hongkong`    | `cn-hongkong.dashscope.aliyuncs.com` | `{workspaceId}.cn-hongkong.maas.aliyuncs.com`    |
| `ap-northeast-1` | 无 shared default                    | `{workspaceId}.ap-northeast-1.maas.aliyuncs.com` |
| `eu-central-1`   | 无 shared default                    | `{workspaceId}.eu-central-1.maas.aliyuncs.com`   |

工厂要求显式 region；选择 workspace mode 时 `workspaceId` 必填并进入 hostname，不支持该模式的区域在注册时立即报配置错误。OpenAI Chat/Responses 使用 `/compatible-mode/v1`，Anthropic 使用 `/apps/anthropic`，DashScope native 与图片以 `/api/v1` 为 base。Qwen catalog 的每个原生模型必须携带不可由调用方覆盖的 curated route ID：文本生成映射 `/services/aigc/text-generation/generation`，文本理解图片/音视频等多模态生成映射 `/services/aigc/multimodal-generation/generation`；图片任务 route 独立映射 `/services/aigc/image-generation/generation`。不在 curated route 表中的原生模型不能注册。Wan 2.6 的 direct/task 双 public ref 与精确 route 由“内建图片矩阵”冻结；旧图片模型也只能由 curated route 选择。最终 URL 由 base 与 route 各拼接一次，并由 fixture 固定。workspace 不再重复放 header/body，API Key 必须与 region/billing plan 一致并进入 AuthBinding。Token/Coding Plan 因官方限制不能用于后端自动化，不混入默认 `qwen` Provider；未来如支持必须是独立 kind/policy。

正式文档参考：

- <https://www.alibabacloud.com/help/en/model-studio/developer-reference/use-qwen-by-calling-api>
- <https://www.alibabacloud.com/help/en/model-studio/qwen-api-reference>
- <https://www.alibabacloud.com/help/en/model-studio/base-url>
- <https://www.alibabacloud.com/help/en/model-studio/wan-image-generation-api-reference>

Qwen Provider 可在目录中暴露平台托管的第三方模型，但这些条目不取代 DeepSeek、Kimi、GLM 和 MiniMax 的直连 Provider。

#### MiniMax

MiniMax 保持两个明确的一等 Provider，不通过模糊 region flag 混用凭据或数据边界：

- `minimax`：`anthropic-messages`，`MINIMAX_API_KEY`，`https://api.minimax.io/anthropic`。
- `minimax-cn`：`anthropic-messages`，`MINIMAX_CN_API_KEY`，`https://api.minimaxi.com/anthropic`。

两者使用各自静态目录 shard、独立 credential slot/auth binding 和 endpoint fixture；调用方可用自定义实例 ID 覆盖 base URL，但不能让一个实例根据模型名静默跨区。

#### 豆包

`@duoduo/ai/providers/doubao` 面向 Volcengine Ark，默认使用北京区域、`ARK_API_KEY` 与 `https://ark.cn-beijing.volces.com/api/v3`，并允许显式 region、base URL、Model ID 和 Endpoint ID。

```ts
type DoubaoTextProtocol =
  'openai-responses' | 'openai-chat-completions' | 'ark-responses';

interface DoubaoExplicitModelInput extends Omit<
  AdditionalModelInput<DoubaoTextProtocol>,
  'id'
> {
  id: string;
  upstream:
    | Readonly<{ type: 'model'; modelId: string }>
    | Readonly<{ type: 'endpoint'; endpointId: string }>;
}

interface DoubaoExplicitImageModelInput {
  id: string;
  name: string;
  protocol: 'ark-images';
  protocolProfileId: string;
  capabilities: ImageModelCapabilities;
  limits: ImageModelLimits;
  inputDefaults: Readonly<{ count: number; size: ImageSize }>;
  pricing?: ImageModelPricing;
  upstream:
    | Readonly<{ type: 'model'; modelId: string }>
    | Readonly<{ type: 'endpoint'; endpointId: string }>;
}

interface DoubaoProviderOptions {
  id?: ProviderInstanceId;
  region?: 'cn-beijing';
  baseUrl?: URL;
  compatibilityMode?: 'responses' | 'chat-completions';
  additionalModels?: readonly DoubaoExplicitModelInput[];
  imageModels?: readonly DoubaoExplicitImageModelInput[];
  modelOverrides?: Readonly<Record<string, ModelOverrideInput>>;
}
```

public `id` 是本包目录 ID，文本和图片的 `upstream` 判别联合决定 definition 的 `upstreamModelId` 与请求 body 的 `model` 值；Endpoint ID 永不进入 host/path/header。`imageModels` 是 Seedream/自定义 Ark Model ID 或 Endpoint ID 的显式图片入口，不从文本 `additionalModels` 猜测图片能力。非北京区域只有显式 base URL 扩展路径，第一版 union 不假装认识未经验证的 region 名；未来官方区域加入时扩展闭合联合和 resolver fixture。

默认文本/多模态目录使用 `openai-responses` 加固定的 Ark compatibility profile。只有显式 `compatibilityMode: 'chat-completions'` 的实例把兼容模型映射到 `openai-chat-completions`；官方 fixture 证实且通用 Responses 无法无损表达的 Ark thinking 与响应事件固定路由到 `ark-responses`。第一版只承诺 common function tools，不把方舟内置工具或独立上下文缓存 API 伪装成已经统一；协议选择在目录快照创建时完成，不在请求中根据 options 猜测。

第一版内建 region 只有 `cn-beijing`，base URL 固定 `https://ark.cn-beijing.volces.com/api/v3`：Responses、Chat 和图片分别追加 `/responses`、`/chat/completions`、`/images/generations`。`ARK_API_KEY` 作为 Bearer header；Model ID 与 Endpoint ID 都只进入 JSON body 的 `model` 字段。其他区域不靠字符串拼接猜测，必须显式 `baseUrl` 并通过 NetworkPolicy/AuthBinding，且形成不同 Provider config fingerprint。

正式文档参考：

- <https://www.volcengine.com/docs/82379/1795150>
- <https://www.volcengine.com/docs/82379/1958524>

### 品牌与 Provider ID 映射

- Grok → `xai`
- Gemini → `google` / `google-vertex`
- GLM / 智谱 → `zai` / `zai-coding-cn`
- Kimi 开放平台 → `moonshotai` / `moonshotai-cn`
- Kimi Coding → `kimi-coding`
- MiniMax → `minimax` / `minimax-cn`
- Qwen → `qwen`
- 豆包 → `doubao`

<a id="extension-template"></a>

## 扩展开发模板

新增能力时先复用已有 protocol：如果上游只是 OpenAI Chat/Responses 或 Anthropic Messages 的 endpoint/auth/少量兼容差异，应新增 Provider binding，不复制 adapter。只有 wire request、stream event 或 replay 状态无法由现有 typed compatibility 表达，并且这种差异有稳定 schema 时才新增 protocol。

### 新增 Provider

Provider subpath 导出零副作用工厂与完整 options 类型。工厂可读取传入配置，但不得在 import/调用工厂时读 `process.env`、打开网络或注册全局状态：

```ts
interface AcmeProviderOptions {
  id?: ProviderInstanceId;
  baseUrl?: URL;
  additionalModels?: readonly AcmeAdditionalModel[];
  modelOverrides?: Readonly<Record<string, AcmeModelOverride>>;
}

interface AcmeAdditionalModel {
  id: string;
  name: string;
  protocol: 'openai-chat-completions';
  protocolProfileId: 'default';
  capabilities: ModelCapabilities;
  limits: ModelLimits;
  pricing?: ModelPricing;
}

type AcmeModelOverride = Partial<
  Pick<ModelDefinition, 'name' | 'capabilities' | 'limits' | 'pricing'>
>;

export function acmeProvider(options: AcmeProviderOptions = {}): Provider {
  return {
    id: options.id ?? 'acme',
    kind: 'acme',
    name: 'Acme',
    identity: defineProviderIdentity({
      version: 1,
      configuration: canonicalAcmeConfiguration(options),
    }),
    contractManifest: acmeContractManifest,
    auth: createAcmeAuth(),
    capabilities: {
      chat: {
        catalogCompatibilityVersion: '1',
        modelSource: createAcmeModelSource(options),
        protocols: [createAcmeOpenAiBinding(options)],
      },
    },
  };
}
```

实现顺序固定为：

1. 定义 factory config schema、默认实例 ID、所有 endpoint/region/workspace 分支；canonical config fingerprint 必须覆盖每个影响路由、认证、目录或模型语义的字段。
2. 定义 `SecretAuth`/OAuth/ambient scheme 与 `AuthBinding`；每个环境变量只是声明的 `SecretCredentialSource`，不在模块内读取。
3. 选择已有 protocol binding；定义完整 default/model profiles，resolver 返回完整 URL 与非秘密 header，所有自定义 origin 经过 NetworkPolicy/AuthBinding。
4. 提供非空静态 manifest 或成对的 discovery endpoint + `discover()`；远端字段不能决定 auth/protocol/endpoint。
5. `additionalModels` 只新增，`modelOverrides` 只修改白名单字段；重复 ID、未知 protocol、非法 limits/pricing 在注册时失败。
6. 导出 ref helper、factory options、Provider 工厂；不导出内部 SDK client、secret converter 或目录 raw JSON。
7. 运行通用 Provider contract suite，再增加 auth、resolver 每个叶子、catalog merge/filter 和至少一个 request/stream fixture。

### 新增文本 Protocol

protocol subpath 必须同时提供 option/compatibility augmentation、contract、adapter、replay codec（若有 opaque state）与 fixture recorder：

```ts
interface AcmeChatOptions {
  quality?: 'fast' | 'balanced';
}

interface AcmeChatCompatibility {
  wireVersion: 1;
  supportsParallelTools: boolean;
}

declare module '@duoduo/ai/protocols' {
  interface ProtocolOptionsMap {
    'acme-chat': AcmeChatOptions;
  }
  interface ProtocolCompatibilityMap {
    'acme-chat': AcmeChatCompatibility;
  }
}

export const acmeChatContract: ProtocolContract<'acme-chat'> = {
  parseOptions,
  mergeOptions,
  parseCompatibility,
};

export const acmeChatAdapter: ProtocolAdapter<'acme-chat'> = {
  id: 'acme-chat',
  contract: acmeChatContract,
  async run(request, sink) {
    // Serialize only from PreparedContext + resolved options.
    // Send only through request.transport.
    // Publish content events; return one ProtocolTerminal.
  },
};
```

parser 必须拒绝未知 key、NaN/Infinity、超长 string/array 与 prototype pollution；merge 逐字段定义，不能 generic deep merge。adapter 不创建公共 start/end，不持有 Runtime/store，不裸 fetch，不修改 endpoint/header，不吞 AbortSignal。tool/reasoning/replay/usage/finish reason 均须由 fixture 固化；未知上游 event 是 protocol error，不静默丢弃可能改变语义的内容。若只有一个 Provider 使用某个差异，优先放入该 Provider 的固定 binding；compatibility 字段只有出现第二个真实使用者才提升为通用 profile。

### 新增图片 Protocol

同步协议使用 `DirectImageProtocolBinding/Adapter`；会返回任务 ID 的协议必须使用 resumable 组合，并分别定义 create 与 operation resolver：

```ts
const acmeImagesBinding: ResumableImageProtocolBinding<'acme-images'> = {
  protocol: 'acme-images',
  operationMode: 'resumable',
  operationCompatibilityVersion: '1',
  operationActions: ['poll', 'cancel'],
  resolveEndpoint: resolveCreateEndpoint,
  resolveOperationEndpoint: resolvePollOrCancelEndpoint,
  loadAdapter: async () => acmeImagesAdapter,
};

const acmeImagesAdapter: ResumableImageProtocolAdapter<'acme-images'> = {
  id: 'acme-images',
  operationMode: 'resumable',
  contract: acmeImagesContract,
  parseOperationState,
  async run(request, sink) {
    // Create through request.transport, then exactly once:
    await sink.setOperation({ operationId, operationState, providerExpiresAt });
    const poll = await sink.operationTransport('poll');
    return pollUntilTerminal(poll, sink, request.signal);
  },
  async resume(request, sink) {
    return pollUntilTerminal(request.pollTransport, sink, request.signal);
  },
  async cancel(request) {
    await sendCancel(request.transport, request.signal);
  },
};
```

operation state schema 只允许恢复 wire 所需的非秘密字段；ID/path segment 必须独立校验和编码。模型的 `asyncOperation` 必须与 binding/adapter mode 双向一致：false 只能 direct，true 只能 resumable；resume/cancel 与 operation action resolver 也必须在首次网络前一致。图片 contract suite 还要求 create/poll/cancel 每个 target、任务状态机、partial outputs、TTL、token 篡改、跨 scope/auth/config 恢复、local/remote cancel 与 output URL 过期 fixture。

### 新增视频 Protocol

视频 protocol 遵循相同 direct/resumable 装配，但必须独立声明 `VideoProtocolOptionsMap`、`VideoProtocolCompatibilityMap` 和每个 operation kind 的 route/profile。接入顺序固定为：从官方 contract 冻结 generate/edit/extend 与 poll/cancel route → 定义 model capability/limits → 编写失败 fixture → 编写 create fixture → 编写状态/产物 fixture → 实现 adapter。不能先写一个接收任意 JSON 的 adapter 再补类型。

综合平台接入时先决定它是统一 task wire 还是透明转发 wire：前者新增平台 protocol，后者复用已有 protocol 并由 Provider binding 固定 endpoint/profile。远端 catalog 不得返回可执行 route、header、auth、operation mode 或 compatibility。至少用两个同 `publisher/family`、不同 `providerInstanceId/pricing` 的模型 fixture 证明渠道身份没有被错误合并。

### 扩展完成定义

任何 Provider/Protocol 合并前必须同时满足：独立 subpath import；根入口无新增副作用；公共类型只经 export map；fixture 不含真实 secret；contract suite 全过；Provider/模型/协议/环境变量矩阵已生成；catalog manifest 有来源与 digest；NetworkPolicy 叶子、错误映射、AbortSignal、usage/cost、日志脱敏和 tree-shaking 测试齐全。只添加工厂名称、模型 JSON 或 happy-path fetch 不算接入完成。

<a id="generation-kernel"></a>

## 统一生成任务内核

### 第一性原理与方案取舍

媒体生成的稳定事实只有四个：调用方提交领域输入、执行方可能异步完成、过程中产生进度/预览、终态返回产物或错误。模型厂商、综合平台、推理框架和 GPU 云厂商都是可替换实现，不应进入 Agent 的 interface。访问渠道会独立改变认证、价格、限流和任务协议，因此 Provider 身份必须表示实际访问渠道；模型发布方只是目录事实，不能替代 Provider 身份。

设计比较如下：

| 方案                                                               | 结论 | 原因                                                                                 |
| ------------------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------ |
| 图片和视频各复制整套 operation                                     | 拒绝 | detach、恢复、安全 token、取消竞态和状态机重复，修复无法保持一致                     |
| 所有媒体使用一个 `generateMedia(options: Record<string, unknown>)` | 拒绝 | interface 与所有厂商能力一样复杂，类型无法阻止图片参数发给视频模型                   |
| 共享生成任务深模块，图片/视频保留独立领域 interface                | 采用 | operation 复杂度集中，调用方仍得到严格的图片或视频类型，未来音频/3D 可按同一模式增加 |

`generation` 只拥有下面的公共不变量和包内状态机。`images`、`videos` 各自提供 claims codec、模型能力、输入、输出和 protocol adapter；对外仍返回各自 branded operation ref，调用方不能把图片 ref 传给视频 resume。

```ts
type GenerationDomain = 'images' | 'videos';
type GenerationPhase = 'queued' | 'preparing' | 'running' | 'finalizing';

interface GenerationProgress {
  phase?: GenerationPhase;
  progress?: number;
  queuePosition?: number;
  estimatedWaitMs?: number;
}

type GenerationArtifactSource =
  | Readonly<{ type: 'url'; url: string; expiresAt?: number }>
  | Readonly<{ type: 'base64'; data: string }>;

interface GenerationArtifact {
  mediaType: string;
  source: GenerationArtifactSource;
  sizeBytes?: number;
  sha256?: string;
  metadata?: Readonly<Record<string, JsonValue>>;
}

interface GenerationComputeUsage {
  acceleratorType?: string;
  acceleratorCount?: number;
  activeMilliseconds?: number;
  billedMilliseconds?: number;
  queueMilliseconds?: number;
  modelLoadMilliseconds?: number;
}

interface GenerationOperationEnvelope {
  domain: GenerationDomain;
  claimsVersion: number;
  claims: JsonValue;
}

interface GenerationOperationPolicy {
  maxTtlMs: number;
  allowedClockSkewMs: number;
}

type GenerationOperationSealResult =
  | Readonly<{ status: 'sealed'; token: string }>
  | Readonly<{ status: 'key_unavailable'; retryable: boolean }>;

type GenerationOperationOpenResult =
  | Readonly<{ status: 'opened'; envelope: GenerationOperationEnvelope }>
  | Readonly<{ status: 'invalid' }>
  | Readonly<{ status: 'key_unavailable'; retryable: boolean }>;

interface GenerationOperationCodec {
  readonly persistence: 'cross-runtime';
  seal(
    envelope: GenerationOperationEnvelope,
    signal?: AbortSignal,
  ): Promise<GenerationOperationSealResult>;
  open(
    sealedToken: string,
    signal?: AbortSignal,
  ): Promise<GenerationOperationOpenResult>;
}

interface OperationCredentialProof {
  readonly keyId: string;
  readonly digest: string;
}

type OperationCredentialCreateResult =
  | Readonly<{ status: 'created'; proof: OperationCredentialProof }>
  | Readonly<{ status: 'key_unavailable'; retryable: boolean }>;

type OperationCredentialVerificationResult =
  | Readonly<{ status: 'match' }>
  | Readonly<{ status: 'mismatch' }>
  | Readonly<{ status: 'key_unavailable'; retryable: boolean }>;

interface OperationCredentialDigestDriver {
  readonly identityLifetime: CredentialIdentityLifetime;
  create(
    canonicalCredential: Uint8Array,
    signal?: AbortSignal,
  ): Promise<OperationCredentialCreateResult>;
  verify(
    canonicalCredential: Uint8Array,
    proof: OperationCredentialProof,
    signal?: AbortSignal,
  ): Promise<OperationCredentialVerificationResult>;
}

declare const operationCredentialVerifierBrand: unique symbol;

interface OperationCredentialVerifier {
  readonly [operationCredentialVerifierBrand]: true;
  readonly identityLifetime: CredentialIdentityLifetime;
  create(
    override: RequestCredentialOverride,
    signal?: AbortSignal,
  ): Promise<OperationCredentialCreateResult>;
  verify(
    override: RequestCredentialOverride,
    proof: OperationCredentialProof,
    signal?: AbortSignal,
  ): Promise<OperationCredentialVerificationResult>;
}

declare function createOperationCredentialVerifier(
  driver: OperationCredentialDigestDriver,
): OperationCredentialVerifier;

type GenerationOperationAuthClaims =
  | {
      authSource: 'stored' | 'ambient';
      credentialInstanceId: string;
      credentialIdentityLifetime: CredentialIdentityLifetime;
      overrideCredentialProof?: never;
    }
  | {
      authSource: 'override';
      credentialInstanceId?: never;
      credentialIdentityLifetime: CredentialIdentityLifetime;
      overrideCredentialProof: OperationCredentialProof;
    };
```

`GenerationOperationCodec` 只保护版本化 envelope 的机密性与完整性，不解释图片或视频 claims。Runtime 根据 `domain` 选择 package-owned strict codec，拒绝未知 domain/version/key、非法字段和 prototype pollution，再执行相同的 scope/auth/provider/model/profile/TTL preflight。默认 `maxTtlMs = 86_400_000`（24 小时），允许范围 1 分钟至 7 天；视频任务可以由 Runtime 配置更长的业务等待 timeout，但不能绕过 operation token TTL。产物保留期与 operation TTL 独立，带 `expiresAt` 的 URL 必须由业务素材层及时接管。

`GenerationProgress` 是跨渠道的最小稳定阶段。Provider 的几十种状态只能映射到这四阶段并可附脱敏 diagnostic；云 GPU 的实例 ID、队列内部名称、节点 IP、容器 ID和调度策略不进入公共事件。`GenerationComputeUsage` 只是可选观测结果，不授权 `@duoduo/ai` 管理基础设施。

<a id="images"></a>

## 图片生成

图片生成位于 `@duoduo/ai/images`，因为它与对话模型共享 Provider 认证、目录、传输、Usage、Cost 和错误语义，但拥有不同的输入与输出。Agent 只决定为什么生成、何时生成以及使用哪个模型；AI package 负责如何调用厂商。

### 图片领域类型

```ts
interface ImageModelRef<TProtocol extends string = string> {
  providerInstanceId: ProviderInstanceId;
  modelId: string;
  readonly [protocolBrand]?: TProtocol;
}

declare const imageModelHandleBrand: unique symbol;

interface ImageModelHandle<TProtocol extends string = string> {
  readonly [imageModelHandleBrand]: true;
  readonly [catalogResolutionBrand]: CatalogResolutionIdentity;
  readonly ref: ImageModelRef<TProtocol>;
  readonly definition: Readonly<ImageModelDefinition<TProtocol>>;
}

interface ImageModelDefinition<TProtocol extends string = string> {
  id: string;
  upstreamModelId: string;
  name: string;
  providerInstanceId: ProviderInstanceId;
  publisher?: string;
  family?: string;
  protocol: TProtocol;
  protocolProfileId: string;
  capabilities: ImageModelCapabilities;
  limits: ImageModelLimits;
  inputDefaults: Readonly<{ count: number; size: ImageSize }>;
  requestDefaults?: Readonly<CommonImageRequestDefaults>;
  pricing?: ImageModelPricing;
  providerMetadata?: Readonly<Record<string, JsonValue>>;
}

type ImageSize = { width: number; height: number } | string;

interface ImageModelCapabilities {
  textToImage: boolean;
  referenceImages: 'none' | 'single' | 'multiple';
  streamingPreviews: boolean;
  asyncOperation: boolean;
  seed: boolean;
  outputFormats: readonly ('url' | 'base64')[];
  output: readonly ('text' | 'image')[];
  sizes: readonly ImageSize[];
}

interface ImageModelLimits {
  maxPromptCharacters: number;
  maxReferenceImages: number;
  maxReferenceImageBytes: number;
  maxOutputs: number;
}

interface ImageModelPricing {
  currency: 'USD';
  perImage?: number;
  perMegapixel?: number;
  tokenRates?: TokenRates;
  serviceTierMultipliers?: Readonly<Record<string, number>>;
}

interface ImageUsage {
  generatedImages?: number;
  outputMegapixels?: number;
  generatedVideos?: number;
  generatedSeconds?: number;
  inputVideoSeconds?: number;
  outputMegapixelSeconds?: number;
  acceleratorMilliseconds?: number;
  billedAcceleratorMilliseconds?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheWriteTokensByRetention?: Readonly<
    Partial<Record<'standard' | 'one_hour', number>>
  >;
  serviceTier?: string;
  providerReportedCost?: { currency: string; amount: number };
}

interface ImageCost {
  currency: 'USD';
  images?: number;
  megapixels?: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cacheWriteByRetention?: Readonly<
    Partial<Record<'standard' | 'one_hour', number>>
  >;
  total?: number;
  source: 'computed' | 'provider' | 'mixed';
}

declare function calculateImageCost(
  model: Readonly<ImageModelDefinition>,
  usage: Readonly<ImageUsage>,
): ImageCost | undefined;

interface ImagePromptTextPart {
  type: 'text';
  text: string;
}

interface ImagePromptImagePart {
  type: 'image';
  image: ImageContent;
}

type ImagePromptPart = ImagePromptTextPart | ImagePromptImagePart;

interface ImageGenerationInput {
  content: readonly ImagePromptPart[];
  count?: number;
  size?: ImageSize;
  seed?: number;
}

interface ResolvedImageGenerationInput {
  content: readonly ImagePromptPart[];
  count: number;
  size: ImageSize;
  seed?: number;
}

declare function imagePrompt(
  prompt: string,
  references?: readonly ImageContent[],
): readonly ImagePromptPart[];

export interface ImageProtocolOptionsMap {}
export interface ImageProtocolCompatibilityMap {}

type ImageProtocolOptions<TProtocol extends string> =
  TProtocol extends keyof ImageProtocolOptionsMap
    ? ImageProtocolOptionsMap[TProtocol]
    : Readonly<Record<string, JsonValue>>;

type ImageProtocolCompatibility<TProtocol extends string> =
  TProtocol extends keyof ImageProtocolCompatibilityMap
    ? ImageProtocolCompatibilityMap[TProtocol]
    : Readonly<Record<string, JsonValue>>;

interface CommonImageRequestDefaults {
  timeoutMs?: number;
  retry?: false | RetryPolicy;
  responseFormat?: 'url' | 'base64';
  pollIntervalMs?: number;
}

interface ImageRequestDefaults<
  TProtocol extends string = string,
> extends CommonImageRequestDefaults {
  protocolOptions?: ImageProtocolOptions<TProtocol>;
}

type RuntimeImageProtocolDefaults = Readonly<{
  [TProtocol in keyof ImageProtocolOptionsMap]?: Partial<
    ImageProtocolOptionsMap[TProtocol]
  >;
}>;

interface ImageGenerationOptions<
  TProtocol extends string = string,
> extends ImageRequestDefaults<TProtocol> {
  signal?: AbortSignal;
  credentialOverride?: RequestCredentialOverride;
  metadata?: Readonly<Record<string, JsonValue>>;
  trustedRequest?: TrustedRequestCustomization;
}

interface ResolvedImageGenerationOptions<TProtocol extends string = string> {
  signal: AbortSignal;
  timeoutMs: number;
  retry: false | RetryPolicy;
  responseFormat: 'url' | 'base64';
  pollIntervalMs: number;
  protocolOptions: ImageProtocolOptions<TProtocol>;
  metadata?: Readonly<Record<string, JsonValue>>;
}

interface ImageOperationResumeOptions<TScopeHandle> {
  scope: TScopeHandle;
  signal?: AbortSignal;
  credentialOverride?: RequestCredentialOverride;
  timeoutMs?: number;
  retry?: false | RetryPolicy;
  pollIntervalMs?: number;
  allowCatalogNetwork?: boolean;
}

interface ResolvedImageOperationResumeOptions {
  signal: AbortSignal;
  timeoutMs: number;
  retry: false | RetryPolicy;
  pollIntervalMs: number;
  allowCatalogNetwork: boolean;
}

interface GeneratedImage {
  mediaType: string;
  source:
    | { type: 'url'; url: string; expiresAt?: number }
    | { type: 'base64'; data: string };
  revisedPrompt?: string;
  metadata?: Readonly<Record<string, JsonValue>>;
}

type ImageGenerationOutput =
  | Readonly<{ type: 'text'; text: string }>
  | Readonly<{ type: 'image'; image: GeneratedImage }>;

declare const imageOperationRefBrand: unique symbol;
declare const serializedImageOperationRefBrand: unique symbol;

interface ImageOperationRef {
  readonly [imageOperationRefBrand]: true;
  readonly version: 1;
  toString(): '[REDACTED]';
  toJSON(): '[REDACTED]';
}

type SerializedImageOperationRef = string & {
  readonly [serializedImageOperationRefBrand]: true;
};

interface ImageOperationClaimsBase {
  providerInstanceId: ProviderInstanceId;
  protocol: string;
  modelId: string;
  upstreamModelId: string;
  protocolProfileId: string;
  modelProtocolProfileFingerprint: string;
  providerOperationBindingFingerprint: string;
  providerConfigFingerprint: string;
  authBindingFingerprint: string;
  credentialScopeFingerprint: string;
  operationId: string;
  operationState?: JsonValue;
  issuedAt: number;
  expiresAt: number;
}

type ImageOperationClaims = Readonly<
  ImageOperationClaimsBase & GenerationOperationAuthClaims
>;

interface ImageGenerationResultBase {
  requestId: string;
  model: Readonly<ImageModelDefinition>;
  outputs: readonly ImageGenerationOutput[];
  operation?: ImageOperationRef;
  responseId?: string;
  usage?: ImageUsage;
  cost?: ImageCost;
  diagnostics?: readonly AiDiagnostic[];
  startedAt: number;
  completedAt: number;
}

type ImageGenerationResult =
  | (ImageGenerationResultBase & {
      status: 'completed';
      partial: false;
      error?: never;
    })
  | (ImageGenerationResultBase & {
      status: 'failed';
      partial: boolean;
      error: AiError;
    })
  | (ImageGenerationResultBase & {
      status: 'cancelled';
      partial: boolean;
      error: AiError & { category: 'cancelled' };
    })
  | (ImageGenerationResultBase & {
      status: 'detached';
      partial: boolean;
      operation: ImageOperationRef;
      error?: never;
    });
```

`GenerationOperationPolicy` 默认 `maxTtlMs = 86_400_000`（24 小时）、`allowedClockSkewMs = 60_000`，Runtime 只接受 `60_000 ≤ maxTtlMs ≤ 604_800_000` 与 `0 ≤ allowedClockSkewMs ≤ 300_000`。`issuedAt` 使用 `CredentialStore.now()` 的权威时间；`expiresAt = min(providerExpiresAt ?? +∞, issuedAt + maxTtlMs)` 且在 claims 中必填。codec 返回 `opened` 后 Runtime 校验整数、`issuedAt < expiresAt`、TTL 上限、未来签发偏差与 `expiresAt + skew`，过期由 Runtime 判定，codec 不拥有时钟或业务 TTL。`invalid` 统一映射 `OPERATION_TOKEN_INVALID`，`key_unavailable` 映射 `OPERATION_CODEC_KEY_UNAVAILABLE` 并保留 retryable；codec 不得以 message 或任意 exception 暗示调用方分支。Abort/driver bug 等异常由 Runtime 统一规范化，不能把原始 cause 暴露到公共错误。进程内 ref 也遵循同一时限并在 dispose 时提前失效。

`createOperationCredentialVerifier()` 是 package-owned security wrapper：它校验 override 的 type/scheme，使用带版本、domain separation、长度前缀的 canonical tuple `['@duoduo/ai/image-operation-credential', 1, type, normalizedScheme, secretBytes]`，短暂 materialize `SecretValue`，调用 driver 后尽力清零临时 buffer。省略的 scheme 使用与显式 scheme 不冲突的 `@default/<type>` sentinel；创建与恢复必须采用相同表达，Provider 默认 scheme 的变化还会被 claims 中的 auth-binding fingerprint 拦截。普通调用方和图片 adapter 都拿不到 reveal API。`OperationCredentialDigestDriver` 是与 `TransportDriver` 类似的显式可信计算基；它接收 canonical credential bytes，必须使用 keyed MAC、KMS/HSM MAC 或等价的抗离线猜测机制，禁止无密钥 hash、持久化原文、复用跨用途 key 或记录输入。返回的 digest 使用固定版本的 base64url 编码并设长度上限，`keyId` 只能是非秘密 opaque 标识。

driver 必须如实声明 keyring identity lifetime。`process-local` driver 可以保护当前 Runtime 的 operation proof，但其 ref 不得序列化；声明 `cross-runtime` 时 keyring 必须跨实例持久一致：`create()` 用当前 active key，`verify()` 按 proof 中的 `keyId` 选择对应验证 key，使用 constant-time compare，并在该 key 最后一次签发后至少保留 `maxTtlMs + 2 × allowedClockSkewMs`。轮换只改变新 proof 的 key，不使未过期 operation 失效；`mismatch` 与 `key_unavailable` 通过判别结果明确区分，后者携带 retryable，未知/撤销/暂不可用 key 不得退回进程内指纹或尝试所有 key。package wrapper 保留 driver lifetime，只向外映射统一 mismatch，不暴露 type、scheme、secret 哪一项不符。proof 只允许封入图片或视频 operation claims 的受保护 payload，不进入 public ref、日志、telemetry、catalog、session 或 Provider metadata。

模型能力明确表达文生图、单/多参考图、可用尺寸/宽高比、最大结果数、seed、流式 preview、输出 modality 和异步 operation；不支持的字段在请求前返回 capability error，不静默忽略。canonical input 是非空、有序的 text/image part，Runtime 保留原顺序并按模型限制统计图片；`imagePrompt()` 只是生成“文本在前、引用图随后”的便利纯函数。当前 Qwen/Ark profile 至少要求一个非空文本并只接受它们明确支持的排列，OpenRouter 则保留任意合法交错顺序。Runtime 把 `count` 默认成模型的 `inputDefaults.count`，把 size 解析为显式值或 `inputDefaults.size`，验证 content/size/count/seed 后才产生 `ResolvedImageGenerationInput`。请求选项按 image protocol contract defaults → Provider binding → `ImageModelDefinition` 的 common defaults与选中 image profile defaults → Runtime `imageDefaults`/匹配当前协议的 `imageProtocolDefaults` → per-call 合并为 `ResolvedImageGenerationOptions<TProtocol>`，再统一验证 timeout/retry/output format/poll interval/protocol schema；adapter 不再补默认值。各图片协议通过 `declare module '@duoduo/ai/images'` 扩展 options/compatibility map，并提供与聊天相同的 parser/validator/分层 merge contract。图片的 `credentialOverride`、`trustedRequest` 与聊天走同一 authority/policy。URL 输出携带已知过期时间，AI package 不假设临时 URL 已被业务持久化。

图片结果保留请求时 model/price 快照、Provider `responseId`、有序 text/image outputs、时间、usage、`ImageCost` 与 diagnostics；成本未知仍用 `undefined`，不填 0。token/cache/service-tier 价格和非 USD 行为与文本成本规则相同，再与按张数/像素价格相加；Provider-reported USD cost 使用相同的 provider/computed/mixed 来源规则。

### 图片 Provider 与协议装配

```ts
interface ImageProviderBinding {
  catalogCompatibilityVersion: string;
  modelSource: ImageModelSource;
  protocols: readonly ImageProtocolBinding[];
  filterModels?(
    models: readonly ImageModelDefinition[],
    context: ImageModelFilterContext,
  ): readonly ImageModelDefinition[];
}

interface DiscoveredImageModel {
  id: string;
  name?: string;
  protocol: string;
  capabilities?: Partial<ImageModelCapabilities>;
  limits?: Partial<ImageModelLimits>;
  inputDefaults?: Partial<{ count: number; size: ImageSize }>;
  pricing?: ImageModelPricing;
  providerMetadata?: Readonly<Record<string, JsonValue>>;
}

interface ImageModelDiscoveryContext {
  provider: Readonly<ProviderSnapshot>;
  authIdentity: Readonly<CatalogAuthView>;
  transport: RequestTransport;
  previousProviderState?: JsonValue;
  signal: AbortSignal;
}

interface ImageModelFilterContext {
  provider: Readonly<ProviderSnapshot>;
  authIdentity: Readonly<CatalogAuthView>;
  signal: AbortSignal;
}

interface ImageModelDiscoveryResult {
  models: readonly DiscoveredImageModel[];
  providerState?: JsonValue;
  sourceRevision?: string;
  cacheMaxAgeMs: number;
}

interface ImageModelSource {
  staticModels(): readonly ImageModelDefinition[];
  resolveDiscoveryEndpoint?(
    context: ModelDiscoveryTargetContext,
  ): Promise<URL> | URL;
  resolveDiscoveryHeaders?(
    context: ModelDiscoveryTargetContext & { endpoint: URL },
  ):
    | Promise<Readonly<Record<string, string>>>
    | Readonly<Record<string, string>>;
  discover?(
    context: ImageModelDiscoveryContext,
  ): Promise<ImageModelDiscoveryResult>;
}

interface ImageEndpointContext<TProtocol extends string = string> {
  provider: Readonly<ProviderSnapshot>;
  model: Readonly<ImageModelDefinition<TProtocol>>;
  endpointHints?: Readonly<EndpointHints>;
  providerState?: JsonValue;
  options: Readonly<ResolvedImageGenerationOptions<TProtocol>>;
  signal: AbortSignal;
}

interface ImageHeaderContext<
  TProtocol extends string = string,
> extends ImageEndpointContext<TProtocol> {
  endpoint: URL;
}

interface ImageOperationEndpointContext<TProtocol extends string = string> {
  action: 'poll' | 'cancel';
  operation: Readonly<ImageOperationClaims & { protocol: TProtocol }>;
  provider: Readonly<ProviderSnapshot>;
  model: Readonly<ImageModelDefinition<TProtocol>>;
  endpointHints?: Readonly<EndpointHints>;
  providerState?: JsonValue;
  options: Readonly<ResolvedImageOperationResumeOptions>;
  signal: AbortSignal;
}

interface ImageOperationHeaderContext<
  TProtocol extends string = string,
> extends ImageOperationEndpointContext<TProtocol> {
  endpoint: URL;
}

interface ImageProtocolBindingBase<TProtocol extends string = string> {
  protocol: TProtocol;
  resolveEndpoint(context: ImageEndpointContext<TProtocol>): Promise<URL> | URL;
  resolveHeaders?(
    context: ImageHeaderContext<TProtocol>,
  ):
    | Promise<Readonly<Record<string, string>>>
    | Readonly<Record<string, string>>;
  requestDefaults?: Readonly<ImageRequestDefaults<TProtocol>>;
  defaultProfile: Readonly<ImageModelProtocolProfile<TProtocol>>;
  profiles?: Readonly<Record<string, ImageModelProtocolProfile<TProtocol>>>;
  resolveDiscoveredModelProfile?(
    context: Readonly<{
      model: ImageModelDefinition<TProtocol>;
      providerState?: JsonValue;
    }>,
  ): string | Promise<string>;
  retrySafety: RetrySafety;
}

interface ImageModelProtocolProfile<TProtocol extends string = string> {
  id: string;
  compatibility: Readonly<ImageProtocolCompatibility<TProtocol>>;
  protocolDefaults?: Readonly<ImageProtocolOptions<TProtocol>>;
}

interface DirectImageProtocolBinding<
  TProtocol extends string = string,
> extends ImageProtocolBindingBase<TProtocol> {
  operationMode: 'direct';
  loadAdapter(): Promise<DirectImageProtocolAdapter<TProtocol>>;
}

interface ResumableImageProtocolBinding<
  TProtocol extends string = string,
> extends ImageProtocolBindingBase<TProtocol> {
  operationMode: 'resumable';
  operationCompatibilityVersion: string;
  operationActions: readonly ('poll' | 'cancel')[];
  resolveOperationEndpoint(
    context: ImageOperationEndpointContext<TProtocol>,
  ): Promise<URL> | URL;
  resolveOperationHeaders?(
    context: ImageOperationHeaderContext<TProtocol>,
  ):
    | Promise<Readonly<Record<string, string>>>
    | Readonly<Record<string, string>>;
  loadAdapter(): Promise<ResumableImageProtocolAdapter<TProtocol>>;
}

type ImageProtocolBinding<TProtocol extends string = string> =
  | DirectImageProtocolBinding<TProtocol>
  | ResumableImageProtocolBinding<TProtocol>;

interface ImageProtocolAdapterBase<TProtocol extends string = string> {
  id: TProtocol;
  contract: ImageProtocolContract<TProtocol>;
}

interface DirectImageProtocolAdapter<
  TProtocol extends string = string,
> extends ImageProtocolAdapterBase<TProtocol> {
  operationMode: 'direct';
  run(
    request: ImageProtocolRequest<TProtocol>,
    sink: ImageProtocolEventSink,
  ): Promise<ImageProtocolTerminal>;
}

interface ResumableImageProtocolAdapter<
  TProtocol extends string = string,
> extends ImageProtocolAdapterBase<TProtocol> {
  operationMode: 'resumable';
  parseOperationState(input: unknown): JsonValue | undefined;
  run(
    request: ImageProtocolRequest<TProtocol>,
    sink: ResumableImageProtocolEventSink,
  ): Promise<ImageProtocolTerminal>;
  resume(
    request: ImageResumeRequest<TProtocol>,
    sink: ImageProtocolEventSink,
  ): Promise<ImageProtocolTerminal>;
  cancel?(request: ImageCancelRequest<TProtocol>): Promise<void>;
}

type ImageProtocolAdapter<TProtocol extends string = string> =
  | DirectImageProtocolAdapter<TProtocol>
  | ResumableImageProtocolAdapter<TProtocol>;

interface ImageProtocolContract<TProtocol extends string = string> {
  requestDefaults?: Readonly<ImageRequestDefaults<TProtocol>>;
  parseOptions(input: unknown): ImageProtocolOptions<TProtocol>;
  mergeOptions(
    layers: readonly (ImageProtocolOptions<TProtocol> | undefined)[],
  ): ImageProtocolOptions<TProtocol>;
  parseCompatibility(input: unknown): ImageProtocolCompatibility<TProtocol>;
}

interface ImageProtocolEventSink {
  publish(event: ImageProtocolProgressEvent): Promise<void>;
}

interface ResumableImageProtocolEventSink extends ImageProtocolEventSink {
  setOperation(input: {
    operationId: string;
    operationState?: JsonValue;
    providerExpiresAt?: number;
  }): Promise<void>;
  operationTransport(action: 'poll' | 'cancel'): Promise<RequestTransport>;
}

type ImageProtocolProgressEvent =
  | ({ type: 'generation_progress' } & GenerationProgress)
  | {
      type: 'generation_preview';
      outputIndex: number;
      image: GeneratedImage;
    }
  | {
      type: 'generation_output';
      outputIndex: number;
      output: ImageGenerationOutput;
    };

interface ImageProtocolTerminalBase {
  usage?: ImageUsage;
  responseId?: string;
  diagnostics?: readonly AiDiagnostic[];
}

type ImageProtocolTerminal =
  | (ImageProtocolTerminalBase & { status: 'completed' })
  | (ImageProtocolTerminalBase & { status: 'failed'; error: AiError })
  | (ImageProtocolTerminalBase & {
      status: 'cancelled';
      error: AiError & { category: 'cancelled' };
    });

interface ImageProtocolRequest<TProtocol extends string = string> {
  provider: Readonly<ProviderSnapshot>;
  model: Readonly<ImageModelDefinition<TProtocol>>;
  input: Readonly<ResolvedImageGenerationInput>;
  compatibility: Readonly<ImageProtocolCompatibility<TProtocol>>;
  options: Readonly<ResolvedImageGenerationOptions<TProtocol>>;
  transport: RequestTransport;
  resources: ResourceLoader;
  signal: AbortSignal;
}

interface ImageResumeRequest<TProtocol extends string = string> {
  operation: Readonly<ImageOperationClaims & { protocol: TProtocol }>;
  provider: Readonly<ProviderSnapshot>;
  model: Readonly<ImageModelDefinition<TProtocol>>;
  compatibility: Readonly<ImageProtocolCompatibility<TProtocol>>;
  options: Readonly<ResolvedImageOperationResumeOptions>;
  pollTransport: RequestTransport;
  cancelTransport?: RequestTransport;
  resources: ResourceLoader;
  signal: AbortSignal;
}

interface ImageCancelRequest<TProtocol extends string = string> {
  operation: Readonly<ImageOperationClaims & { protocol: TProtocol }>;
  provider: Readonly<ProviderSnapshot>;
  model: Readonly<ImageModelDefinition<TProtocol>>;
  compatibility: Readonly<ImageProtocolCompatibility<TProtocol>>;
  transport: RequestTransport;
  signal: AbortSignal;
}
```

`ImageProtocolRequest` 与聊天请求一样只接收不可变 Provider/model 快照、已验证并补齐默认值的 input/options、选中 profile compatibility，以及绑定 create target 的 `RequestTransport` 和 signal。图片 profile 的选择、校验、digest 与动态 resolver 规则和文本 `ModelProtocolProfile` 相同。任务 ID 出现前不能安全构造 poll/cancel URL，因此 resumable adapter 先调用 `setOperation()`，再从 sink 请求 action-bound `operationTransport()`；Runtime 用受信 binding 的 operation resolver、当前 auth 与 NetworkPolicy 创建新的 protected target，adapter 仍不能拼接 endpoint/auth。跨进程 `resume` 在全部 preflight 后直接接收绑定 poll target 的 `pollTransport`，仅当 binding 声明 cancel 时才有 `cancelTransport`。这些请求都不接触 scope key、`ResolvedRequestAuth`、endpoint auth material 或持久凭据。`images` 模块定义接口与编排，Provider 工厂从外侧注入 binding，因此不存在 `images → providers` 的依赖环。

`operationMode` 是注册不变量：模型 `asyncOperation` 必须与 binding mode 双向等价，false 只能指向 `direct`，true 只能指向 `resumable`；同一上游模型若同时提供同步与任务 API，目录必须给出两个 public model ID、同一 `upstreamModelId` 和两个明确 binding，不能由 adapter 在付费请求后临时升级 mode。`resumable` binding 的 actions 必须包含且只包含一次 `poll`，可选一次 `cancel`，并必须加载同 mode、同 protocol ID且实现必选 `resume()`/`parseOperationState()` 的 adapter；声明 cancel 时 adapter 的 `cancel()` 也必选。Runtime 在启动 adapter/Provider 请求前验证。`direct` adapter根本拿不到 `setOperation()`；resumable adapter 一旦远端 create 成功，必须在任何 poll/output/成功 terminal 前恰好一次 `setOperation()`，校验非空/限长 operation ID、经 adapter schema round-trip 的限长 `operationState` 与可选 Provider expiry，封装 ref 后由 Runtime 自行发布带 operation 的 progress event，adapter 不接触 public ref。create 返回成功却未 set、重复 set 或先 poll 均是 protocol violation。state 只能保存恢复协议所需的非凭据字段，不得含 endpoint、header、token 或 raw scope；open 后在 operation poll 前再次用当前 adapter 解析。`operationTransport()` 在 set 之前、未声明 action或终态之后调用都失败。这样不可能生成一个没有恢复实现或把认证路由偷偷塞进 token 的任务句柄。

`operationCompatibilityVersion` 只存在于 resumable binding，是对持久任务恢复格式的显式版本；即使 protocol ID 不变，只要 operation ID 解释、poll/cancel route、响应 schema 或恢复所需 compatibility 发生不兼容变化就必须递增。Runtime 先对选中 image profile 计算 `modelProtocolProfileFingerprint`，再以稳定 canonical encoding 计算 `providerOperationBindingFingerprint = SHA-256(['@duoduo/ai/image-operation-binding',1,providerKind,providerInstanceId,providerConfigFingerprint,protocol,operationCompatibilityVersion,modelId,upstreamModelId,modelProtocolProfileFingerprint])`。它只包含非秘密配置，可在不同进程确定性重算；Runtime-local `registrationGeneration`、包构建时间和随机数不得参与。resume 必须在启动 operation poll 前等值校验 public model ID、upstream model ID、profile 与该 fingerprint，从而允许兼容重启，也拒绝错误实例、配置、目录映射或不兼容 adapter。

和聊天相同，公共 `ImageGenerationStream` 只由 Runtime 拥有；adapter 仅通过 attempt-local sink 报告 operation/progress/output 并返回 terminal。Runtime 负责封装 operation token、唯一 start/end/error、partial outputs、重试边界和结果聚合。

<a id="image-operation"></a>

### 图片流与任务恢复

```ts
type ImageGenerationEvent =
  | {
      type: 'generation_start';
      sequence: number;
      model: Readonly<ImageModelDefinition>;
      operation?: ImageOperationRef;
    }
  | {
      type: 'generation_progress';
      sequence: number;
      phase?: GenerationPhase;
      progress?: number;
      queuePosition?: number;
      estimatedWaitMs?: number;
      operation?: ImageOperationRef;
    }
  | {
      type: 'generation_preview';
      sequence: number;
      outputIndex: number;
      image: GeneratedImage;
    }
  | {
      type: 'generation_output';
      sequence: number;
      outputIndex: number;
      output: ImageGenerationOutput;
    }
  | {
      type: 'generation_end';
      sequence: number;
      result: Extract<ImageGenerationResult, { status: 'completed' }>;
    }
  | {
      type: 'generation_error';
      sequence: number;
      result: Extract<
        ImageGenerationResult,
        { status: 'failed' | 'cancelled' }
      >;
    }
  | {
      type: 'generation_detached';
      sequence: number;
      result: Extract<ImageGenerationResult, { status: 'detached' }>;
    };

interface ImageGenerationStream extends AsyncIterable<ImageGenerationEvent> {
  result(): Promise<ImageGenerationResult>;
  abort(reason?: string): void;
  detach(): Promise<ImageOperationRef>;
}
```

每个事件有递增 `sequence`；output/preview 有稳定 `outputIndex`，终态携带唯一 `ImageGenerationResult`。`ImageGenerationStream` 采用与对话流相同的单可选 observer、惰性启动、drain 模式、唯一终态和错误 resolve 语义。

同步/流式厂商可直接产出结果；任务式厂商在 progress 中提供 public `ImageOperationRef`。Runtime 独占 branded ref 的创建与内部 sealed token 存取；package-owned 图片 claims codec 先把 claims 编入 `GenerationOperationEnvelope { domain: 'images' }`，再交给可注入的 `GenerationOperationCodec` 封装/打开普通 sealed string，不需要外部 codec 认识图片类型或伪造 package-private brand。claims 绑定 scope、auth binding、稳定的 Provider operation binding、model、protocol、operation ID 与必填有效期。stored operation 绑定 store 的 identity lifetime，ambient operation 绑定 resolver/环境身份 lifetime，二者都携带 `credentialInstanceId`；override operation 只绑定 proof 和 verifier lifetime，禁止任何 Runtime-local credential instance。任一 `process-local` auth identity 都可创建当前 Runtime 内恢复的 operation ref，但即使配置了持久 codec 也不得序列化；只有 auth identity、scope fingerprint authority 和 codec 均声明 `cross-runtime` 才可进入 sealed token。codec 返回 `opened` 后由 package 的严格判别联合 schema 拒绝非法组合。

持久 codec 必须显式声明 `persistence: 'cross-runtime'`，并提供带版本/key ID 的机密性与完整性保护，不能只签名明文 claims；它必须在对应 key 最后一次 seal 后至少保留 `maxTtlMs + 2 × allowedClockSkewMs` 的解封能力，并对未知版本、未知 key、超长 token、schema pollution 和解封失败统一 fail closed。codec 只负责 envelope/AEAD，不判断业务时间；issuedAt/expiresAt 由 Runtime 使用权威 clock 校验。ref 的 `toString()`/`toJSON()` 默认脱敏；调用方要跨进程恢复时必须显式调用 `ai.images.serializeOperation()` 得到可写入数据库/队列的 branded secret string，读取后用 `parseOperation()` 恢复。serialized value 必须按 credential 等级加密存储和日志脱敏，parse 只验证 envelope 形状并由 Runtime 包装，完整性/claims 在 `resume()` 的 codec open 阶段验证。没有 codec 时 `serializeOperation()` reject `OPERATION_NOT_PERSISTABLE`；operation auth identity 为 `process-local` 时 reject `OPERATION_AUTH_NOT_PERSISTABLE`；scope authority fingerprint 为 `process-local` 时 reject `OPERATION_SCOPE_NOT_PERSISTABLE`。任一失败都不能被 codec 存在绕过；普通进程内异步任务仍合法，进程重启后明确不可恢复。

对可能产生异步 operation 的 override 图片调用，Runtime 在启动 adapter 前通过 `OperationCredentialVerifier.create()` 生成 proof；`key_unavailable` 在此终止本次流，因而不会创建远端任务。proof 只写入 sealed/in-memory claims，adapter、Provider 与调用方都看不到。若配置了持久 codec，同一逻辑 verifier keyring 必须可被其他进程实例使用；若只有进程内 ref，Runtime 仍保存 proof 并在恢复时走同一验证路径，避免形成两套安全语义。`GenerationOperationCodec` 负责 envelope 的机密性、完整性与版本，domain claims codec 负责图片/视频 schema，`OperationCredentialVerifier` 只证明恢复方再次提供了同一 type/scheme/secret，Runtime 负责 TTL 与所有 binding；这些职责不能合并成一个“万能 token codec”。

`await ai.images.resume(operationRef, options)` 的 control-plane preflight 顺序固定为：进程内 ref 从私有表取回 claims，serialized ref 则要求 codec 得到 `opened`；两者随后执行同一严格 claims/TTL 校验 → authority 以 `resume_operation` 解析 scope → `verifyFingerprint()` 校验旧 key ID 下的 scope 绑定 → 校验当前 Provider config/auth/operation binding → 解析 stored/ambient credential instance 与 identity lifetime，或验证 override proof。codec 的 `invalid` 与 `key_unavailable` 在 authority 前结束；stored/ambient operation 禁止突然加入 override，当前 environment/process-local identity 必须与 claims 等值且只能在原 Runtime 命中；override operation 缺少 override/proof 返回 `OPERATION_CREDENTIAL_REQUIRED`，type/scheme/secret 不同返回非重试的 auth error `OPERATION_CREDENTIAL_MISMATCH`，proof/codec/scope key 不可用返回各自 typed key-unavailable error，不得 ambient fallback 或改读另一个 credential slot。校验使用 verifier 的 constant-time 路径，不把“类型不符”“scheme 不符”和“secret 不符”暴露成可枚举的外部差异。

这里的“preflight 不联网”准确含义是：上述身份与 binding 校验完成前，禁止调用模型/operation 的 `RequestTransport`、`AuthHttpTransport` 或 `ImageProtocolAdapter.resume()`；authority、外部 DB store、KMS codec/verifier 与 ambient credential resolver 自身可能合法使用宿主网络。身份校验完成后，Runtime 可从稳定 `providerCatalogBindingFingerprint` 的持久 cache 恢复动态图片模型；cache 不可用时允许按 `allowCatalogNetwork` 与 NetworkPolicy 做目录 discovery，但仍不得发 operation poll，直到 model/protocol/capability 与 resumable adapter 均验证完成。目录失败以 control-plane error 返回，稍后可重试，不用不可信裸 model snapshot 绕过目录。成功返回的 stream 已有确定 model 快照，因而仍满足 `generation_start` 首事件和终态模型不变式。operation token/ID/proof 都按 secret 处理，默认不进日志。

`abort()` 总是立即取消本地 create/poll 等待并产出 cancelled 终态；若已经 set operation 且 binding 声明 cancel，Runtime 以独立有界 signal、当前重新校验的 claims 与 cancel-bound transport 最多调用一次 adapter `cancel()`。远端成功才记 `REMOTE_OPERATION_CANCELLED` diagnostic；不支持、超时或失败不能把本地 cancelled 改写为成功，也不能无限拖延终态。没有远端 cancel 契约时文档和结果都只声称“停止本地等待”。

`detach()` 是明确的 handoff：只在 resumable stream 已发布 operation ref 且尚无终态时成功；过早调用 reject `OPERATION_NOT_AVAILABLE` 且不改变 stream。成功后立即停止本地 poll、释放 request/session lease、绝不调用远端 cancel，并以唯一 `generation_detached` / `status: 'detached'` 终态结束；已产生 outputs 保留且决定 `partial`。它返回同一个 ref，调用方可先 `serializeOperation()` 再交给另一进程恢复。detach/abort/远端 terminal 竞态只允许一个 winner，loser 观察既有终态，不产生第二次 poll/cancel。

公共入口为：

```ts
await ai.images.models.find(ref, scope);
await ai.images.models.require(ref, scope);
await ai.images.models.list(scope, { providerInstanceId });
ai.images.models.refresh(providerInstanceId, scope);
ai.images.stream(imageModel, input, options);
ai.images.generate(imageModel, input, options); // stream(...).result()
ai.images.resume(operationRef, options);
await ai.images.serializeOperation(operationRef);
await ai.images.parseOperation(serializedOperationRef);
```

operation 方法职责与错误边界固定如下，后续章节不得覆盖：

| 方法                      | 做什么                                                                                             | 不做什么                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `serializeOperation(ref)` | 校验进程内 ref、identity lifetime 与 scope persistence，调用 codec seal                            | 不联网、不重新解析 credential、不接受裸 string；key unavailable 使用 typed code |
| `parseOperation(string)`  | 只做长度、base64url/envelope 外形和 branded wrapper；明显畸形为 `OPERATION_TOKEN_INVALID`          | 不 open codec、不检查 claims/TTL/scope，不发 poll                               |
| `resume(ref, options)`    | codec open、claims/TTL/authority/scope/auth/config/profile/model 全部 preflight 后创建 poll stream | 任一 preflight 未完成前不调用 adapter/operation transport                       |
| `detach()`                | 停止本地 poll并保留远端任务                                                                        | 不 seal、不 cancel 远端、不把 direct 调用伪装成 operation                       |

```ts
interface ImageModelListFilter {
  providerInstanceId?: ProviderInstanceId;
  protocol?: string;
  outputFormat?: 'url' | 'base64';
  supports?: 'textToImage' | 'streamingPreviews' | 'asyncOperation' | 'seed';
}

interface ImageModelRefreshReport {
  providerInstanceId: ProviderInstanceId;
  source: 'static' | 'fresh' | 'cached' | 'stale' | 'failed';
  models: readonly ImageModelHandle[];
  errors: readonly AiError[];
}

interface ImageModelListResult {
  models: readonly ImageModelHandle[];
  reports: readonly ImageModelRefreshReport[];
}

interface ImageInventoryModelEntry<TProtocol extends string = string> {
  definition: Readonly<ImageModelDefinition<TProtocol>>;
  source: 'static' | 'explicit';
  availability: 'unknown';
}

interface ImagesApi<TScopeHandle> {
  readonly inventory: {
    find<TProtocol extends string>(
      ref: ImageModelRef<TProtocol>,
    ): Promise<ImageInventoryModelEntry<TProtocol> | undefined>;
    list(
      filter?: ImageModelListFilter,
    ): Promise<readonly ImageInventoryModelEntry[]>;
  };
  readonly models: {
    find<TProtocol extends string>(
      ref: ImageModelRef<TProtocol>,
      scope: TScopeHandle,
      options?: ModelReadOptions,
    ): Promise<ImageModelHandle<TProtocol> | undefined>;
    require<TProtocol extends string>(
      ref: ImageModelRef<TProtocol>,
      scope: TScopeHandle,
      options?: ModelReadOptions,
    ): Promise<ImageModelHandle<TProtocol>>;
    list(
      scope: TScopeHandle,
      filter?: ImageModelListFilter,
      options?: ModelReadOptions,
    ): Promise<ImageModelListResult>;
    refresh(
      providerInstanceId: ProviderInstanceId,
      scope: TScopeHandle,
      options?: ModelRefreshOptions,
    ): Promise<ImageModelRefreshReport>;
  };
  stream<TProtocol extends string>(
    model: ImageModelHandle<TProtocol>,
    input: ImageGenerationInput,
    options: ImageGenerationOptions<TProtocol> & { scope: TScopeHandle },
  ): ImageGenerationStream;
  generate<TProtocol extends string>(
    model: ImageModelHandle<TProtocol>,
    input: ImageGenerationInput,
    options: ImageGenerationOptions<TProtocol> & { scope: TScopeHandle },
  ): Promise<ImageGenerationResult>;
  resume(
    operation: ImageOperationRef,
    options: ImageOperationResumeOptions<TScopeHandle>,
  ): Promise<ImageGenerationStream>;
  serializeOperation(
    operation: ImageOperationRef,
  ): Promise<SerializedImageOperationRef>;
  parseOperation(serialized: string): Promise<ImageOperationRef>;
}
```

`resume()` 的 timeout/retry/pollInterval 只控制本次本地等待，不改变已经提交的生成参数；合并顺序为 Runtime `imageDefaults` 中对应公共字段 → per-resume options，`allowCatalogNetwork` 默认 true。设为 false 时只能使用已验证的静态/explicit 或未过期持久目录，缺 model 直接 `CATALOG_NETWORK_DISABLED`，不能拿 claims 中的 model ID 构造裸 definition。operation 的创建输入、协议 state 与 Provider expiry 来自 sealed claims，不允许 resume 调用方重写 response format、size、count、seed 或 protocol options。

图片目录使用 `CatalogCacheKey.capability = 'images'`，与聊天目录类型和缓存空间分开，但共享同一 Provider auth、scope authority 与 auth identity。

<a id="image-matrix"></a>

### 内建图片矩阵

| Provider     | 图片 protocol                               | 认证 / endpoint                                  | operation mode 与最小 fixture                             |
| ------------ | ------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------- |
| `openrouter` | `openrouter-images`                         | 复用 `OPENROUTER_API_KEY` 与 OpenRouter base URL | direct；文生图、参考图、多结果、错误、取消                |
| `qwen`       | `dashscope-images`, `dashscope-image-tasks` | 复用 Qwen region/workspace resolver              | 前者 direct；后者 resumable，覆盖 create/poll/cancel/过期 |
| `doubao`     | `ark-images`                                | 复用 `ARK_API_KEY` 与 Ark resolver               | direct；Seedream 文生图、参考图、多结果、错误             |
| `xai`        | `xai-images`                                | 复用 `XAI_API_KEY`、xAI OAuth 与 xAI base URL    | 以官方 Imagine contract 固定生成/编辑、参考图与错误       |

五个图片 protocol subpath 第一版不开放任意透传字段；ordered content/count/size/seed/output format/timeout/retry 已由 common 类型覆盖。差异全部进入受信 compatibility：

```ts
type NoImageProtocolFields = Readonly<Record<string, never>>;

interface OpenRouterImagesCompatibility {
  wireVersion: 1;
  requestOperation: 'chat-completions';
  outputEncoding: 'data-url';
}

interface DashScopeImagesCompatibility {
  wireVersion: 1;
  invocation: 'synchronous';
}

interface DashScopeImageTasksCompatibility {
  wireVersion: 1;
  invocation: 'asynchronous';
  taskApiVersion: 1;
  asyncHeader: 'X-DashScope-Async: enable';
  cancelPendingOnly: true;
}

interface ArkImagesCompatibility {
  wireVersion: 'ark-v3';
  invocation: 'synchronous';
}

interface XAiImagesCompatibility {
  wireVersion: 1;
  supportsEditing: boolean;
  maxReferenceImages: number;
}

declare module '@duoduo/ai/images' {
  interface ImageProtocolOptionsMap {
    'openrouter-images': NoImageProtocolFields;
    'dashscope-images': NoImageProtocolFields;
    'dashscope-image-tasks': NoImageProtocolFields;
    'ark-images': NoImageProtocolFields;
    'xai-images': NoImageProtocolFields;
  }

  interface ImageProtocolCompatibilityMap {
    'openrouter-images': OpenRouterImagesCompatibility;
    'dashscope-images': DashScopeImagesCompatibility;
    'dashscope-image-tasks': DashScopeImageTasksCompatibility;
    'ark-images': ArkImagesCompatibility;
    'xai-images': XAiImagesCompatibility;
  }
}
```

`openrouter-images` 固定 `POST {baseUrl}/chat/completions`、`stream: false` 与由模型 `output` 能力决定的 modalities；它按 canonical input 原顺序序列化交错 text/image part，URL/base64 引用经过 ResourceLoader/大小策略后成为合法 content part。响应保留首个 choice 中经 schema 验证的有序 text 与多个 data-URL image，同时提取 Provider response ID、input/output/cache token usage，并用 token/cache rate 计算成本；只返回文本、只返回图片或两者混合都由模型 output capability 校验。它是 direct binding，不创建 operation。`ark-images` 第一版固定 Ark `/api/v3/images/generations` direct API；当前已验证资料没有独立任务 poll/cancel 契约，因此不得为了“统一”伪造 operation。未来官方异步 API 必须作为新 compatibility/operation version 加入，不悄悄改变旧 binding。

`xai-images` 以 [xAI Imagine API](https://docs.x.ai/developers/model-capabilities/imagine) 的实现时 pinned contract 为准，和 `xai-videos` 复用同一 Provider/auth，但使用独立图片 model/profile/route 和结果类型。生成、编辑、参考图数量、Files API 输入和临时/持久产物行为必须由官方 fixture 固定；不得因为 Grok Imagine 同时提供图片与视频就共享一个 media adapter。

Qwen curated model metadata 逐模型决定精确 `imageRoute` 和固定 protocol：官方同步调用进入 direct `dashscope-images`，官方异步任务进入 resumable `dashscope-image-tasks`；调用方不能覆盖，也不能只按 Wan 大版本猜 route。同一官方 `wan2.6-image` 首版暴露两个稳定 public ref：`wan2.6-image`（direct）与 `wan2.6-image@task`（resumable），两者 `upstreamModelId` 都是 `wan2.6-image`，catalog/handle/operation identity 仍按不同 public ID 与 protocol 区分。direct fixture 固定 `POST {regionalBase}/api/v1/services/aigc/multimodal-generation/generation`；task create fixture 固定 `POST {regionalBase}/api/v1/services/aigc/image-generation/generation` 并由受信 resolver加 `X-DashScope-Async: enable`。只有官方 manifest 明确验证两种模式的模型才生成双 ref；旧模型可使用经官方 snapshot 记录的 `/api/v1/services/aigc/text2image/image-synthesis`，后续模型必须以各自 reference/digest 进入 curated 表。成功 task 响应只提取限长 `task_id`/`task_status`；poll 固定 `GET {regionalBase}/api/v1/tasks/{taskId}`，cancel 固定 `POST .../tasks/{taskId}/cancel` 且仅 PENDING 可能成功。状态映射为 PENDING/RUNNING → progress，SUCCEEDED → outputs，FAILED/UNKNOWN → failed，CANCELED → cancelled；completed task 与 result URL 的官方保留期通常为 24 小时，因此 adapter 将该 provider expiry 传给 Runtime，再由全局 operation policy 取较小值。task ID 只能作为单个 percent-encoded path segment，不能带 slash/query/fragment。

Qwen task 端口以官方 [异步任务管理 API](https://www.alibabacloud.com/help/en/model-studio/manage-asynchronous-tasks) 与 [Wan 图片 API](https://www.alibabacloud.com/help/en/model-studio/wan-image-generation-api-reference) 为准；豆包只承诺当前官方 [Ark 图片生成 API](https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01) 可验证的 direct 语义。

每个图片 binding 都必须有请求序列化、其真实 operation mode、partial output、usage、本地取消和终态 fixture；只有声明 remote cancel 的 binding 才测试远端取消。OpenRouter fixture 额外锁定交错输入、text+image output、response ID、cache usage 与 token cost；Qwen fixture 锁定两个 public ID 发送同一 upstream model 但使用不同 route/mode；豆包 fixture同时覆盖显式 Model ID 与 Endpoint ID；xAI fixture 覆盖生成/编辑、参考图和产物有效期。内建范围对齐 PI 的 OpenRouter Images，并增加 Qwen/Alibaba Model Studio、豆包/Volcengine Ark Seedream 与 Grok Imagine。豆包图片接口参考：

- <https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01>

生成图片的业务归属、版本、素材存储和授权不属于 `@duoduo/ai`。

<a id="videos"></a>

## 视频生成

视频位于 `@duoduo/ai/videos`。它复用 Provider 认证、目录、transport、generation operation、Telemetry 和错误语义，但不复用图片请求类型。视频不是“图片结果换成 MP4”：它有生成、编辑、续写、多模态参考、音频、编码阶段、长任务和临时大文件等独立不变量。

### 视频领域类型

```ts
type VideoOperationKind = 'generate' | 'edit' | 'extend';
type VideoResolution = string | { width: number; height: number };

interface VideoNumericRange {
  min: number;
  max: number;
  step?: number;
}

interface VideoModelRef<TProtocol extends string = string> {
  providerInstanceId: ProviderInstanceId;
  modelId: string;
  readonly [protocolBrand]?: TProtocol;
}

declare const videoModelHandleBrand: unique symbol;

interface VideoModelHandle<TProtocol extends string = string> {
  readonly [videoModelHandleBrand]: true;
  readonly [catalogResolutionBrand]: CatalogResolutionIdentity;
  readonly ref: VideoModelRef<TProtocol>;
  readonly definition: Readonly<VideoModelDefinition<TProtocol>>;
}

interface VideoModelDefinition<TProtocol extends string = string> {
  id: string;
  upstreamModelId: string;
  name: string;
  providerInstanceId: ProviderInstanceId;
  publisher?: string;
  family?: string;
  protocol: TProtocol;
  protocolProfileId: string;
  capabilities: VideoModelCapabilities;
  limits: VideoModelLimits;
  inputDefaults: Readonly<{
    durationSeconds?: number;
    resolution?: VideoResolution;
    aspectRatio?: string;
    fps?: number;
    generateAudio?: boolean;
  }>;
  requestDefaults?: Readonly<CommonVideoRequestDefaults>;
  pricing?: VideoModelPricing;
  providerMetadata?: Readonly<Record<string, JsonValue>>;
}

interface VideoModelCapabilities {
  operations: readonly VideoOperationKind[];
  inputModalities: readonly ('text' | 'image' | 'video' | 'audio')[];
  imageRoles: readonly ('reference' | 'first_frame' | 'last_frame')[];
  videoRoles: readonly ('source' | 'reference')[];
  audioInput: boolean;
  audioOutput: boolean;
  streamingPreviews: boolean;
  asyncOperation: boolean;
  seed: boolean;
  durationsSeconds: readonly number[] | VideoNumericRange;
  resolutions: readonly VideoResolution[];
  aspectRatios: readonly string[];
  frameRates: readonly number[];
}

interface VideoModelLimits {
  maxPromptCharacters: number;
  maxReferenceImages: number;
  maxReferenceImageBytes: number;
  maxInputVideos: number;
  maxInputVideoBytes: number;
  maxInputVideoSeconds: number;
  maxInputAudioBytes: number;
  maxOutputs: number;
}

interface VideoModelPricing {
  currency: 'USD';
  perRequest?: number;
  perOutputSecond?: number;
  perInputVideoSecond?: number;
  perOutputMegapixelSecond?: number;
  serviceTierMultipliers?: Readonly<Record<string, number>>;
}

interface VideoResourceInput {
  mediaType: string;
  source: { type: 'url'; url: string } | { type: 'base64'; data: string };
}

type VideoPromptPart =
  | Readonly<{ type: 'text'; text: string }>
  | Readonly<{
      type: 'image';
      role: 'reference' | 'first_frame' | 'last_frame';
      image: ImageContent;
    }>
  | Readonly<{
      type: 'video';
      role: 'source' | 'reference';
      video: VideoResourceInput;
    }>
  | Readonly<{
      type: 'audio';
      role: 'source' | 'reference';
      audio: VideoResourceInput;
    }>;

interface VideoGenerationInput {
  operation: VideoOperationKind;
  content: readonly VideoPromptPart[];
  durationSeconds?: number;
  resolution?: VideoResolution;
  aspectRatio?: string;
  fps?: number;
  seed?: number;
  generateAudio?: boolean;
  count?: number;
}

interface ResolvedVideoGenerationInput {
  operation: VideoOperationKind;
  content: readonly VideoPromptPart[];
  durationSeconds?: number;
  resolution?: VideoResolution;
  aspectRatio?: string;
  fps?: number;
  seed?: number;
  generateAudio: boolean;
  count: number;
}

interface GeneratedVideo {
  artifact: GenerationArtifact;
  durationSeconds?: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio?: boolean;
  poster?: GeneratedImage;
}

interface VideoUsage {
  generatedVideos?: number;
  generatedSeconds?: number;
  inputVideoSeconds?: number;
  outputMegapixelSeconds?: number;
  compute?: GenerationComputeUsage;
  serviceTier?: string;
  providerReportedCost?: { currency: string; amount: number };
}

interface VideoCost {
  currency: 'USD';
  requests?: number;
  outputSeconds?: number;
  inputVideoSeconds?: number;
  outputMegapixelSeconds?: number;
  total?: number;
  source: 'computed' | 'provider' | 'mixed';
}

declare function calculateVideoCost(
  model: Readonly<VideoModelDefinition>,
  usage: Readonly<VideoUsage>,
): VideoCost | undefined;

type VideoProtocolOptions<TProtocol extends string> =
  TProtocol extends keyof VideoProtocolOptionsMap
    ? VideoProtocolOptionsMap[TProtocol]
    : Readonly<Record<string, JsonValue>>;

interface VideoGenerationOptions<
  TProtocol extends string = string,
> extends CommonVideoRequestDefaults {
  signal?: AbortSignal;
  credentialOverride?: RequestCredentialOverride;
  protocolOptions?: VideoProtocolOptions<TProtocol>;
  metadata?: Readonly<Record<string, JsonValue>>;
  trustedRequest?: TrustedRequestCustomization;
}

interface ResolvedVideoGenerationOptions<TProtocol extends string = string> {
  signal: AbortSignal;
  timeoutMs: number;
  retry: false | RetryPolicy;
  responseFormat: 'url' | 'base64';
  pollIntervalMs: number;
  protocolOptions: VideoProtocolOptions<TProtocol>;
  metadata?: Readonly<Record<string, JsonValue>>;
}

interface VideoOperationResumeOptions<TScopeHandle> {
  scope: TScopeHandle;
  signal?: AbortSignal;
  credentialOverride?: RequestCredentialOverride;
  timeoutMs?: number;
  retry?: false | RetryPolicy;
  pollIntervalMs?: number;
  allowCatalogNetwork?: boolean;
}

interface ResolvedVideoOperationResumeOptions {
  signal: AbortSignal;
  timeoutMs: number;
  retry: false | RetryPolicy;
  pollIntervalMs: number;
  allowCatalogNetwork: boolean;
}

declare const videoOperationRefBrand: unique symbol;
declare const serializedVideoOperationRefBrand: unique symbol;

interface VideoOperationRef {
  readonly [videoOperationRefBrand]: true;
  readonly version: 1;
  toString(): '[REDACTED]';
  toJSON(): '[REDACTED]';
}

type SerializedVideoOperationRef = string & {
  readonly [serializedVideoOperationRefBrand]: true;
};

interface VideoOperationClaimsBase {
  providerInstanceId: ProviderInstanceId;
  protocol: string;
  modelId: string;
  upstreamModelId: string;
  protocolProfileId: string;
  modelProtocolProfileFingerprint: string;
  providerOperationBindingFingerprint: string;
  providerConfigFingerprint: string;
  authBindingFingerprint: string;
  credentialScopeFingerprint: string;
  operationKind: VideoOperationKind;
  inputDigest: string;
  outputSpecification: JsonValue;
  operationId: string;
  operationState?: JsonValue;
  issuedAt: number;
  expiresAt: number;
}

type VideoOperationClaims = Readonly<
  VideoOperationClaimsBase & GenerationOperationAuthClaims
>;

interface VideoGenerationResultBase {
  requestId: string;
  model: Readonly<VideoModelDefinition>;
  outputs: readonly GeneratedVideo[];
  operation?: VideoOperationRef;
  responseId?: string;
  usage?: VideoUsage;
  cost?: VideoCost;
  diagnostics?: readonly AiDiagnostic[];
  startedAt: number;
  completedAt: number;
}

type VideoGenerationResult =
  | (VideoGenerationResultBase & {
      status: 'completed';
      partial: false;
      error?: never;
    })
  | (VideoGenerationResultBase & {
      status: 'failed';
      partial: boolean;
      error: AiError;
    })
  | (VideoGenerationResultBase & {
      status: 'cancelled';
      partial: boolean;
      error: AiError & { category: 'cancelled' };
    })
  | (VideoGenerationResultBase & {
      status: 'detached';
      partial: boolean;
      operation: VideoOperationRef;
      error?: never;
    });

type VideoGenerationEvent =
  | Readonly<{
      type: 'generation_start';
      sequence: number;
      model: Readonly<VideoModelDefinition>;
      operation?: VideoOperationRef;
    }>
  | Readonly<
      { type: 'generation_progress'; sequence: number } & GenerationProgress & {
          operation?: VideoOperationRef;
        }
    >
  | Readonly<{
      type: 'generation_preview_image';
      sequence: number;
      image: GeneratedImage;
    }>
  | Readonly<{
      type: 'generation_preview_video';
      sequence: number;
      video: GeneratedVideo;
    }>
  | Readonly<{
      type: 'generation_output';
      sequence: number;
      outputIndex: number;
      video: GeneratedVideo;
    }>
  | Readonly<{
      type: 'generation_end';
      sequence: number;
      result: Extract<VideoGenerationResult, { status: 'completed' }>;
    }>
  | Readonly<{
      type: 'generation_error';
      sequence: number;
      result: Extract<
        VideoGenerationResult,
        { status: 'failed' | 'cancelled' }
      >;
    }>
  | Readonly<{
      type: 'generation_detached';
      sequence: number;
      result: Extract<VideoGenerationResult, { status: 'detached' }>;
    }>;

interface VideoGenerationStream extends AsyncIterable<VideoGenerationEvent> {
  result(): Promise<VideoGenerationResult>;
  abort(reason?: string): void;
  detach(): Promise<VideoOperationRef>;
}
```

`content` 保留调用方顺序，但 Runtime 还要按 role 验证组合：`edit/extend` 必须恰好有一个 `source` video；不支持的 first/last frame、音频或多参考输入在网络前失败。模型专用镜头控制、storyboard 或角色引用通过 typed `VideoProtocolOptionsMap` 表达，不能进入任意 `metadata`。URL/base64 输入统一经过 `ResourceLoader`、NetworkPolicy、媒体类型、长度和总请求预算；大文件上传或 Provider Files API 由具体 protocol adapter 通过受限 resource/upload 端口完成，不能读取业务素材库。

### 视频 Provider、Protocol 与任务

视频使用与图片同构但不同类型的 binding：

```ts
export interface VideoProtocolOptionsMap {}
export interface VideoProtocolCompatibilityMap {}

interface CommonVideoRequestDefaults {
  timeoutMs?: number;
  retry?: false | RetryPolicy;
  responseFormat?: 'url' | 'base64';
  pollIntervalMs?: number;
}

type RuntimeVideoProtocolDefaults = Readonly<{
  [TProtocol in keyof VideoProtocolOptionsMap]?: Partial<
    VideoProtocolOptionsMap[TProtocol]
  >;
}>;

type VideoProtocolCompatibility<TProtocol extends string> =
  TProtocol extends keyof VideoProtocolCompatibilityMap
    ? VideoProtocolCompatibilityMap[TProtocol]
    : Readonly<Record<string, JsonValue>>;

interface VideoModelProtocolProfile<TProtocol extends string = string> {
  id: string;
  compatibility: Readonly<VideoProtocolCompatibility<TProtocol>>;
  protocolDefaults?: Readonly<VideoProtocolOptions<TProtocol>>;
}

interface DiscoveredVideoModel {
  id: string;
  name?: string;
  protocol: string;
  publisher?: string;
  family?: string;
  capabilities?: Partial<VideoModelCapabilities>;
  limits?: Partial<VideoModelLimits>;
  inputDefaults?: Partial<VideoModelDefinition['inputDefaults']>;
  pricing?: VideoModelPricing;
  providerMetadata?: Readonly<Record<string, JsonValue>>;
}

interface VideoModelDiscoveryContext {
  provider: Readonly<ProviderSnapshot>;
  authIdentity: Readonly<CatalogAuthView>;
  transport: RequestTransport;
  previousProviderState?: JsonValue;
  signal: AbortSignal;
}

interface VideoModelFilterContext {
  provider: Readonly<ProviderSnapshot>;
  authIdentity: Readonly<CatalogAuthView>;
  signal: AbortSignal;
}

interface VideoModelDiscoveryResult {
  models: readonly DiscoveredVideoModel[];
  providerState?: JsonValue;
  sourceRevision?: string;
  cacheMaxAgeMs: number;
}

interface VideoModelSource {
  staticModels(): readonly VideoModelDefinition[];
  resolveDiscoveryEndpoint?(
    context: ModelDiscoveryTargetContext,
  ): Promise<URL> | URL;
  resolveDiscoveryHeaders?(
    context: ModelDiscoveryTargetContext & { endpoint: URL },
  ):
    | Promise<Readonly<Record<string, string>>>
    | Readonly<Record<string, string>>;
  discover?(
    context: VideoModelDiscoveryContext,
  ): Promise<VideoModelDiscoveryResult>;
}

interface VideoProviderBinding {
  catalogCompatibilityVersion: string;
  modelSource: VideoModelSource;
  protocols: readonly VideoProtocolBinding[];
  filterModels?(
    models: readonly VideoModelDefinition[],
    context: VideoModelFilterContext,
  ): readonly VideoModelDefinition[];
}

interface VideoEndpointContext<TProtocol extends string = string> {
  provider: Readonly<ProviderSnapshot>;
  model: Readonly<VideoModelDefinition<TProtocol>>;
  endpointHints?: Readonly<EndpointHints>;
  providerState?: JsonValue;
  input: Readonly<ResolvedVideoGenerationInput>;
  options: Readonly<ResolvedVideoGenerationOptions<TProtocol>>;
  signal: AbortSignal;
}

interface VideoHeaderContext<
  TProtocol extends string = string,
> extends VideoEndpointContext<TProtocol> {
  endpoint: URL;
}

interface VideoOperationEndpointContext<TProtocol extends string = string> {
  action: 'poll' | 'cancel';
  operation: Readonly<VideoOperationClaims & { protocol: TProtocol }>;
  provider: Readonly<ProviderSnapshot>;
  model: Readonly<VideoModelDefinition<TProtocol>>;
  endpointHints?: Readonly<EndpointHints>;
  providerState?: JsonValue;
  options: Readonly<ResolvedVideoOperationResumeOptions>;
  signal: AbortSignal;
}

interface VideoOperationHeaderContext<
  TProtocol extends string = string,
> extends VideoOperationEndpointContext<TProtocol> {
  endpoint: URL;
}

interface VideoProtocolBindingBase<TProtocol extends string = string> {
  protocol: TProtocol;
  resolveEndpoint(context: VideoEndpointContext<TProtocol>): Promise<URL> | URL;
  resolveHeaders?(
    context: VideoHeaderContext<TProtocol>,
  ):
    | Promise<Readonly<Record<string, string>>>
    | Readonly<Record<string, string>>;
  requestDefaults?: Readonly<CommonVideoRequestDefaults>;
  defaultProfile: Readonly<VideoModelProtocolProfile<TProtocol>>;
  profiles?: Readonly<Record<string, VideoModelProtocolProfile<TProtocol>>>;
  retrySafety: RetrySafety;
}

interface DirectVideoProtocolBinding<
  TProtocol extends string = string,
> extends VideoProtocolBindingBase<TProtocol> {
  operationMode: 'direct';
  loadAdapter(): Promise<DirectVideoProtocolAdapter<TProtocol>>;
}

interface ResumableVideoProtocolBinding<
  TProtocol extends string = string,
> extends VideoProtocolBindingBase<TProtocol> {
  operationMode: 'resumable';
  operationCompatibilityVersion: string;
  operationActions: readonly ('poll' | 'cancel')[];
  resolveOperationEndpoint(
    context: VideoOperationEndpointContext<TProtocol>,
  ): Promise<URL> | URL;
  resolveOperationHeaders?(
    context: VideoOperationHeaderContext<TProtocol>,
  ):
    | Promise<Readonly<Record<string, string>>>
    | Readonly<Record<string, string>>;
  loadAdapter(): Promise<ResumableVideoProtocolAdapter<TProtocol>>;
}

type VideoProtocolBinding<TProtocol extends string = string> =
  | DirectVideoProtocolBinding<TProtocol>
  | ResumableVideoProtocolBinding<TProtocol>;

interface VideoProtocolContract<TProtocol extends string = string> {
  requestDefaults?: Readonly<CommonVideoRequestDefaults>;
  parseOptions(input: unknown): VideoProtocolOptions<TProtocol>;
  mergeOptions(
    layers: readonly (VideoProtocolOptions<TProtocol> | undefined)[],
  ): VideoProtocolOptions<TProtocol>;
  parseCompatibility(input: unknown): VideoProtocolCompatibility<TProtocol>;
}

interface DirectVideoProtocolAdapter<TProtocol extends string = string> {
  id: TProtocol;
  operationMode: 'direct';
  contract: VideoProtocolContract<TProtocol>;
  run(
    request: VideoProtocolRequest<TProtocol>,
    sink: VideoProtocolEventSink,
  ): Promise<VideoProtocolTerminal>;
}

interface ResumableVideoProtocolAdapter<TProtocol extends string = string> {
  id: TProtocol;
  operationMode: 'resumable';
  contract: VideoProtocolContract<TProtocol>;
  parseOperationState(input: unknown): JsonValue | undefined;
  run(
    request: VideoProtocolRequest<TProtocol>,
    sink: ResumableVideoProtocolEventSink,
  ): Promise<VideoProtocolTerminal>;
  resume(
    request: VideoResumeRequest<TProtocol>,
    sink: VideoProtocolEventSink,
  ): Promise<VideoProtocolTerminal>;
  cancel?(request: VideoCancelRequest<TProtocol>): Promise<void>;
}

interface VideoProtocolEventSink {
  publish(event: VideoProtocolProgressEvent): Promise<void>;
}

interface ResumableVideoProtocolEventSink extends VideoProtocolEventSink {
  setOperation(input: {
    operationId: string;
    operationState?: JsonValue;
    providerExpiresAt?: number;
  }): Promise<void>;
  operationTransport(action: 'poll' | 'cancel'): Promise<RequestTransport>;
}

type VideoProtocolProgressEvent =
  | ({ type: 'generation_progress' } & GenerationProgress)
  | Readonly<{ type: 'generation_preview_image'; image: GeneratedImage }>
  | Readonly<{ type: 'generation_preview_video'; video: GeneratedVideo }>
  | Readonly<{
      type: 'generation_output';
      outputIndex: number;
      video: GeneratedVideo;
    }>;

interface VideoProtocolTerminalBase {
  usage?: VideoUsage;
  responseId?: string;
  diagnostics?: readonly AiDiagnostic[];
}

type VideoProtocolTerminal =
  | (VideoProtocolTerminalBase & { status: 'completed' })
  | (VideoProtocolTerminalBase & { status: 'failed'; error: AiError })
  | (VideoProtocolTerminalBase & {
      status: 'cancelled';
      error: AiError & { category: 'cancelled' };
    });

interface VideoProtocolRequest<TProtocol extends string = string> {
  provider: Readonly<ProviderSnapshot>;
  model: Readonly<VideoModelDefinition<TProtocol>>;
  input: Readonly<ResolvedVideoGenerationInput>;
  compatibility: Readonly<VideoProtocolCompatibility<TProtocol>>;
  options: Readonly<ResolvedVideoGenerationOptions<TProtocol>>;
  transport: RequestTransport;
  resources: ResourceLoader;
  signal: AbortSignal;
}

interface VideoResumeRequest<TProtocol extends string = string> {
  operation: Readonly<VideoOperationClaims & { protocol: TProtocol }>;
  provider: Readonly<ProviderSnapshot>;
  model: Readonly<VideoModelDefinition<TProtocol>>;
  compatibility: Readonly<VideoProtocolCompatibility<TProtocol>>;
  options: Readonly<ResolvedVideoOperationResumeOptions>;
  pollTransport: RequestTransport;
  cancelTransport?: RequestTransport;
  resources: ResourceLoader;
  signal: AbortSignal;
}

interface VideoCancelRequest<TProtocol extends string = string> {
  operation: Readonly<VideoOperationClaims & { protocol: TProtocol }>;
  provider: Readonly<ProviderSnapshot>;
  model: Readonly<VideoModelDefinition<TProtocol>>;
  compatibility: Readonly<VideoProtocolCompatibility<TProtocol>>;
  transport: RequestTransport;
  signal: AbortSignal;
}
```

省略的 direct binding、adapter request/sink/terminal、endpoint/header context 和 model-source interface 与图片对应 interface 具有相同所有权和安全不变量，但使用视频领域类型，不能用 TypeScript cast 复用图片 adapter。两者的公共 operation ref 也分别 branded；包内 `generation` 状态机通过注入的 domain codec 和 event projector 复用。

视频 operation claims 必须额外绑定 `operation: generate|edit|extend`、输入摘要、输出规格与协议状态，但不得嵌入原始 prompt、媒体 bytes、签名 URL、文件 token、endpoint、header 或云 GPU 实例信息。`generate/stream/resume/serializeOperation/parseOperation/detach/abort` 的安全顺序、唯一终态、跨 scope/auth/config/profile 拒绝和取消竞态与图片相同。

```ts
interface VideoModelListFilter {
  providerInstanceId?: ProviderInstanceId;
  protocol?: string;
  operation?: VideoOperationKind;
  input?: 'text' | 'image' | 'video' | 'audio';
  supports?: 'streamingPreviews' | 'asyncOperation' | 'audioOutput' | 'seed';
}

interface VideoModelRefreshReport {
  providerInstanceId: ProviderInstanceId;
  source: 'static' | 'fresh' | 'cached' | 'stale' | 'failed';
  models: readonly VideoModelHandle[];
  errors: readonly AiError[];
}

interface VideoModelListResult {
  models: readonly VideoModelHandle[];
  reports: readonly VideoModelRefreshReport[];
}

interface VideoInventoryModelEntry<TProtocol extends string = string> {
  definition: Readonly<VideoModelDefinition<TProtocol>>;
  source: 'static' | 'explicit';
  availability: 'unknown';
}

interface VideoModelInventoryApi {
  find<TProtocol extends string>(
    ref: VideoModelRef<TProtocol>,
  ): Promise<VideoInventoryModelEntry<TProtocol> | undefined>;
  list(
    filter?: VideoModelListFilter,
  ): Promise<readonly VideoInventoryModelEntry[]>;
}

interface VideoModelsApi<TScopeHandle> {
  find<TProtocol extends string>(
    ref: VideoModelRef<TProtocol>,
    scope: TScopeHandle,
    options?: ModelReadOptions,
  ): Promise<VideoModelHandle<TProtocol> | undefined>;
  require<TProtocol extends string>(
    ref: VideoModelRef<TProtocol>,
    scope: TScopeHandle,
    options?: ModelReadOptions,
  ): Promise<VideoModelHandle<TProtocol>>;
  list(
    scope: TScopeHandle,
    filter?: VideoModelListFilter,
    options?: ModelReadOptions,
  ): Promise<VideoModelListResult>;
  refresh(
    providerInstanceId: ProviderInstanceId,
    scope: TScopeHandle,
    options?: ModelRefreshOptions,
  ): Promise<VideoModelRefreshReport>;
}

interface VideosApi<TScopeHandle> {
  readonly inventory: VideoModelInventoryApi;
  readonly models: VideoModelsApi<TScopeHandle>;
  stream<TProtocol extends string>(
    model: VideoModelHandle<TProtocol>,
    input: VideoGenerationInput,
    options: VideoGenerationOptions<TProtocol> & { scope: TScopeHandle },
  ): VideoGenerationStream;
  generate<TProtocol extends string>(
    model: VideoModelHandle<TProtocol>,
    input: VideoGenerationInput,
    options: VideoGenerationOptions<TProtocol> & { scope: TScopeHandle },
  ): Promise<VideoGenerationResult>;
  resume(
    operation: VideoOperationRef,
    options: VideoOperationResumeOptions<TScopeHandle>,
  ): Promise<VideoGenerationStream>;
  serializeOperation(
    operation: VideoOperationRef,
  ): Promise<SerializedVideoOperationRef>;
  parseOperation(serialized: string): Promise<VideoOperationRef>;
}
```

上述 interface 都必须具有与图片同等级的限长规则和 contract tests；不允许用 `any`、未验证的 `unknown` 或图片类型别名跳过领域差异。视频目录使用 `CatalogCacheKey.capability = 'videos'`，与 chat/images 分离 cache namespace，但共享同一 Provider auth、scope authority 与 auth identity。

### 首批视频 Provider 矩阵

| Provider                 | 视频模型/来源               | 首批必须覆盖的行为                                                                                                                                                                                 |
| ------------------------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `xai`                    | Grok Imagine Video          | 异步 generate、image/reference-to-video、edit、extend、poll、expired/failed、临时 URL、按秒 usage/cost；以 [xAI Videos API](https://docs.x.ai/developers/rest-api-reference/inference/videos) 为准 |
| `doubao`                 | Seedance 2.0                | 文本/图片/音频/视频输入、任务创建/查询、能力拒绝、产物 URL 与错误；以[火山引擎官方发布与其链接的 API 文档](https://developer.volcengine.com/articles/7628567056649125942)为准                      |
| `kling`                  | Kling/可灵视频模型          | 文生视频、图生视频、任务创建/查询、模型 profile、临时产物与错误；以 [KlingAI Open Platform](https://kling.ai/document-api/apiReference%2Fmodel%2FimageModels) 的实现时 pinned contract 为准        |
| `self-hosted-generation` | 自有网关发布的图片/视频模型 | 动态目录、排队/准备/运行/收尾、detach/resume/cancel、模型下线、临时产物、可选 compute usage                                                                                                        |

模型版本、route、字段和限制不得根据产品名称猜测。每个首批 Provider slice 先把当时官方 schema、文档定位符、验证日期和脱敏 fixture 固定进 `contractManifest`，再写 adapter；官方资料没有 cancel 就只实现本地 abort/detach，不伪造远端取消。

<a id="generation-channels"></a>

## 托管平台、自建网关和云 GPU

### Provider 是访问渠道，publisher 是模型来源

官方直连、第三方综合平台和自建网关都实现 Provider interface。综合平台不是“特殊路由器”，平台中的每个模型也不是一个 Provider。以同一 Kling 模型为例，`kling-direct/kling-v3`、`aggregator-a/kling-v3` 和 `self-hosted/kling-compatible` 是三个不同 model handle；它们可以共享 `publisher='kling'`、`family='kling-video'`，但必须保留不同 `providerInstanceId/upstreamModelId/protocolProfileId/pricing`。

第三方综合平台必须满足：

- 可以在一个 Provider 中同时提供 chat/images/videos，并在每个 capability 内绑定一个或多个 protocol。
- 动态目录只能返回模型事实；远端字段不能决定 auth scheme、origin、endpoint、protocol、operation mode 或受信 compatibility。
- 综合平台统一 task interface 使用平台自己的 protocol adapter；透明转发官方 wire 时可以复用已有 adapter，但必须由受信 binding 固定 route/profile。
- 平台价格、限流、地区、内容策略和任务有效期属于该渠道，不从 publisher 的直连目录继承。
- Provider 内部 fallback 必须由固定且可见的 protocol profile 声明；第一版不允许跨 Provider 隐式 fallback。
- 同一 publisher/family 的多个渠道只用于 inventory 展示和上层显式选择，不能共享 credential、catalog cache、session 或 operation token。

### 云 GPU 只在自有 Generation Gateway 后出现

```text
Agent / 业务模块
  → @duoduo/ai images | videos
  → self-hosted-generation Provider
  → owned Generation Gateway
  → queue / scheduler / worker / artifact store
  → RunPod、AutoDL、Vast.ai、AWS、GCP、Azure 或其他租赁 GPU
```

`@duoduo/ai` 与自有网关之间是“远程但自有”的 seam：生产使用受保护 HTTP/queue adapter，测试使用内存 adapter。网关内部的云厂商 adapter、容量租赁、节点心跳、镜像部署、模型缓存、抢占恢复、显存配额、自动扩缩容和空闲回收都不属于本 package 的公共 interface。未来即使这些实现仍物理放在同一 package，也只能从独立 Node-only subpath 延迟加载，根入口和通用 Provider contract 不得静态依赖任何云 SDK。

第一版为这个 seam 交付 `self-hosted-generation` Provider contract、协议 fixture 和 fake gateway，不交付真实 GPU 调度器。验收必须证明：把 fake gateway 换成另一个实现时，Agent、图片/视频输入、operation token 和终态代码不改；新增云 GPU 厂商时只改变网关内部 adapter。

## Telemetry 与成本

```ts
interface AuthAuditEvent {
  action:
    | 'login'
    | 'replace'
    | 'lease_acquire'
    | 'refresh'
    | 'backoff'
    | 'reauth_required'
    | 'logout'
    | 'revoke';
  outcome: string;
  providerInstanceId: ProviderInstanceId;
  scopeFingerprint: string;
  credentialInstanceId?: string;
  timestamp: number;
  errorCode?: string;
  casOutcome?: 'committed' | 'conflict' | 'not_attempted';
}

interface AuthAuditSink {
  record(event: AuthAuditEvent): Promise<void> | void;
}

interface AiTelemetryEventBase {
  timestamp: number;
  providerInstanceId?: ProviderInstanceId;
  protocol?: string;
  modelId?: string;
  requestId?: string;
  scopeFingerprint?: string;
}

interface AiTelemetryUsageSnapshot {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheWriteStandardTokens?: number;
  cacheWriteOneHourTokens?: number;
  totalTokens?: number;
  serviceTier?: string;
  generatedImages?: number;
  outputMegapixels?: number;
}

interface AiTelemetryCostSnapshot {
  currency: string;
  total?: number;
  source: 'computed' | 'provider' | 'mixed';
}

type AiTelemetryCatalogSource =
  'static' | 'fresh' | 'cached' | 'stale' | 'failed';

type AiTelemetryEvent =
  | (AiTelemetryEventBase & {
      type: 'request_started';
      capability: AiCapabilityId;
    })
  | (AiTelemetryEventBase & {
      type: 'attempt_finished';
      attempt: number;
      outcome: 'success' | 'retry' | 'failed' | 'cancelled';
      durationMs: number;
      errorCode?: string;
    })
  | (AiTelemetryEventBase & {
      type: 'request_finished';
      status: ResponseStatus | 'detached';
      durationMs: number;
      usage?: AiTelemetryUsageSnapshot;
      cost?: AiTelemetryCostSnapshot;
    })
  | (AiTelemetryEventBase & {
      type: 'catalog_refresh';
      capability: AiCapabilityId;
      source: AiTelemetryCatalogSource;
      modelCount: number;
      durationMs: number;
      errorCode?: string;
    })
  | (AiTelemetryEventBase & {
      type: 'session_cleanup' | 'operation_resume';
      outcome: string;
      durationMs: number;
      errorCode?: string;
    });

interface AiTelemetrySink {
  record(event: Readonly<AiTelemetryEvent>): Promise<void> | void;
}
```

- 统一 Usage 记录 input、output、reasoning、cache read/write 和 total tokens。
- 成本由请求开始时的模型价格快照计算，支持输入阈值价格阶梯、service tier 倍率和 Provider 实际返回成本。
- Provider 没有提供某项 usage 时保留 `undefined`，不伪造精确值。
- `AiTelemetrySink` 只接收上述 closed allowlist；Runtime 把文本/图片/视频领域的 Usage/Cost 投影为 telemetry 自己的纯标量 snapshot，因此 `telemetry` 仍只依赖 `core`，不导入领域模块或 `runtime`。诊断 hook 可观察已脱敏 payload shape、响应状态与 retry，不得默认记录完整 prompt、tool result、媒体 bytes、operation token、临时产物 URL、云实例 ID 或 URL query。
- 可选 `AuthAuditSink` 接收 login、refresh、lease takeover、backoff、reauth-required、logout 和 revoke 的 outcome；字段仅含 action、providerInstanceId、keyed scope fingerprint、credentialInstanceId、store timestamp、error code 和 CAS outcome，不含 token、raw scope、query 或账号 label。
- Audit sink 失败不得回滚 credential CAS 或阻塞 logout；Runtime 以限长 internal diagnostic 报告并继续。
- Telemetry sink 与 transport observer 失败不得改变请求、重试或终态；Runtime 只记限长 internal diagnostic，并对连续失败做有界熔断，防止观测系统反压模型流。
- OpenTelemetry 通过 `@duoduo/ai/telemetry` 的可选 `createOpenTelemetrySink()` adapter 接入，由宿主显式传入 tracer/meter；核心不查找全局 provider、不自动初始化 exporter，也不把 hashed scope 当可逆用户 ID。

## CLI

`duoduo-ai` CLI 位于 Node-only 入口，至少提供：

```text
duoduo-ai providers
duoduo-ai models [provider] [--available]
duoduo-ai models refresh [provider]
duoduo-ai auth status [provider]
duoduo-ai auth login <provider> --method <api_key|oauth|ambient_config>
duoduo-ai auth logout <provider> [--revoke-remote]
duoduo-ai diagnose <provider> <model>
```

CLI 既提供可注入 library runner，也提供可独立跨进程使用的 Node binary，二者走同一 assembly，不创建第二套 `auth.json`：

```ts
interface NodeCliPaths {
  stateDirectory: string;
  configFile: string;
  credentialDirectory: string;
  catalogDirectory: string;
}

interface CredentialMasterKeySource {
  readonly identityLifetime: 'cross-runtime';
  active(
    signal?: AbortSignal,
  ): Promise<
    | { status: 'available'; keyId: string; key: SecretValue }
    | { status: 'unavailable'; retryable: boolean }
  >;
  byId(
    keyId: string,
    signal?: AbortSignal,
  ): Promise<
    | { status: 'available'; key: SecretValue }
    | { status: 'unavailable'; retryable: boolean }
  >;
}

interface NodeCliDependencies {
  runtime: AiRuntime<LocalScopeHandle>;
  interaction: AuthInteraction;
  stdout: { write(text: string): void };
  stderr: { write(text: string): void };
}

interface CreateNodeCliOptions {
  paths?: Partial<NodeCliPaths>;
  masterKeySource?: CredentialMasterKeySource;
  environment?: EnvironmentSource;
  clock?: Clock;
}

declare function resolveNodeCliPaths(
  environment?: EnvironmentSource,
): NodeCliPaths;
declare function createAeadCredentialCodec(options: {
  keySource: CredentialMasterKeySource;
  algorithm?: 'AES-256-GCM';
}): CredentialCodec;
declare function createFileCredentialStore(options: {
  directory: string;
  codec: CredentialCodec;
  storeNamespace: string;
}): CredentialStore;
declare function createFileCatalogStore(options: {
  directory: string;
  clock?: Clock;
}): CatalogStore;
declare function createNodeCliDependencies(
  options?: CreateNodeCliOptions,
): Promise<NodeCliDependencies>;
declare function runCli(
  argv: readonly string[],
  dependencies: NodeCliDependencies,
): Promise<number>;
```

默认 state directory：macOS 为 `~/Library/Application Support/duoduo-ai`，Linux 为 `${XDG_STATE_HOME:-~/.local/state}/duoduo-ai`，Windows 为 `%LOCALAPPDATA%\duoduo-ai`；`DUODUO_AI_HOME` 可显式覆盖。`config.json` 只保存 Provider 非秘密配置、默认 region/account 与 allowlist；credential record 必须使用正文的 sealer/codec，catalog 使用独立公开元数据 store。目录 0700、文件 0600（Windows 使用等价当前用户 ACL），拒绝 symlink、错误 owner 和越界相对路径。

默认 master-key 顺序为：系统 credential vault 中名为 `duoduo-ai/master-key` 的随机 256-bit key → headless 环境显式 `DUODUO_AI_MASTER_KEY`（base64url 32 bytes）→ 交互式 passphrase 经 Argon2id + 每机 salt 派生。环境 key 永不写盘；passphrase 永不缓存到文件；平台 vault 不可用且命令非交互/无 env key 时，凭据相关命令以 `CREDENTIAL_CODEC_KEY_UNAVAILABLE` 失败，绝不创建 plaintext store 或把 key 与 ciphertext 同目录保存。keyring 轮换保留未迁移 record 的旧 key ID，成功打开后在同一 store 锁/CAS 内 reseal 到 active key。

独立 binary 的 assembly 固定为：解析路径/非秘密 config → 建立 key source 与 file stores → `builtinProviders(config)` → 显式注册 `result.providers` 并保留 `result.unconfigured` 供 CLI 展示 → 从已注册 Provider auth descriptors/contract manifests 构造默认拒绝的 NetworkPolicy allowlist → 建立 `LocalScopeAuthority` 和 local ambient/override policy → 调用 `runCli()` → finally dispose。全部 40 个 kind 始终可列出，但缺 Qwen region、self-hosted gateway base URL 等必需非秘密配置的 kind 标为 `unconfigured`，不得注册猜测实例。`subjectId='local-cli'`，`--account` 选择 credential slot。`models` 默认走无认证 inventory 并标记 availability unknown，`--available` 才走 scope-aware models API；`models refresh` 要求可解析 credential。诊断默认只检查注册、认证、目录和网络配置；付费请求必须同时传 `--allow-paid` 与显式预算。嵌入服务只调用 `runCli()` 并提供自己的 scope/dependencies，不能复用 local subject 映射。

<a id="public-exports"></a>

## 公共导出

```text
@duoduo/ai
@duoduo/ai/auth
@duoduo/ai/auth/node
@duoduo/ai/catalog
@duoduo/ai/context
@duoduo/ai/generation
@duoduo/ai/images
@duoduo/ai/videos
@duoduo/ai/session
@duoduo/ai/stream
@duoduo/ai/transport
@duoduo/ai/transport/node
@duoduo/ai/providers
@duoduo/ai/providers/*
@duoduo/ai/providers/all
@duoduo/ai/protocols
@duoduo/ai/protocols/*
@duoduo/ai/telemetry
@duoduo/ai/testing
@duoduo/ai/cli
```

根入口只导出 core types、stream contract、runtime 工厂、`secret(value)` 安全构造器和纯函数；任何 reveal API 都不公开。`generation` 导出通用阶段/产物/compute usage、`GenerationOperationCodec`/`OperationCredentialDigestDriver` 端口与 package-owned `createOperationCredentialVerifier()`；`images` 与 `videos` 只导出各自领域类型和 branded refs，不能直接 materialize `SecretValue`。裸 `providers`/`protocols` subpath 导出各自的基础端口、declaration-merging map 与通用工厂，wildcard 才是具体实现；`transport` 导出 Web-platform driver/NetworkPolicy 端口，`transport/node` 才导出 proxy、Node WebSocket/SDK driver。Provider catalog、SDK、OAuth flow、Node filesystem、代理和 CLI 不得从根入口被静态拉入。

根入口的 value exports 精确为：`createAi`、`secret`、`toAssistantMessage`、`parseToolArguments`、`validateToolArguments`、`validateToolCall`、`isContextOverflowError`、`calculateCost`、`calculateImageCost`、`calculateVideoCost`、`estimateContextTokens`、`parseRetryAfter` 与 `computeRetryDelay`；其余为 core/Runtime 类型。所有 helper 都是确定性纯函数，接收显式 model snapshot/options，不读 Provider registry、环境或时钟；retry jitter 接收显式随机样本。通用可写 EventStream、secret reveal、raw JSON repair、Provider error detector 不从根导出，分别由 Runtime、auth wrapper 和 protocol contract 拥有。

每个 Provider subpath 必须导出同名 `...ProviderOptions`，即使第一版只有 `id/baseUrl` 两项；下表冻结 factory 与 typed ref helper 的准确名称：

| `providers/*`            | Factory                        | Ref helper（按 capability 分别导出）                             |
| ------------------------ | ------------------------------ | ---------------------------------------------------------------- |
| `amazon-bedrock`         | `amazonBedrockProvider`        | `amazonBedrockModelRef`                                          |
| `ant-ling`               | `antLingProvider`              | `antLingModelRef`                                                |
| `anthropic`              | `anthropicProvider`            | `anthropicModelRef`                                              |
| `azure-openai-responses` | `azureOpenAiResponsesProvider` | `azureOpenAiResponsesModelRef`                                   |
| `cerebras`               | `cerebrasProvider`             | `cerebrasModelRef`                                               |
| `cloudflare-ai-gateway`  | `cloudflareAiGatewayProvider`  | `cloudflareAiGatewayModelRef`                                    |
| `cloudflare-workers-ai`  | `cloudflareWorkersAiProvider`  | `cloudflareWorkersAiModelRef`                                    |
| `deepseek`               | `deepseekProvider`             | `deepseekModelRef`                                               |
| `fireworks`              | `fireworksProvider`            | `fireworksModelRef`                                              |
| `github-copilot`         | `githubCopilotProvider`        | `githubCopilotModelRef`                                          |
| `google`                 | `googleProvider`               | `googleModelRef`                                                 |
| `google-vertex`          | `googleVertexProvider`         | `googleVertexModelRef`                                           |
| `groq`                   | `groqProvider`                 | `groqModelRef`                                                   |
| `huggingface`            | `huggingfaceProvider`          | `huggingfaceModelRef`                                            |
| `kimi-coding`            | `kimiCodingProvider`           | `kimiCodingModelRef`                                             |
| `minimax`                | `minimaxProvider`              | `minimaxModelRef`                                                |
| `minimax-cn`             | `minimaxCnProvider`            | `minimaxCnModelRef`                                              |
| `mistral`                | `mistralProvider`              | `mistralModelRef`                                                |
| `moonshotai`             | `moonshotAiProvider`           | `moonshotAiModelRef`                                             |
| `moonshotai-cn`          | `moonshotAiCnProvider`         | `moonshotAiCnModelRef`                                           |
| `nvidia`                 | `nvidiaProvider`               | `nvidiaModelRef`                                                 |
| `openai`                 | `openAiProvider`               | `openAiModelRef`                                                 |
| `openai-codex`           | `openAiCodexProvider`          | `openAiCodexModelRef`                                            |
| `opencode`               | `openCodeProvider`             | `openCodeModelRef`                                               |
| `opencode-go`            | `openCodeGoProvider`           | `openCodeGoModelRef`                                             |
| `openrouter`             | `openRouterProvider`           | `openRouterModelRef` / `openRouterImageModelRef`                 |
| `radius`                 | `radiusProvider`               | `radiusModelRef`                                                 |
| `together`               | `togetherProvider`             | `togetherModelRef`                                               |
| `vercel-ai-gateway`      | `vercelAiGatewayProvider`      | `vercelAiGatewayModelRef`                                        |
| `xai`                    | `xAiProvider`                  | `xAiModelRef` / `xAiImageModelRef` / `xAiVideoModelRef`          |
| `xiaomi`                 | `xiaomiProvider`               | `xiaomiModelRef`                                                 |
| `xiaomi-token-plan-ams`  | `xiaomiTokenPlanAmsProvider`   | `xiaomiTokenPlanAmsModelRef`                                     |
| `xiaomi-token-plan-cn`   | `xiaomiTokenPlanCnProvider`    | `xiaomiTokenPlanCnModelRef`                                      |
| `xiaomi-token-plan-sgp`  | `xiaomiTokenPlanSgpProvider`   | `xiaomiTokenPlanSgpModelRef`                                     |
| `zai`                    | `zaiProvider`                  | `zaiModelRef`                                                    |
| `zai-coding-cn`          | `zaiCodingCnProvider`          | `zaiCodingCnModelRef`                                            |
| `qwen`                   | `qwenProvider`                 | `qwenModelRef` / `qwenImageModelRef`                             |
| `doubao`                 | `doubaoProvider`               | `doubaoModelRef` / `doubaoImageModelRef` / `doubaoVideoModelRef` |
| `kling`                  | `klingProvider`                | `klingImageModelRef` / `klingVideoModelRef`                      |
| `self-hosted-generation` | `selfHostedGenerationProvider` | `selfHostedImageModelRef` / `selfHostedVideoModelRef`            |

options type 与 factory 的精确映射（也是各 subpath 的命名导出）为：

```text
amazonBedrockProvider: AmazonBedrockProviderOptions
antLingProvider: AntLingProviderOptions
anthropicProvider: AnthropicProviderOptions
azureOpenAiResponsesProvider: AzureOpenAiProviderOptions
cerebrasProvider: CerebrasProviderOptions
cloudflareAiGatewayProvider: CloudflareAiGatewayProviderOptions
cloudflareWorkersAiProvider: CloudflareWorkersAiProviderOptions
deepseekProvider: DeepseekProviderOptions
fireworksProvider: FireworksProviderOptions
githubCopilotProvider: GitHubCopilotProviderOptions
googleProvider: GoogleProviderOptions
googleVertexProvider: GoogleVertexProviderOptions
groqProvider: GroqProviderOptions
huggingfaceProvider: HuggingfaceProviderOptions
kimiCodingProvider: KimiCodingProviderOptions
minimaxProvider: MinimaxProviderOptions
minimaxCnProvider: MinimaxCnProviderOptions
mistralProvider: MistralProviderOptions
moonshotAiProvider: MoonshotAiProviderOptions
moonshotAiCnProvider: MoonshotAiCnProviderOptions
nvidiaProvider: NvidiaProviderOptions
openAiProvider: OpenAiProviderOptions
openAiCodexProvider: OpenAiCodexProviderOptions
openCodeProvider: OpenCodeProviderOptions
openCodeGoProvider: OpenCodeGoProviderOptions
openRouterProvider: OpenRouterProviderOptions
radiusProvider: RadiusProviderOptions
togetherProvider: TogetherProviderOptions
vercelAiGatewayProvider: VercelAiGatewayProviderOptions
xAiProvider: XAiProviderOptions
xiaomiProvider: XiaomiProviderOptions
xiaomiTokenPlanAmsProvider: XiaomiTokenPlanAmsProviderOptions
xiaomiTokenPlanCnProvider: XiaomiTokenPlanCnProviderOptions
xiaomiTokenPlanSgpProvider: XiaomiTokenPlanSgpProviderOptions
zaiProvider: ZaiProviderOptions
zaiCodingCnProvider: ZaiCodingCnProviderOptions
qwenProvider: QwenProviderOptions
doubaoProvider: DoubaoProviderOptions
klingProvider: KlingProviderOptions
selfHostedGenerationProvider: SelfHostedGenerationProviderOptions
```

所有 ref helper 签名为 `(modelId: string, providerInstanceId?: string) => ModelRef<...>` 或对应图片/视频 ref，默认 instance ID 为 kind；它们不查目录、不返回 handle。`providers/all` 只导出 `builtinProviders(options?)`、`builtinProviderKinds`、`getBuiltinInventory(providerKind)`，每次调用返回新对象，不保留全局 registry。综合平台不是 builtin 通用工厂；每个平台必须有自己的受信 factory/manifest。聚合结果冻结为：

```ts
interface ProviderFactoryOptionsMap {}

type BuiltinProviderKind = keyof ProviderFactoryOptionsMap;

type BuiltinProvidersOptions = Readonly<{
  [K in BuiltinProviderKind]?: ProviderFactoryOptionsMap[K];
}>;

interface BuiltinProvidersResult {
  providers: readonly Provider[];
  unconfigured: readonly Readonly<{
    kind: BuiltinProviderKind;
    missingOptions: readonly string[];
  }>[];
}

declare function builtinProviders(
  options?: BuiltinProvidersOptions,
): BuiltinProvidersResult;
```

每个内建 Provider subpath 用 declaration merging 把自己的 kind 和精确 options 类型加入 `ProviderFactoryOptionsMap`，`providers/all` 生成并校验 40 项完整映射。`missingOptions` 只列非秘密 factory 字段名，不列 credential、环境变量值或账号信息。具有完整安全默认值的 kind 即使未传 options 也进入 `providers`；必需字段缺失的 kind 只进入 `unconfigured`。

具体 protocol subpath 的准确 symbol inventory：

| Protocol subpath          | Contract                        | Adapter factory                      | 持久 codec（适用时）                           |
| ------------------------- | ------------------------------- | ------------------------------------ | ---------------------------------------------- |
| `openai-responses`        | `openAiResponsesContract`       | `createOpenAiResponsesAdapter`       | `openAiResponsesReplayCodecs`                  |
| `openai-chat-completions` | `openAiChatCompletionsContract` | `createOpenAiChatCompletionsAdapter` | `openAiChatCompletionsReplayCodecs`            |
| `openai-codex-responses`  | `openAiCodexResponsesContract`  | `createOpenAiCodexResponsesAdapter`  | `openAiCodexResponsesReplayCodecs`             |
| `azure-openai-responses`  | `azureOpenAiResponsesContract`  | `createAzureOpenAiResponsesAdapter`  | `azureOpenAiResponsesReplayCodecs`             |
| `anthropic-messages`      | `anthropicMessagesContract`     | `createAnthropicMessagesAdapter`     | `anthropicMessagesReplayCodecs`                |
| `google-generative-ai`    | `googleGenerativeAiContract`    | `createGoogleGenerativeAiAdapter`    | `googleGenerativeAiReplayCodecs`               |
| `google-vertex`           | `googleVertexContract`          | `createGoogleVertexAdapter`          | `googleVertexReplayCodecs`                     |
| `bedrock-converse-stream` | `bedrockConverseStreamContract` | `createBedrockConverseStreamAdapter` | `bedrockConverseStreamReplayCodecs`            |
| `mistral-conversations`   | `mistralConversationsContract`  | `createMistralConversationsAdapter`  | `mistralConversationsReplayCodecs`             |
| `pi-messages`             | `piMessagesContract`            | `createPiMessagesAdapter`            | `piMessagesReplayCodecs`                       |
| `dashscope`               | `dashScopeContract`             | `createDashScopeAdapter`             | `dashScopeReplayCodecs`                        |
| `ark-responses`           | `arkResponsesContract`          | `createArkResponsesAdapter`          | `arkResponsesReplayCodecs`                     |
| `openrouter-images`       | `openRouterImagesContract`      | `createOpenRouterImagesAdapter`      | —                                              |
| `dashscope-images`        | `dashScopeImagesContract`       | `createDashScopeImagesAdapter`       | —                                              |
| `dashscope-image-tasks`   | `dashScopeImageTasksContract`   | `createDashScopeImageTasksAdapter`   | operation state codec 由 adapter contract 提供 |
| `ark-images`              | `arkImagesContract`             | `createArkImagesAdapter`             | —                                              |
| `xai-images`              | `xAiImagesContract`             | `createXAiImagesAdapter`             | —                                              |
| `xai-videos`              | `xAiVideosContract`             | `createXAiVideosAdapter`             | operation state codec 由 adapter contract 提供 |
| `ark-video-tasks`         | `arkVideoTasksContract`         | `createArkVideoTasksAdapter`         | operation state codec 由 adapter contract 提供 |
| `kling-video-tasks`       | `klingVideoTasksContract`       | `createKlingVideoTasksAdapter`       | operation state codec 由 adapter contract 提供 |
| `duoduo-generation-v1`    | `duoduoGenerationContract`      | `createDuoduoGenerationAdapter`      | operation state codec 由 adapter contract 提供 |

Adapter factory 只构造无请求状态对象；SDK-backed factory 可返回 Promise 并延迟 import。没有 opaque replay 的 protocol 仍可导出空的只读 `...ReplayCodecs`，但 binding 不注册空 codec set。基础工厂和 Node 端口签名冻结为：

```ts
interface ApiKeyAuthOptions {
  binding: AuthBindingPolicy;
  environmentVariable: string;
  scheme: string;
  placement:
    | { type: 'header'; name: string; prefix?: string }
    | { type: 'query'; name: string };
}

declare function apiKeyAuth(options: ApiKeyAuthOptions): ProviderAuth;
declare function defineProviderIdentity(
  descriptor: ProviderIdentityDescriptor,
): ProviderIdentityDescriptor;

interface OpenAiCompatibleProviderOptions<
  TProtocol extends 'openai-chat-completions' | 'openai-responses',
> {
  id: ProviderInstanceId;
  name: string;
  baseUrl: URL;
  protocol: TProtocol;
  auth: ProviderAuth;
  catalogCompatibilityVersion: string;
  contractManifest: ProviderContractManifest;
  defaultProfile: ModelProtocolProfile<TProtocol>;
  profiles?: readonly ModelProtocolProfile<TProtocol>[];
  models: readonly AdditionalModelInput<TProtocol>[];
  headers?: Readonly<Record<string, string>>;
}

declare function createOpenAiCompatibleProvider<
  TProtocol extends 'openai-chat-completions' | 'openai-responses',
>(options: OpenAiCompatibleProviderOptions<TProtocol>): Provider;

declare function createProxyFetchTransportDriver(options: {
  proxyUrl: URL;
  noProxy?: readonly string[];
}): TransportDriver;
declare function createNodeWebSocketTransportDriver(options?: {
  connectTimeoutMs?: number;
  proxyUrl?: URL;
}): TransportDriver;
```

`apiKeyAuth()` 的 placement 自动成为 protected field，binding origin 仍必须显式给出；query key 永不出现在 diagnostics。通用 OpenAI factory 把 base URL、headers、模型/profile 与 compatibility version 全部放入 canonical configuration identity，拒绝 secret-shaped header、未知 profile、空模型和未覆盖该 origin 的 auth binding。file store/CLI runner 的签名见 CLI 章节；测试实现不得从生产 Provider subpath 导出。

<a id="testing"></a>

## 测试设计

### 测试分层

- `core`：判别联合、model/ref/handle 不变式、deferred tool 状态、tool argument 解析/schema 校验、ReplayScope/source、FinishReason、1h cache/service-tier Usage/Cost 和错误脱敏。
- `stream`：Runtime-owned sink 与 attempt-local retry、块交错/配对及 block replay、唯一终态、partial response、iterator 先注册与 result-first 永久 drain、late observer 拒绝、提前 return、取消、背压和 detached task 失败。
- `transport`：FinalRequestTarget 的 protected query/header 冲突、trusted request mutation 重校验、secret materialize/signing seam、重定向再授权、SSE 分片、UTF-8 边界、WebSocket、dispatch phase、idempotency、`Retry-After`、代理和 abort。
- `context`：跨 Provider reasoning/replay 剥离、图片降级、tool ID 映射、deferred eager/strict 策略、孤立 tool result 与失败 turn 过滤。
- `auth`：API Key 优先级、环境 key 的 process-local keyed identity/轮换/状态归一、ambient lifetime 声明、action-level scope authority、scope fingerprint active/old key 生成与跨实例验证、五个 OAuth flow、AbortSignal、跨进程 refresh lease 的 takeover/lost-lease/heartbeat/hard deadline、带 deadline 的 waiter、token rotation 后 commit 前崩溃、revision/sealed tombstone 防 ABA、完整 PersistedCredentialRecord/AAD/header-payload 自校验、auth-binding origin、ambient/override policy、文件权限/锁/路径、logout/revoke、审计与错误脱敏。
- `catalog`：manifest/schema/digest、多来源交集、字段级合并、scope-aware handle 身份与跨租户隔离、稳定 catalog binding fingerprint 跨 Runtime 命中及不兼容 version miss、environment/process-local identity 禁止持久 cache、Radius providerState 校验/动态刷新、store-authoritative ticket/TTL/stale writer、versioned payload codec、部分 list report、刷新失败、Credential 过滤与安全字段不可覆盖。
- `session`：并发 acquisition、credential replacement 后不复用、在途 cleanup、TTL、重复 cleanup、部分 dispose 失败和 runtime dispose。
- `protocols`：typed options/compatibility/parser 与逐模型 profile/reasoning map、分层 merge、payload 转换、事件录制 fixture、partial tool JSON、context overflow、replay codec 显式 binding 注册、重复 tuple 冲突、旧版本只读与未知 codec/version 安全剥离、typed terminal 和 abort。
- `providers`：规范矩阵每个 binding 的请求/流 fixture，加每个认证、endpoint、catalog 与兼容 profile 分支断言。
- `generation`：domain envelope/claims codec、四阶段映射、artifact 限长/过期、唯一 operation、detach/abort/cancel 竞态、跨进程 seal/open 与未知 domain/version fail closed；图片与视频共享同一状态机 contract。
- `images`：scope-aware 动静态目录/handle、ordered multimodal input、text/image output、response ID/token cost、model async flag 与 direct/resumable binding 双向一致、create/poll/cancel protected target、detach handoff、显式 operation serialize/parse/resume 边界、partial/typed terminal；claims union、TTL/skew、token 篡改及 scope/credential/auth/config/profile/model/operation-binding 不匹配全部 fail closed。override operation 还覆盖 verifier preflight、同 secret 跨 Runtime、proof/key rotation与 constant-time compare。
- `videos`：generate/edit/extend 的输入组合、文本/图片/视频/音频 capability、duration/resolution/aspect/FPS、预览、按秒 usage/cost、create/poll/cancel/resume/detach、临时产物、xAI/Seedance/Kling 状态与错误 fixture。
- `channel extensibility`：同一 publisher/family 经直连与综合平台得到不同 handle/cache/price/operation identity；远端目录不能提升为受信 route/profile；fake owned gateway 覆盖排队、模型加载、模型下线、可选 compute usage 和替换 adapter 不改调用方。
- `cli`：命令解析、非互动输出、敏感值隐藏和付费请求开关。
- `consumer fixture`：只从公共 export map 编译一个未来 Agent 风格调用方，禁止深度导入 `src/`。

### 契约测试

每个 ProtocolAdapter 必须通过统一流契约。每个 Provider × protocol binding 必须通过统一注册、认证、endpoint、目录、请求、流和错误契约。`@duoduo/ai/testing` 提供：

- `FakeProvider`
- `FakeProtocolAdapter`
- 脚本化事件/错误队列
- 可注入 fixture transport
- 流事件序列断言
- Provider/Protocol contract suite factory

上述名称不是占位符，公共 seam 冻结如下：

```ts
interface ScriptedProtocolChunk {
  afterMs?: number;
  event: ProtocolContentEvent;
}

interface FauxResponseScript {
  chunks: readonly ScriptedProtocolChunk[];
  terminal: ProtocolTerminal;
}

interface FauxCallRecord {
  callIndex: number;
  modelId: string;
  context: Readonly<AiContext>;
  options: Readonly<ResolvedStreamOptions>;
  startedAt: number;
  aborted: boolean;
}

interface FauxController {
  setResponses(scripts: readonly FauxResponseScript[]): void;
  appendResponse(script: FauxResponseScript): void;
  pendingCount(): number;
  callCount(): number;
  calls(): readonly FauxCallRecord[];
  reset(): void;
}

interface FauxProviderFixture {
  provider: Provider;
  controller: FauxController;
  modelRef: ModelRef<'faux'>;
}

interface FixtureTransportResponse {
  status: number;
  headers?: Readonly<Record<string, string>>;
  bodyChunks: readonly Uint8Array[];
  chunkDelayMs?: number;
  failure?: TransportDriverFailure;
}

interface RedactedFixtureRequest {
  method: string;
  origin: string;
  pathname: string;
  headerNames: readonly string[];
  bodyDigest?: string;
}

declare function createFauxProvider(options?: {
  id?: string;
  models?: readonly AdditionalModelInput<'faux'>[];
  initialResponses?: readonly FauxResponseScript[];
}): FauxProviderFixture;

declare function fauxTextResponse(
  text: string,
  options?: { paceMs?: number; usage?: Usage; cost?: Cost },
): FauxResponseScript;
declare function fauxToolResponse(input: {
  id: string;
  name: string;
  rawArguments: string;
  paceMs?: number;
  usage?: Usage;
}): FauxResponseScript;
declare function fauxFailure(input: {
  error: AiError;
  afterChunks?: readonly ScriptedProtocolChunk[];
}): FauxResponseScript;

interface FixtureTransport extends TransportDriver {
  enqueue(response: FixtureTransportResponse): void;
  requests(): readonly RedactedFixtureRequest[];
  pendingCount(): number;
}

interface ContractTestCase {
  id: string;
  run(): Promise<void>;
}

declare function createProtocolContractSuite(input: {
  protocol: string;
  createAdapter(): Promise<ProtocolAdapter> | ProtocolAdapter;
  fixtures: readonly string[];
}): readonly ContractTestCase[];

declare function createProviderContractSuite(input: {
  createProvider(): Provider;
  manifest: ProviderContractManifest;
  fixtureTransport: FixtureTransport;
}): readonly ContractTestCase[];
```

response script 在 request producer 启动时按 FIFO 原子保留；并发请求各拿一个，队列为空返回确定的 `FAUX_RESPONSE_QUEUE_EMPTY` 测试错误。`setResponses()` 只替换尚未保留的队列，不影响 in-flight script；`appendResponse()` 追加；`reset()` 要求无 in-flight，否则失败。`afterMs` 使用 injected fake clock，0 表示同一 microtask，abort 取消未发布 chunk 并产生 cancelled terminal。controller 记录调用次数、顺序与经过冻结/脱敏的 context/options，不记录 credential；返回数组不可修改。usage/cache/service-tier/cost 直接由 script terminal 模拟，因此可以确定性覆盖 Anthropic 1h cache、paced chunks、partial failure、result-first drain 和 retry attempt。所有 response factory 都只构造 script，不创建全局 registry。

contract suite factory 返回 runner-neutral cases，不静态依赖 Vitest；package 自己用 `it.each` 执行，第三方 Provider 可接入任意测试框架。Protocol suite 固定默认值/profile/reasoning map、tool schema、overflow、terminal、transport phase、abort 与 replay；Provider suite 从 manifest 自动展开每个 auth/endpoint/profile/fixture ID，并在有声明无 fixture、fixture 未被消费或 source locator 缺失时失败。

默认 `pnpm test` 只运行确定性测试，不读取用户真实凭证或访问付费 API。`test/live` 需显式命令和对应环境变量，并将预算上限与使用的模型记录在文档中。

### Live test 安全与运行规范

live test 与 fixture test 是两套入口。普通 `pnpm test`、根 `pnpm build`、安装脚本和 catalog 生成器都不得 import/触发 live runner。唯一入口为：

```text
DUODUO_AI_LIVE=1 \
DUODUO_AI_LIVE_PROVIDERS=openai \
DUODUO_AI_LIVE_MAX_USD=0.25 \
pnpm --filter @duoduo/ai test:live -- \
  --provider openai \
  --model "$OPENAI_MODEL" \
  --allow-paid
```

runner 必须同时看到四个互相独立的 opt-in：`DUODUO_AI_LIVE=1`、Provider 在逗号分隔 allowlist、正数预算上限、CLI `--allow-paid`；缺一个就只打印跳过原因并退出非成功的专用 code，不能猜默认 Provider/model。图片测试另要求 `DUODUO_AI_LIVE_MAX_IMAGES`，视频测试另要求 `DUODUO_AI_LIVE_MAX_VIDEO_SECONDS`，默认缺失即禁用对应媒体能力；OAuth browser/device 流不在自动 live suite 中，必须用专用测试账号和显式 `test:live:oauth` 交互命令。

安全规则：

- 只使用隔离的开发账号/project/workspace、最小权限 API key 与 Provider 侧硬预算/限流；不得使用生产 refresh token、AWS production role 或共享管理员 ADC。
- 每次运行 concurrency 默认 1，单请求与总 suite 都有硬 deadline；只执行一个短文本、一个无工具流、一个最小 tool call，图片最多按 opt-in 数量生成。
- runner 在请求前按 model price snapshot 估算最坏成本并原子扣减本地预算；价格未知、汇率非 USD 或上限将被突破时跳过，除非另有一次性 `--allow-unknown-cost`，该 flag 不得写入 CI。
- 本地预算是防误操作而非账单保证；CI/开发账号仍必须配置 Provider 侧 budget、quota 和告警。
- prompt、图片和工具参数只用仓库内合成 fixture；输出默认只记录长度、digest、status、usage/cost 与 request correlation ID，不保存完整生成内容。
- stdout/JUnit/artifact 对 Authorization、Cookie、API key 形态、query、account label、operation token、scope 与 SDK error object 做二次脱敏；脱敏扫描失败使 suite 失败并拒绝上传 artifact。
- NetworkPolicy 只放行所选 Provider 的已知 model/catalog/OAuth origin；live test 不因方便允许任意 HTTPS、localhost、代理或私网。
- live 结果不得直接覆盖确定性 fixture。更新 fixture 使用单独 `test:record --sanitize --review` 流程，先 schema allowlist、去 secret/request ID/时间噪声，再人工 diff；真实响应原件不进 Git。

每次结果摘要记录 package commit、Provider kind/instance、model ID、region、protocol、开始/结束时间、成功/失败、usage、估算/Provider-reported cost 与已执行 case 名，不记录 credential 来源明文或账号。CI 中 live job 必须手动触发、受保护 environment 审批、无 fork secret、不可作为普通 PR 必过检查；定时 canary 也使用独立低额度账号。

## 运行时与构建

- Node.js 22 是主要服务端运行时。
- core、stream、context 和通用 transport 使用 Web Platform API，保持浏览器 bundler 可用性。
- Node-only 能力通过独立 subpath 和延迟加载隔离。
- package 使用 ESM、NodeNext、严格 TypeScript、declaration output 和完整 export map。
- 开发时 workspace 消费和生产 build 都使用同一公共 export map；不允许消费者深度导入 `src/`。
- 每个 Provider 和 protocol subpath 必须可被单独导入。`providers/all` 是唯一个有意拉入全部 Provider 定义的入口。
- 重 SDK 和 OAuth 流使用延迟 import，并通过测试确认单 Provider 导入不会加载其他 Provider。

## 版本、兼容与发布策略

package 使用 SemVer。首次声明稳定前可以发布 `0.x`，但 workspace 内也禁止无记录破坏：`0.x` 的 breaking change 只能进入 minor 并附迁移说明；`1.0` 后删除/重命名 public export、改变已有字段语义、收窄输入、增加必选配置、改变事件顺序/终态或让已有 protocol ID 指向另一 wire contract 都是 major。新增 optional field、Provider/model、独立 subpath 或兼容 profile 通常是 minor；纯 bug/security 修复与不改变公共语义的 catalog 元数据修正是 patch。

判别联合需要额外谨慎：为公共 stream event、response status、finish reason、credential state 或 error category 增加新成员会破坏消费者 exhaustive switch，稳定版按 major 处理。可扩展 Provider-specific 值使用已设计的 declaration map，不把未知 string 偷塞进核心闭合联合。error `code/category/retryable`、protocol/provider ID、环境变量名与 export path 都属于兼容面；message、diagnostic 文案、目录 `generatedAt` 和上游 request ID 不属于。

持久格式各自独立版本化：

| 格式                       | 升级规则                                                                                                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credential record          | sealer 读取当前与明确支持的旧 schema，校验后在 store 锁/CAS 内原子迁移；绝不明文落盘、静默降级或把未知版本当 empty                                                                      |
| Catalog payload/cache key  | owner codec 可丢弃不可读旧 payload 并重新生成/发现；schema/catalog compatibility version 变化形成新 key，不就地猜字段                                                                   |
| Serialized media operation | generation envelope 与图片/视频 claims 分开版本；Runtime 必须在 `maxTtlMs + 2 × allowedClockSkewMs` 内继续打开曾签发的版本/key，不兼容 poll 语义由 operation compatibility version 拒绝 |
| Replay metadata            | 每个 protocol codec 自己读旧 payload；未知 version 按 context policy剥离 opaque replay，不把未验证数据发给 Provider                                                                     |
| Provider factory config    | 影响 auth/routing/catalog/compatibility 的默认值变化进入 config fingerprint；不兼容 catalog/operation 解释还必须递增对应 compatibility version                                          |

弃用至少经历两个 minor：先保留旧 export/option 并在类型注释、文档和运行时 diagnostic 标记替代项；下一个 minor 默认行为仍不改变；再到 major 删除。安全漏洞、上游 endpoint 关闭或 Provider 强制下线可缩短周期，但必须 fail closed、发布安全说明和明确迁移路径，不能悄悄路由到另一区域/账号/协议。

目录快照发布流程固定：

1. 在干净 worktree 运行 `pnpm --filter @duoduo/ai catalog:update --strict`；所有 manifest source 拉取成功、digest/官方引用/验证日期齐全后才写临时产物。
2. generator 对同一 pinned inputs 连跑两次必须得到相同 output digest；不把 `generatedAt` 等非确定时间混入语义 digest。
3. 自动 diff 分 Provider 列出新增/删除 model、protocol、capability、limits、pricing、region、source digest；任何 auth/endpoint/protocol 字段变化直接失败，要求改受信代码而非接受远端值。
4. 运行 schema、catalog contract、Provider fixture、consumer compile 与 tree-shaking 测试。模型删除至少一个 minor 标为 deprecated；上游已硬删除时允许立即移除，但 release note 必须列出替代 model。
5. snapshot 与 manifest 同一 commit 发布。普通 install/build/test 永不联网验证“最新”，应用是否升级由 lockfile/release 决定。

新增 Provider/protocol/capability/media operation mode 使用 minor，并更新 Provider/协议矩阵、public exports、live allowlist 与 contract fixtures。`providers/all` 的集合增加属于 minor；单 Provider subpath 的依赖体积回归和意外 SDK eager import 视为发布阻断。第一版明确没有 PI legacy compatibility 层，未来也不为保留错误设计添加隐藏全局注册表。

<a id="implementation-gates"></a>

## 实现顺序

实现可在内部分片，但本阶段的交付终点是完整 `@duoduo/ai`，不把只有少量 Provider 的中间状态宣称为完成。每个 gate 必须在进入下一阶段前通过 package 范围的 format check、lint、typecheck、test、build 和 `git diff --check`。

1. **Foundation gate**：建立 package/export map、core types、error/finish model、stream state machine 和 testing primitives；以事件状态机、observer/drain、取消和所有终态测试为门槛。
2. **Runtime gate**：实现 registry、scope authority、auth/lease/CAS、catalog/cache、context、transport、session lifecycle 和 telemetry ports；以跨租户隔离、并发刷新、SSE/WebSocket 和 dispose 竞态测试为门槛。
3. **Protocol gate**：实现规范清单中的通用 protocols 与 fixture recorder/replayer；每个 adapter 通过统一请求、流、tool/reasoning、usage、错误和取消 contract。
4. **Baseline Provider gate**：按协议族接入 PI 基线 36 个文本 Provider、五个 OAuth flow、Radius 动态目录和 OpenRouter Images；规范矩阵每个 binding 通过 fixture，`providers/all` tree-shaking 检查通过。
5. **Extended Provider gate**：在基线已包含 MiniMax 双区的前提下，实现 Qwen 四种文本 binding、豆包 Responses/Ark、Qwen direct/resumable 图片和 Seedream direct 图片；所有协议选择、区域 endpoint、原生/create/poll/cancel route 和 explicit model 行为由 fixture 固定。
6. **Generation gate**：实现共享 generation operation/artifact/progress 内核，把图片 operation 迁入该内核，并以 xAI Grok Imagine 完成图片生成/编辑和第一个视频纵向调用；图片既有语义不得回归。
7. **Generation Ecosystem gate**：实现 Seedance 2.0、Kling 与 `self-hosted-generation`，增加综合平台 contract fixture，证明同模型多渠道隔离和自建网关可替换；不实现真实 GPU 调度器。
8. **Productization gate**：实现 CLI、目录生成器、公共文档、live-test harness 与只使用公共 exports 的 consumer compile fixture；完成全仓验证，但不修改 `agent` workspace。

<a id="gate-evidence"></a>

## Gate 追踪与验收证据

实现状态必须记录在 `packages/ai/IMPLEMENTATION-STATUS.md`，每个 gate 只有 `not-started | in-progress | passed` 三种状态；只有表中产物存在且命令在当前 commit 成功才可标 `passed`。当前文档完成时八项均为 `not-started`。

| Gate                 | 必读章节                                         | 必须存在的产物                                                                             | 最小专项证据                                                                    |
| -------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Foundation           | 核心领域协议、流协议、错误协议、测试契约         | core/stream/testing public types、Faux controller、consumer type fixture                   | `pnpm --filter @duoduo/ai test -- --run core stream testing`                    |
| Runtime              | Runtime API、认证、目录、传输、session、安全模型 | registry、scope/store/codec、catalog、transport/session implementations 与 threat fixtures | `pnpm --filter @duoduo/ai test -- --run runtime auth catalog transport session` |
| Protocol             | ProtocolAdapter、wire matrix、replay、context    | 12 个文本 adapter subpath、profile registry、manifest/recorded fixtures                    | `pnpm --filter @duoduo/ai test -- --run protocols context`                      |
| Baseline Provider    | PI 基线、Provider 矩阵、OAuth、OpenRouter Images | 36 个 PI Provider、5 个 OAuth、Radius discovery、OpenRouter Images；manifest coverage 100% | `pnpm --filter @duoduo/ai test -- --run providers baseline-parity`              |
| Extended Provider    | Qwen、MiniMax、豆包、图片任务恢复                | Qwen/豆包 subpath、双区 MiniMax、Wan direct/task 与 Seedream fixtures                      | `pnpm --filter @duoduo/ai test -- --run providers extended images`              |
| Generation           | generation 内核、媒体生成、xAI Imagine           | operation domain envelope、videos public interface、Grok Imagine image/video fixtures      | `pnpm --filter @duoduo/ai test -- --run generation images videos xai`           |
| Generation Ecosystem | 视频矩阵、渠道模型、自建网关                     | Seedance/Kling/self-hosted subpath、综合平台与 fake gateway contract                       | `pnpm --filter @duoduo/ai test -- --run videos channels self-hosted`            |
| Productization       | CLI、公共导出、live 规范、版本发布               | bin、file stores、catalog generator、API report、public-only consumer、live harness        | `pnpm --filter @duoduo/ai test -- --run cli exports catalog-generator consumer` |

每个 gate 还必须运行统一证据集：

```text
pnpm --filter @duoduo/ai format:check
pnpm --filter @duoduo/ai lint
pnpm --filter @duoduo/ai typecheck
pnpm --filter @duoduo/ai test
pnpm --filter @duoduo/ai build
pnpm --filter @duoduo/ai api:check
pnpm --filter @duoduo/ai manifest:check
git diff --check
```

`api:check` 对 export map 与本文 symbol inventory；`manifest:check` 对 Provider 矩阵、profile/auth/endpoint branches、fixture IDs 和 pinned sources。每次结果写入 status 文件的 commit、UTC 时间、Node/pnpm 版本和命令 exit code，不粘贴 secret 或完整模型输出。最终 Productization 还须在临时移走 `vendor/pi` 的环境中重跑 build/test，证明 vendor 仅用于开发期 parity 审计。

## 验收标准

1. `@duoduo/ai` 以单 workspace package 存在，且内部模块符合本文档的依赖方向。
2. 根入口无 Provider 注册、环境变量读取、OAuth 加载或目录聚合副作用。
3. 规范矩阵中的 36 个 PI 文本 Provider 全部有一等导入，Qwen、豆包、Kling 与 self-hosted generation 也有一等导入，MiniMax 同时覆盖国际与中国区。
4. 所有 Provider 可独立注册；提供 Qwen region、self-hosted gateway base URL 等必需非秘密配置后，`providers/all` 可一次构造并注册完整 40 个 kind，缺失配置时显式报告 `unconfigured`。
5. 每个 Provider × protocol binding manifest 覆盖所有 auth/endpoint/profile 分支并至少有请求、流和错误 fixture；逐模型 compatibility/reasoning map、typed terminal、context overflow、tool validation、replay 与 usage/cost 全部通过契约测试。
6. Anthropic、OpenAI Codex、GitHub Copilot、xAI、Radius OAuth，以及 action-level scope authority、完整 sealed record、lease fencing/CAS token 刷新、登录和退出具有确定性测试；Google/AWS ambient auth 不伪装为 OAuth。
7. 单/多来源静态目录 manifest 与 digest、Radius 动态刷新/providerState、scope-bound handle、完整缓存身份/租户隔离、跨 Runtime 稳定 catalog binding key、environment/process-local identity 不落持久 cache、store-authoritative ticket/TTL、字段级 override、stale write、失败保留和安全字段保护具有确定性测试。
8. OpenRouter Images 保留 ordered text/image input、text+image output、response ID 和 token/cache cost；Qwen `wan2.6-image` direct 与 `wan2.6-image@task` 发送同一 upstream model 但使用各自官方 route；豆包支持显式图片 Model/Endpoint ID；xAI Grok Imagine 覆盖官方生成/编辑与参考图。任务流支持安全 detach、serialize/parse/resume、remote cancel 分离，并拒绝篡改或跨 scope/credential/config/profile/operation-binding 恢复。
9. `generation` 是图片/视频唯一共享的 operation 状态机；两种领域保留不同输入、模型、输出和 branded ref，未知 domain/version fail closed，排队/准备/运行/收尾在所有渠道保持一致事件语义。
10. xAI Grok Imagine Video、Seedance 2.0 与 Kling video 均有官方来源、严格 capability/profile、create/poll/error/临时产物 fixture；只实现官方可验证的 cancel/edit/extend 行为，不推测 route 或字段。
11. 综合平台把渠道与 publisher/family 分开；同一上游模型经不同 Provider 得到不同 handle、目录缓存、价格和 operation identity，且第一版不发生隐式跨 Provider fallback。
12. `self-hosted-generation` 通过 owned Generation Gateway contract 同时承载图片与视频；fake gateway 证明实现可替换，通用包不导入云 GPU SDK，也不暴露实例、容器或调度细节。
13. 默认测试不访问真实 Provider，live tests 需显式开启。
14. 在 `vendor/pi` 不存在的环境中，包仍能独立安装、类型检查、测试和构建。
15. `pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`git diff --check` 全部通过。
16. 文档包含快速开始、Provider 矩阵、认证说明、新增 Provider/Protocol 模板、图片/视频生成、渠道扩展、CLI 和 live test 安全说明。
17. session cleanup/runtime dispose 释放全部协议资源，且在并发与失败路径保持幂等。
18. consumer compile fixture 覆盖所有公共端口/typed module augmentation 且只使用公共 export map；本阶段没有为了演示而修改 Agent loop。
19. Adapter 无法取得 raw credential、secret reveal、endpoint/auth query/header 或任意 signing 权限；只有绑定 target 的 transport seam 可为发送 materialize credential，package-owned auth/record/operation wrappers 可在各自窄用途内 materialize。外部 `TransportDriver` 与 `OperationCredentialDigestDriver` 是明确记录在威胁模型中的可信计算基，前者只能发送已绑定请求，后者只能处理带 domain separation 的 canonical credential bytes，二者都不得保留或记录秘密。
20. 独立 CLI 使用 sealed file store 和跨进程 key source；登录后新进程可读取同一 credential，key 不可用时 fail closed，inventory 可在未登录时列出但不能伪装成 available handle。
21. Runtime resource policy、transport dispatch phase/retry safety、credential/generation codec 判别结果和 trusted request customization 都有边界、失败与 secret-leak fixture。

## 开放问题

无。已确认单包严格模块化、完整 PI AI 能力范围、图片与视频独立领域 interface、共享 generation operation 内核、Qwen/MiniMax/豆包/Kling/Grok Imagine 一等能力、综合平台渠道模型、自建 Generation Gateway seam、云 GPU 控制面隔离、第一版显式渠道选择、五个准确 OAuth flow、Radius 动态目录、跨进程 operation credential proof、scope authority/lease/CAS、多租户缓存隔离、session 资源生命周期，以及错误、安全与测试策略。

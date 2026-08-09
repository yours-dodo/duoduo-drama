# `@duoduo/ai` AI Gateway Runtime 差距基线

- 审查日期：2026-07-28
- 目标读者：维护 `@duoduo/ai`、Agent Runtime 和未来 Gateway Host 的工程师
- 阅读后的行动：能够判断一个需求应落入哪个模块，按 80/20 优先级推进五个实施切片，并区分当前 Runtime 工作与保留的 Gateway Host 方向
- 文档性质：目标边界与差距基线；它不替代逐次实现计划

## 结论

`@duoduo/ai` 已经是成熟的、供应商中立的 AI Gateway Runtime 候选版本。它不是简单的 Provider SDK 包装：Provider 注册、模型目录、认证、传输、会话、文本流、工具协议、图像/视频生成、可恢复任务和运行时关闭都已经位于统一接口之后。

当前缺口不在 Provider 数量，而在五项生产能力：Chat 协议选项强类型化、Structured Output、Runtime 可观测性、跨请求的传输可靠性，以及真实 Provider 验收闭环。完成这五项后，可以把当前声明范围标记为生产级 Gateway Runtime。

本文所说的“完整”特指：

> 在 Node.js 宿主进程内，为 Agent 和应用提供文本、工具、图像与视频能力的生产级 AI Gateway Runtime。

它不表示 `@duoduo/ai` 自身需要成为带 HTTP 入站、多租户配额、账单和管理后台的独立 Gateway 产品。

## 当前基线

截至本次审查，当前发布面和离线门禁基线为：

- 38 个内建 Provider；
- 59 个 Provider manifest binding；
- 75 个公共导出；
- 20 个公共协议子路径、51 个运行时协议符号；
- 69 个测试文件、413 项测试；
- build、typecheck、lint、format、API、manifest、离线目录和 release 检查通过；
- Agent 已通过 `@duoduo/ai` 公共导出组装 Runtime、注册 Provider、解析模型并管理关闭。

已经完成的能力包括：

| 能力                                              | 当前状态 |
| ------------------------------------------------- | -------- |
| Provider 注册和显式子路径导入                     | 已完成   |
| 供应商协议映射和流事件归一化                      | 已完成   |
| API Key、OAuth、ambient auth 和凭证作用域隔离     | 已完成   |
| NetworkPolicy、请求大小限制和受保护认证头         | 已完成   |
| Timeout、指数退避、抖动、`Retry-After` 和安全重试 | 已完成   |
| 文本、reasoning、工具调用和多模态图片输入         | 已完成   |
| 图像、视频和可恢复生成任务                        | 已完成   |
| usage、cost、diagnostics 和稳定终态               | 已完成   |
| Session 租约、资源隔离和优雅关闭                  | 已完成   |
| 离线 fixture、公共消费者和发布隔离门禁            | 已完成   |

## 模块分工

完整 Gateway 产品包含 Runtime 和 Host 两部分。当前仓库只要求 `@duoduo/ai` 完成 Runtime。

| 模块                 | 应负责                                                                                 | 不应负责                                              |
| -------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `@duoduo/ai`         | Provider、协议、认证、传输、模型句柄、文本/媒体调用、Runtime 级可靠性和事件            | Agent Loop、业务模型选择、多租户数据库、HTTP 入站接口 |
| Agent Core / Harness | Agent Loop、上下文、工具执行、应用级模型选择、业务 fallback policy                     | Provider 线协议、认证头、传输重试                     |
| Gateway Host（未来） | HTTP/SSE/WebSocket 入站、Virtual Key、租户配额、使用量持久化、跨 Provider 路由和高可用 | 重复实现 Provider adapter 或模型线协议                |

这个 seam 保持 `createAi()` 的外部接口较小，同时把 Provider 差异、认证和可靠性复杂度留在深模块内部。

## 差距矩阵

| 编号 | 差距                        | 当前实现                                                           | 目标状态                                                      | 归属                    | 80/20 优先级 |
| ---- | --------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- | ----------------------- | ------------ |
| G01  | Chat 协议选项类型           | 文本 `protocolOptions` 是无结构记录；媒体协议选项已类型化          | 由模型协议参数推导合法选项，并严格拒绝未知或错配字段          | `@duoduo/ai`            | P1           |
| G02  | Structured Output           | 可通过工具或私有 Provider 选项间接实现                             | 供应商中立的 JSON/JSON Schema/strict 合约、能力声明和失败语义 | `@duoduo/ai`            | P0           |
| G03  | Runtime 可观测性            | 响应含 requestId、usage、cost 和 diagnostics；缺少全局生命周期事件 | 默认脱敏的请求、尝试、重试、首 token、终态和媒体任务事件      | `@duoduo/ai`            | P0           |
| G04  | 跨请求传输可靠性            | 已有单请求 timeout/retry/idempotency                               | Circuit Breaker、Bulkhead、排队上限和稳定拒绝错误             | `@duoduo/ai`            | P1/P2        |
| G05  | 真实 Provider 验收          | 协议和运行时主要由离线 fixture 验证；在线运行默认无执行器          | 实际启用 Provider 的受控 smoke suite 和可审计验收记录         | `@duoduo/ai` + 运维流程 | P0           |
| H01  | 跨 Provider 路由和 fallback | 调用方显式选择模型；聚合 Provider 可在自身实例内路由               | 未来 Host 或 Harness 根据业务策略选择、降级和归因             | Gateway Host / Harness  | 保留         |
| H02  | 租户限流、预算和账单        | 有请求 usage/cost，无跨请求租户账本                                | 分布式计数、硬预算、Virtual Key 和 spend attribution          | Gateway Host            | 保留         |
| H03  | 缓存和 Guardrail            | 有 Provider prompt cache 提示，无 Gateway 响应缓存或业务过滤       | 按真实业务需求增加精确/语义缓存、PII 和内容策略               | Gateway Host / Harness  | 保留         |

## 80/20 优先级决策

优先级同时优化两个目标：尽快给短剧 Agent 提供直接产品价值，以及把 Runtime 推进到可验证、可运营的生产状态。两者同权，不采用单纯的产品优先或基础设施优先。

80/20 的重点不是只完成五项中的一项，而是先限定生产 Provider 和协议范围，打通一条端到端竖切，再扩大覆盖面。

### P0：当前最小生产闭环

P0 只覆盖生产实际启用的 Provider、模型和协议，不为 38 个 Provider 同时铺开新能力：

“生产 Provider profile”是应用拥有、受版本控制的非敏感允许列表，明确列出 Provider kind、模型引用、协议、所需能力、认证模式和必须通过的 live case。它不是新的 Provider 目录，不包含凭证，也不改变 `@duoduo/ai` 的公共接口；Agent 组合层和在线验收运行器把它作为显式输入。

1. **G05 基线验收**：先声明生产 Provider profile，并为已有文本流、reasoning 和工具调用建立受控 live smoke。
2. **G02 Structured Output**：只为生产 profile 中实际使用的协议实现可移植 JSON Schema profile、严格失败语义和最终校验。
3. **G03 核心可观测性**：先实现 `request`、`attempt`、`retry`、`first_content` 和 terminal 事件，以及本地 request context；不在 P0 完整覆盖所有 Session 和媒体细节。
4. **G05 闭环验收**：让同一生产 profile 的 live smoke 覆盖 Structured Output，并验证观测事件、usage、cost、取消和错误归一化。

P0 的完成结果必须是一条真实可运行路径：

```text
生产 Provider profile
  → 现有能力 live smoke
  → Structured Output
  → 核心 Runtime 事件
  → 完整受控验收
```

### P1：扩大接口一致性和负载隔离

P1 在 P0 已产生真实使用证据后实施：

- **G01**：把 Chat 协议选项 parse/merge contract 扩展至全部发布协议，并完成公共消费者类型检查；
- **G03**：补齐图片、视频、Session、媒体轮询和取消事件；
- **G04 Bulkhead**：为聊天、直接媒体生成、长任务和轮询增加独立并发上限、有界等待和排队超时。

P1 的目标是扩大 locality 和故障隔离，而不是新增 Provider 或业务能力。

### P2：由运行证据触发的高级可靠性

Circuit Breaker 不因“生产系统通常应该有”而立即实现。满足以下任一信号后进入 P2：

- 重试后仍反复出现同一 Provider/端点的 429、5xx 或超时；
- 并发请求在故障期间形成明显的级联放大；
- 长时间媒体任务影响聊天请求的延迟或成功率；
- 运维无法仅靠现有 retry、timeout 和 Bulkhead 达成明确的可靠性目标。

P2 再实现 Circuit Breaker、半开探测、冷却和状态观测。跨 Provider fallback 仍不进入 Runtime。

### 保留项

H01–H03 和独立 Gateway Host 不进入当前实施顺序。它们只保留架构方向和启用条件，不创建代码、目录、依赖或网络契约。

## G01：Chat 协议选项强类型化

### 问题

文本 Runtime 的协议选项目前允许任意键值。调用方可以把一个协议的字段传给另一个协议，也可能在字段拼写错误后继续通过编译。Adapter 虽然会解析部分字段，但接口没有提供媒体通道已经具备的类型保证。

### 目标接口

建立 Chat 协议选项映射，并让 Runtime 调用从模型句柄推导协议：

```ts
interface ChatProtocolOptionsMap {}

type ChatProtocolOptions<TProtocol extends string> =
  TProtocol extends keyof ChatProtocolOptionsMap
    ? ChatProtocolOptionsMap[TProtocol]
    : Readonly<Record<string, JsonValue>>;

interface StreamOptionsInput<TProtocol extends string = string> {
  readonly protocolOptions?: ChatProtocolOptions<TProtocol>;
}
```

各协议通过声明合并注册自己的选项类型和解析器。公共字段继续由 Runtime 归一化；协议字段只能由对应协议解释。

### 必须满足的语义

- 请求级公共字段优先于兼容期的同义协议字段；
- 已知协议拒绝未知字段，不能静默忽略；
- 每个 Chat 协议提供单一的 parse/merge contract，Adapter 不再各自散落类型断言；
- Provider 默认、模型默认、协议 profile 和请求选项的合并顺序固定并有测试；
- 类型擦除后的 JavaScript 调用仍需运行时验证；
- 不把 Provider 私有字段提升为供应商中立公共字段，除非至少两个真实协议共享同一语义。

### 完成标准

- 所有现有 Chat 协议均注册明确的选项类型或显式空选项；
- 公共消费者测试证明协议错配在编译期失败；
- Adapter 合约测试覆盖未知字段、默认值合并和优先级；
- 现有 Provider 请求夹具保持等价。

## G02：供应商中立 Structured Output

### 问题

当前工具调用能够承载结构化参数，但 Runtime 没有正式描述“最终响应必须满足 JSON Schema”的公共语义。业务只能依赖提示词、工具技巧或 Provider 私有字段，无法获得一致的能力发现、校验和错误分类。

### 目标能力

在现有文本调用接口中增加统一输出格式，而不是创建一套平行的模型调用栈：

```ts
type ResponseFormat =
  | Readonly<{ type: 'text' }>
  | Readonly<{ type: 'json' }>
  | Readonly<{
      type: 'json_schema';
      name: string;
      schema: JsonSchema;
      strict?: boolean;
    }>;
```

模型能力需要声明原生支持情况，Runtime 需要区分：原生 JSON Schema、仅 JSON mode、工具模拟，以及不支持。

### 必须满足的语义

- 调用方显式决定是否允许降级；默认不应偷偷从 strict 降级为提示词 JSON；
- 定义跨 Provider 可移植的 JSON Schema profile；发送请求前拒绝该 profile 不支持的关键字；
- Provider 映射和最终结果校验必须使用同一个 schema profile，不能出现“请求接受、结果校验器不理解”的分裂语义；
- 最终结果必须经过 JSON 解析和 Schema 校验；
- 语法错误、Schema 不匹配、Provider 不支持和输出截断使用不同错误码；
- 流式调用可以继续输出文本 delta，但最终结果必须给出一次权威的结构化值或稳定失败；
- Structured Output 不执行工具，也不进入 Agent Loop；
- replay metadata、usage、cost 和取消语义保持不变。

### 完成标准

- 供应商中立 capability 和请求/响应类型完成；
- 至少覆盖产品实际启用的两种不同协议实现；
- 不支持的模型采用故障关闭行为；
- 正常、Schema 失败、长度截断、取消和 Provider 错误均有离线测试；
- Agent 可直接使用该能力生成剧本、分镜或角色等结构化领域数据。

## G03：Runtime 可观测性和请求上下文

### 问题

当前响应携带结果级元数据，但宿主无法通过一个稳定 seam 观察请求的尝试、重试、首 token、媒体轮询和取消。要获得这些信息，只能在调用方重复包装或深入内部实现，破坏 locality。

### 目标接口

`createAi()` 接受可选 Observer。请求选项接受仅供本地使用的相关性上下文：

```ts
interface AiRuntimeObserver {
  onEvent(event: AiRuntimeEvent): void | Promise<void>;
}

interface AiRequestContext {
  readonly correlationId?: string;
  readonly tags?: Readonly<Record<string, string>>;
}
```

建议的事件族：

- `request_start`、`request_end`；
- `attempt_start`、`attempt_end`；
- `retry_scheduled`；
- `first_content`；
- `media_poll`、`media_cancel`；
- `session_acquired`、`session_released`；
- `circuit_state_change`、`bulkhead_rejected`。

### 安全与失败语义

- 默认事件不包含 prompt、输出正文、凭证、认证头、签名 URL 或操作令牌；
- tags 的键、值、数量和总字节数必须受限；
- request context 绝不发送给 Provider；
- Observer 失败不能改变模型请求结果；
- 慢 Observer 不应成为内容流背压来源；
- 事件按单个 requestId 保序，通过有界、非阻塞 dispatcher 投递；
- 队列溢出时优先保留请求终态，允许丢弃或合并非终态事件，并在恢复后报告一次 `observer_overflow`；
- Runtime 关闭时在既有关闭时限内尽力排空 Observer，不能无限等待失联的 Observer；
- 事件必须携带 requestId、Provider、模型、协议、时间和终态；
- usage、cost、错误码和 retry 原因只在已知时出现。

### 完成标准

- 文本、图片和视频共享同一生命周期词汇；
- 事件顺序和 exactly-one terminal event 有确定性测试；
- Observer 抛错、超时或处理缓慢不会破坏主请求；
- release 检查覆盖事件脱敏金丝雀；
- Gateway Host 可以只依赖 Observer 构建日志、指标和 trace adapter。

## G04：Circuit Breaker 和 Bulkhead

### 问题

当前重试策略只处理单次调用内部的失败。多个并发请求仍可能持续冲击同一个失效或限流端点，也没有聊天和长时间媒体任务之间的并发隔离。

### 目标实现

在 Transport/Runtime 内增加跨请求状态，但不增加跨 Provider 自动路由：

- Circuit Breaker：`closed`、`open`、`half_open`；
- 按 Provider 实例、协议和受信端点标识分桶；
- 可配置失败阈值、统计窗口、冷却时间、半开探测数和恢复阈值；
- Bulkhead：分别限制聊天、图片直接生成、媒体长任务和轮询并发；
- 有界等待队列、排队超时和中止感知；
- Runtime dispose 时拒绝新排队并收口等待者；
- 稳定错误码：`CIRCUIT_OPEN`、`CONCURRENCY_LIMIT`、`QUEUE_TIMEOUT`。

### 必须满足的语义

- 只有网络、超时、429 和 Provider 5xx 等可归因失败影响 Circuit；
- 调用方错误、认证失败、内容过滤和取消不应错误地打开 Circuit；
- 半开阶段严格限制探测并发；
- Circuit 状态不得跨凭证作用域泄露敏感身份；
- Bulkhead 等待必须响应 AbortSignal；
- 不重试未知 dispatch 阶段的非幂等请求；
- 不在 Circuit 内部选择另一个 Provider。

### 完成标准

- 使用 Fake Clock 和夹具 Transport 验证所有状态转换；
- 并发、取消、排队超时、dispose 和恢复竞态有覆盖；
- 与现有 retry/idempotency 语义组合后不会重复执行非幂等请求；
- Observer 能看见拒绝、状态转换和恢复；
- 默认策略有界且可关闭。

## G05：真实 Provider 验收闭环

### 问题

离线 fixture 能证明映射和状态机逻辑，但不能证明真实 Provider 当前仍接受请求、返回相同事件、正确报告 usage，或按预期响应取消。在线测试当前具备预算和许可门禁，但没有默认网络执行器。

### 目标范围

只验收产品实际启用的 Provider，不以 38 个内建 Provider 全量付费执行作为完成条件。每个启用 Provider 至少覆盖适用项：

- 文本流和终态；
- reasoning；
- 工具调用；
- Structured Output；
- API Key 或 OAuth；
- timeout、cancel 和可安全触发的错误路径；
- usage、cost、response model 和 replay metadata；
- 图像直接/可恢复生成；
- 视频创建、轮询、远端取消和过期任务。

### 安全门禁

- 在线执行默认关闭；
- Provider、模型和操作必须显式指定；
- Provider allowlist、美元预算、图片数量和视频时长预算全部故障关闭；
- 使用专用测试账号和合成输入；
- 网络来源、并发和截止时间受限；
- 输出和日志经过脱敏；
- 在线执行器不得进入常规 test、build、install 或目录生成导入图。

### 完成标准

- 每个生产启用 Provider 有一条可重复的受控 smoke 路径；
- 验收结果记录 Provider、模型、协议、时间、状态和成本上限，不记录秘密或完整内容；
- 失败不会被离线门禁误报为通过；
- 上线前必须执行对应 Provider 的 smoke suite；
- Provider 协议发生重要升级时重新验收。

## 实施顺序

当前顺序以 P0 竖切为主，而不是先完成某个缺口的全部协议覆盖：

1. 声明生产 Provider profile，并完成 G05 基线 smoke；
2. 为该 profile 实现 G02；
3. 实现 G03 核心事件和 request context；
4. 完成该 profile 的 G05 闭环 smoke；
5. 进入 P1，依次完成 G01、G03 媒体事件和 G04 Bulkhead；
6. 只有出现运行证据时才进入 P2 Circuit Breaker。

每个切片都应通过公共接口测试，不应为了测试而扩大生产接口或暴露内部调度对象。生产 profile 之外的 Provider 继续依赖现有 fixture 和 manifest 门禁，直到它被实际启用。

## 与 Agent Core 的依赖关系

G01–G05 不阻塞 Agent Core 继续开发。当前模型句柄、文本流、工具协议、取消和 Runtime 生命周期已经足以支撑 Agent Loop。

Agent Core 不应等待期间复制这些缺口：

- 不在 Agent Core 中解析 Provider 私有协议字段；
- 不用 Agent 工具执行代替 Gateway 的最终 Structured Output 合约；
- 不在 Agent Core 中实现 Provider retry、Circuit Breaker 或认证；
- Agent 可以聚合一次 run 的 usage/cost，但单次模型请求的事实仍以 Gateway 事件和响应为准；
- Harness 可以决定跨 Provider fallback，但每次实际调用仍必须经过 `@duoduo/ai`。

## Gateway Host 条件性能力

以下能力只有在出现独立 Gateway Host、多个应用共享 Runtime，或需要中心化租户治理时才实施：

- OpenAI-compatible HTTP/SSE/WebSocket 入站接口；
- Virtual API Key 和租户认证；
- 跨实例限流、配额和美元预算；
- usage、cost 和审计日志持久化；
- 多 Key、区域和 Provider 负载均衡；
- 跨 Provider fallback、健康路由和价格/延迟/质量路由；
- 精确匹配或语义响应缓存；
- PII、内容过滤和业务 Guardrail；
- 多副本、共享状态、健康检查和多区域部署；
- 管理后台和配置热更新。

这些能力应复用 `@duoduo/ai` 的 Observer、usage、cost、错误和 Provider 接口，不得复制协议适配器。

## 保留架构决策：独立 NestJS Gateway Host

### 决策状态

本节是保留记录，不是实施授权。当前不创建 Gateway Host，不修改 Agent 的生产调用链，也不把 NestJS 依赖引入 `@duoduo/ai`。

拆分能够解决的问题、主要收益、引入的分布式系统成本和启用判据，见 [AI Gateway Host 拆分收益与启用判据](../ai-gateway-host-rationale.md)。

如果未来启用独立 Gateway Host，已确定的方向是：

- 新建独立的 `apps/ai-gateway`；
- 使用 NestJS 承载 HTTP/SSE、认证、租户、Virtual Key、配额、使用量、审计和路由控制面；
- `@duoduo/ai` 保持纯 TypeScript、框架无关，只负责 Gateway Runtime；
- `apps/server` 继续拥有业务、用户、权限和权威数据；
- `agent` 继续拥有 Agent Core、Harness、工具和工作流；
- Gateway Host 不复制 Provider adapter、认证协议或 Transport 实现。

选择独立 NestJS 应用而不是把 Gateway 模块放进 `apps/server`，是为了隔离业务 Server 与 AI 基础设施生命周期、凭证、扩缩容和故障域。NestJS 的收益来自未来控制面的模块、Guard、Interceptor、Pipe 和依赖注入，而不是用来实现模型协议或 Agent Loop。

### 当前明确不实施

- 不创建 `apps/ai-gateway` 目录或 workspace；
- 不新增 NestJS 依赖；
- 不增加 Gateway HTTP/SSE 路由；
- 不把 Agent 从本地 `@duoduo/ai` 切换到远程调用；
- 不移动 Provider 凭证或配置；
- 不实现 Virtual Key、配额、预算、账单、路由、fallback 或缓存；
- 不预先创建共享 contracts 包。

### 启用条件

满足以下任一真实需求后，重新进入设计流程：

- 出现第二个需要远程共享 AI Runtime 的应用；
- Provider 凭证必须从 Agent 进程集中迁出；
- 需要跨应用的 Virtual Key、租户配额、预算或 spend attribution；
- 需要中心化跨 Provider 路由、fallback 或健康治理；
- Agent 与其他消费者需要独立扩缩容或隔离故障域。

### 保留的协议决策

Gateway Host 的外部协议尚未选择。启用时必须重新比较并明确选择以下一种，不得从本记录推断默认方案：

- 项目原生强类型协议；
- OpenAI-compatible 协议；
- 原生事实协议加 OpenAI-compatible facade 的双协议。

协议选择必须在创建远程 Adapter 或共享 contract 前形成独立设计记录。

## 明确延期的能力

没有真实消费者前，不把以下能力计入当前 Gateway Runtime 完成条件：

- Embeddings 和向量化；
- Rerank；
- Speech-to-text、Text-to-speech 和独立 Audio generation；
- Realtime Voice；
- Moderation；
- Batch API；
- Fine-tuning 和 Files API；
- LLM-as-router 或 Semantic Router；
- Semantic Cache；
- Provider-hosted web search、file search、code interpreter 或 computer use 的统一抽象；
- Browser/Edge Runtime 兼容。

这些能力出现第二个真实消费者或明确产品需求后，再在对应 seam 增加模块或协议。

## 生产完成定义

只有同时满足以下条件，才能将当前声明范围标记为生产级 AI Gateway Runtime：

- G01–G05 全部完成；
- 正常、边界、失败、中止、竞态和脱敏路径均有确定性测试；
- 公共消费者、API inventory、Provider manifest 和离线目录保持一致；
- test、typecheck、build、lint、format、API、manifest、catalog 和 release 门禁通过；
- 实际启用 Provider 的受控 smoke suite 通过；
- Agent 仅使用公共导出，不深度导入实现；
- 当前 Agent 宿主和未来 Gateway Host 都能通过公共接口获得观测和可靠性证据；
- 文档中的 Provider、binding、导出和测试统计与机器检查结果一致。

`release:no-vendor` 继续作为候选发布门禁；真实在线验收必须独立运行，绝不能被普通离线测试隐式触发。

## 文档维护规则

- G01–G05 状态变化时，同步更新实施状态和本基线；
- P0/P1/P2 的进入条件变化时，同步更新 80/20 决策，不得把保留项默认升级为当前工作；
- Provider 或公共导出变化时，以 manifest/API 检查结果为事实来源；
- 旧审查记录可以保留历史问题证据，但不能继续作为当前完成度结论；
- 如果触发独立 Gateway Host，先完成新的协议与迁移设计，再创建 `apps/ai-gateway` 或实施 H01–H03；
- 不用 Provider 数量代替生产完成度，真实验收和运行时不变量才是最终证据。

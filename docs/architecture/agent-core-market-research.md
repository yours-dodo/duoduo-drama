# Agent Core 功能调研与生产架构方案

> 调研日期：2026-08-01
> 调研目标：从主流 Agent SDK / Runtime 的一手资料中提炼 Agent Core 应具备的功能，并形成适合 `duoduo-drama` 的 Harness、Agent 逻辑、上下文、记忆、知识与执行隔离架构。
> 目标读者：负责 Agent 服务设计、实现、评审和测试的内部工程师。
> 阅读结果：读者应能按本文边界拆分模块、定义端口、安排里程碑，并为生产基线编写验收测试。
> 样本：OpenAI Agents SDK、LangGraph、Google ADK、Microsoft Agent Framework、Claude Agent SDK、Vercel AI SDK，以及仓库已有的 Pi Agent 源码分析。

## 1. 结论先行

市场上成熟的 Agent 实现已经形成一组稳定的能力簇：

1. **可控的模型—工具循环**：调用模型、识别工具请求、执行工具、回填结果，直到模型给出最终输出或触发停止条件。
2. **类型化事件流**：不只流式输出文字，还要表达 Run、Turn、模型调用、工具调用、审批、错误和结束等生命周期。
3. **会话与运行状态分离**：会话记忆解决“聊过什么”，运行快照解决“执行到哪里”，两者不能混为一个消息数组。
4. **工具是完整执行管线**：包含参数验证、权限、审批、超时、取消、并发限制、错误归一化、结果截断和审计，而不是简单的 `execute(args)`。
5. **持久化的暂停/恢复**：人工审批、长时间任务、服务重启和故障恢复都要求 Run 能够序列化并从明确的边界继续。
6. **上下文治理**：模型可见消息只是应用状态的投影；成熟实现会提供裁剪、摘要/压缩、记忆检索、动态上下文和大产物引用。
7. **安全与人在回路**：工具可见性、允许/拒绝策略、字段级审批、输入/输出防护和敏感数据脱敏是生产能力，不是 UI 附加项。
8. **可观测与可评测**：每个 Run 需要有稳定 ID、用量、成本、时延、模型/工具 span 和隐私开关；Agent 逻辑需要可通过固定用例验证工具轨迹和最终结果。
9. **Agent 循环与 Workflow 分层**：开放式任务适合让模型决策；稳定业务流程应使用代码/图状 Workflow。Harness 应提供执行原语，但不应成为短剧业务流程引擎。
10. **记忆、知识与 Artifact 分层**：精炼记忆、完整会话档案、权威业务数据、RAG 证据、Wiki 派生知识和大文件产物不能合并成一个模糊的“知识库”。
11. **副作用需要独立账本**：checkpoint 只能恢复计算状态，不能保证外部工具 exactly-once；可变更工具需要幂等键、执行状态和不确定结果对账。
12. **多租户资源与故障隔离**：权限作用域之外，还要限制并发、队列、token、费用、时间、存储和沙箱资源，避免一个任务拖垮项目或租户。

因此，`duoduo-drama` 的 Agent Core 应当是：

```text
Agent 逻辑层（定义与策略）
  ↓ 使用
Harness 层（执行与生命周期）
  ↓ 使用
@duoduo/ai（模型、Provider 和统一流式协议）
```

短剧创作等业务 Workflow、Server 权威数据库和 HTTP 路由位于 Agent Core 之外；Agent 运行状态库、队列、搜索和沙箱属于 Harness Runtime Facilities，通过内部端口与 Execution Kernel 隔离。

架构取舍采用 **分层轻内核 + 可插拔能力端口**：Agent Core 由 Agent 逻辑层和完整 Harness 层组成；Harness 内只有 Execution Kernel 保持轻量，Context、Memory、Knowledge、Artifact Runtime、运行存储、搜索和沙箱作为独立能力模块或适配器存在。首版不让 LangGraph、Temporal、Mem0、专用向量库或知识图谱成为 Core 的状态真相。

上下文、记忆、LLM Wiki 与 RAG 的专项一手资料和论证保留在 [Agent Core 上下文、记忆与知识架构调研](./agent-core-context-memory-knowledge-research.md)，本文给出最终架构取舍和实施基线。

从产品定位看，这些样本可以粗略分为三类：

- **Agent Framework**：主要提供 Agent 定义和标准工具循环，如 OpenAI Agents SDK、Vercel AI SDK。
- **Agent Runtime**：主要解决 durable execution、checkpoint、stream 和 HITL，如 LangGraph。
- **完整 Harness**：在循环之上进一步提供计划、压缩、权限、文件/记忆和任务跟踪，如 Claude Agent SDK 与 Microsoft Agent Framework Harness。

Microsoft 已经明确把产品概念分为 Agent、Harness 和 Workflow；LangGraph 也强调 Runtime 不替上层决定 prompt 或 Agent architecture。参见 [Microsoft Agent Framework Overview](https://learn.microsoft.com/en-us/agent-framework/overview/)、[Agent Harnesses](https://learn.microsoft.com/en-us/agent-framework/agents/harness) 与 [LangGraph Overview](https://docs.langchain.com/oss/javascript/langgraph/overview)。

## 2. 主流实现的代表性设计

### 2.1 OpenAI Agents SDK

OpenAI 的 Runner 显式实现模型—工具—handoff 循环，支持 `maxTurns`、`AbortSignal`、流式事件、每次模型调用前输入过滤、工具并发限制和稳定错误类型。参见 [Running Agents](https://openai.github.io/openai-agents-js/guides/running-agents/)。

它把会话历史放在可替换的 Session 中，并通过可序列化 `RunState` 支持审批后恢复；长历史可使用 compaction session 压缩。参见 [Sessions](https://openai.github.io/openai-agents-js/guides/sessions/) 与 [Human-in-the-loop](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)。

它将防护分为 Agent 输入、Agent 输出和工具输入/输出多个边界，并默认记录 Agent、Generation、Tool、Guardrail 和 Handoff span。参见 [Guardrails](https://openai.github.io/openai-agents-js/guides/guardrails/) 与 [Tracing](https://openai.github.io/openai-agents-js/guides/tracing/)。

多 Agent 既可以“Agent as tool”保持主 Agent 控制权，也可以 handoff 转移会话控制权；官方同时强调确定性流程可由代码编排。参见 [Agent Orchestration](https://openai.github.io/openai-agents-js/guides/multi-agent/)。

### 2.2 LangGraph

LangGraph 的核心差异点是“持久执行的状态图”。它在每个 super-step 后生成 checkpoint，以 thread 组织历史，直接支持人在回路、故障恢复、历史回放、任意 checkpoint 分叉和跨 thread 长期记忆。参见 [Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)。

`interrupt()` 可在图节点内动态暂停，保存状态后等待外部输入。恢复时会从节点开头重新执行，因此副作用必须是幂等的。参见 [Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)。

它的事件流可同时投影模型消息、状态快照、子图、interrupt 和最终输出，不会因一个消费者读取而破坏其他消费者的视图。参见 [Event streaming](https://docs.langchain.com/oss/javascript/langgraph/event-streaming)。

### 2.3 Google Agent Development Kit

Google ADK 把 Runtime 建模为 Event Loop：Runner 协调 Agent、Tool、Callback 等执行逻辑，消费并持久化 Event。参见官方文档源码 [Runtime](https://github.com/google/adk-docs/blob/main/docs/runtime/index.md) 与 [Events](https://github.com/google/adk-docs/blob/main/docs/events/index.md)。

官方的 resume 设计会根据 invocation 事件历史恢复 Sequential、Loop 和 Parallel Agent；已提交的 tool result 可以避免无条件重算，但工具副作用仍可能呈现 at-least-once 语义。取消信号可传递到 Runner、模型、工具、MCP 和子 Agent，已提交的 Event 会保留。参见 [Resume](https://adk.dev/runtime/resume/) 与 [Cancellation](https://adk.dev/runtime/cancel/)。这进一步说明：checkpoint 不能替代工具幂等性。

它明确分离 Session、Session State、跨会话 Memory 与大对象 Artifact，各自有 Service 端口和内存/持久化实现。参见 [Sessions](https://github.com/google/adk-docs/blob/main/docs/sessions/index.md) 与 [Artifacts](https://github.com/google/adk-docs/blob/main/docs/artifacts/index.md)。

ADK 区分 Agent 级 Callback 与 Runner 级 Plugin：前者定制单个 Agent，后者对 Runner 内的所有 Agent、模型和工具实施全局策略。参见 [Callbacks](https://github.com/google/adk-docs/blob/main/docs/callbacks/index.md) 与 [Plugins](https://github.com/google/adk-docs/blob/main/docs/plugins/index.md)。

评测同时关注最终回复和工具调用轨迹，而不是只比较文本。参见 [Evaluation](https://github.com/google/adk-docs/blob/main/docs/evaluate/index.md)。

### 2.4 Microsoft Agent Framework

Microsoft 把 Agent pipeline 分为 Agent middleware、Context Provider 和 Chat Client 三个主层次；工具自动调用循环和 function middleware 位于 Chat Client pipeline。参见 [Agent Pipeline Architecture](https://learn.microsoft.com/en-us/agent-framework/agents/agent-pipeline)。

Microsoft 还给出了相当明确的 Harness 功能定义：驱动模型/工具循环、管理历史和上下文、在行动前应用审批与安全策略，并推动任务走向完成。官方默认组合包含迭代上限、每次模型调用后持久化历史、context compaction、persistent todo、plan/execute/custom mode、file memory、审批规则、OpenTelemetry，以及可选的 skills、background agents 和 shell。参见 [Agent Harnesses](https://learn.microsoft.com/en-us/agent-framework/agents/harness)。

中间件可以分别拦截整个 Agent run、工具调用或单次模型调用，用于 guardrail、重试、脱敏、日志、限流和运行时上下文。参见 [Adding Middleware](https://learn.microsoft.com/en-us/agent-framework/journey/adding-middleware)。

Workflow 使用有明确边界的 super-step 执行，可在边界生成包含执行器状态、待处理消息、待响应请求和共享状态的 checkpoint。参见 [Workflow Builder & Execution](https://learn.microsoft.com/en-us/agent-framework/workflows/workflows) 与 [Checkpoints](https://learn.microsoft.com/en-us/agent-framework/user-guide/workflows/checkpoints)。

该框架原生输出 OpenTelemetry 追踪、日志和指标，并默认不在 telemetry 中收集敏感输入/输出。参见 [Workflow Observability](https://learn.microsoft.com/en-us/agent-framework/workflows/observability)。

### 2.5 Claude Agent SDK

Claude Agent SDK 将 Claude Code 同类的工具循环、上下文管理和权限系统暴露给应用。它的特色是较完整的工具权限求值链：Hook、deny 规则、权限模式、allow 规则、运行时审批回调。参见 [Permissions](https://code.claude.com/docs/en/agent-sdk/permissions)。

Hook 覆盖工具执行前后、工具失败、提示词提交、停止、压缩、子 Agent 生命周期和审批请求，可以拒绝、修改或注入上下文。参见 [Hooks](https://code.claude.com/docs/en/agent-sdk/hooks)。

Session 支持继续、按 ID 恢复和 fork，也可以通过 SessionStore 适配到外部持久化；子 Agent 使用隔离的上下文并只向父 Agent 返回最终结果。参见 [Sessions](https://code.claude.com/docs/en/agent-sdk/sessions)、[External session storage](https://code.claude.com/docs/en/agent-sdk/session-storage) 与 [Subagents](https://code.claude.com/docs/en/agent-sdk/subagents)。

### 2.6 Vercel AI SDK

Vercel AI SDK 的 `ToolLoopAgent` 是较轻的 TypeScript Agent 循环实现。`stopWhen` 控制停止，`prepareStep` 在每步前动态调整模型、工具和消息，默认存在步数上限。参见 [Loop Control](https://ai-sdk.dev/docs/agents/loop-control)。

工具提供 schema 验证、动态加载、错误回填和 `needsApproval` 审批协议；审批请求作为结果返回，由调用方补入审批结果后再次调用。参见 [Tools and Tool Calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)。

它支持 OpenTelemetry 形式的模型和工具 span，但更完整的持久化会话、checkpoint 和长期记忆通常由应用或外部记忆 Provider 实现。参见 [Telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry) 与 [Agent Memory](https://ai-sdk.dev/docs/agents/memory)。

### 2.7 Pi Agent

仓库已有的 [Pi Agent 技术架构拆解](./pi-agent-architecture.md) 识别了 Loop、内存 Agent 和持久化 Harness 三层。其最有参考价值的能力包括：

- 模型可见 Message 与应用 AgentMessage 分离；
- awaited event sink 既是事件通道，也是持久化屏障；
- turn snapshot 保证配置只在轮次边界生效；
- 工具 prepare / execute / post-process / publish 分阶段；
- steering、follow-up 和 next-turn 队列具有不同语义；
- append-only 会话树、分支导航与上下文压缩。

## 3. Agent Core 功能清单

优先级定义：

- **P0：最小执行内核**，没有它就不是可用的 Agent Runtime。
- **P1：生产基线**，在接入真实业务数据和长时间任务前完成。
- **P2：增强能力**，按产品需求和实际复杂度引入。

### 3.1 Harness 层

| 功能域   | 功能点                                            | 优先级 | 边界说明                                                           |
| -------- | ------------------------------------------------- | ------ | ------------------------------------------------------------------ |
| 运行模型 | 稳定的 `runId` / `turnId` / `toolCallId` 和状态机 | P0     | 区分 queued、running、waiting、completed、failed、cancelled        |
| 运行模型 | 模型—工具多轮循环                                 | P0     | 只通过 `@duoduo/ai` 公开契约调用模型                               |
| 运行模型 | 同步结果与流式结果一致                            | P0     | 两种 API 共用同一执行内核                                          |
| 运行模型 | 停止条件与预算                                    | P0     | 最大 turn、截止时间、token/费用预算、显式 terminate                |
| 运行模型 | 取消和 deadline 传播                              | P0     | 同一 `AbortSignal` 传到模型、工具、Hook 和适配器                   |
| 运行模型 | Turn snapshot                                     | P1     | 每轮固化模型、指令、工具和策略，配置变更在边界生效                 |
| 事件     | 类型化生命周期事件                                | P0     | run/turn/model/message/tool/approval/error/end                     |
| 事件     | 全序 `sequence`、时间和关联 ID                    | P0     | 支持 UI 排序、审计和重放                                           |
| 事件     | 可等待的事件 sink / 持久化屏障                    | P1     | 重要事件落盘后才继续，避免 UI 看到不可恢复的幽灵状态               |
| 事件     | 可重连事件流                                      | P1     | 以 `runId + sequence/cursor` 继续获取，而不是仅依赖活着的 SSE 连接 |
| 工具     | 统一 Tool 契约与 registry                         | P0     | 名称、描述、JSON Schema、执行函数、元数据                          |
| 工具     | JSON 解析、schema 验证和未知工具处理              | P0     | 默认将可预期错误作为可见 tool result 返回模型                      |
| 工具     | prepare / execute / post-process / publish 分阶段 | P1     | 让兼容、权限、结果脱敏和审计可独立扩展                             |
| 工具     | 超时、取消和并发上限                              | P1     | 区分模型的 parallel tool-call 能力与本地真实执行并发度             |
| 工具     | 工具增量更新                                      | P1     | 向 UI 报告长任务进展，不把中间输出都喂给模型                       |
| 工具     | 结果归一化、截断与 Artifact 引用                  | P1     | 大文件/媒体不直接塞入 transcript                                   |
| 工具     | 幂等键与副作用级别                                | P1     | 恢复、重试和重放不得重复执行不可逆操作                             |
| 工具     | 动态工具可见性                                    | P1     | 不同用户、项目阶段和权限看到不同工具                               |
| 安全     | 运行级 AuthorizationContext                       | P1     | 工具执行必须获得显式的用户/项目/作用域，不从 prompt 推断权限       |
| 安全     | allow / deny / require-approval 决策              | P1     | 决策基于工具、参数、身份和业务状态                                 |
| 安全     | 持久化审批与恢复                                  | P1     | 暂停时不占用进程，审批结果可审计                                   |
| 安全     | 输入/输出/工具 Guardrail 扩展点                   | P1     | 机制属于 Harness，业务规则属于 Agent 逻辑层                        |
| 安全     | 敏感数据和日志脱敏                                | P1     | 原始 prompt、工具输入/输出不默认进入 trace                         |
| 状态     | Transcript 与模型上下文投影分离                   | P0     | 应用事件、UI 消息、摘要和模型 Message 可使用不同类型               |
| 状态     | Session / Transcript 持久化端口                   | P1     | 内存实现用于测试，数据库实现属于 Harness 持久化适配器              |
| 状态     | Run checkpoint / resume 端口                      | P1     | 保存当前 Agent、待执行动作、审批和快照版本                         |
| 上下文   | 集中式 ContextAssembler                           | P1     | Provider 只提交候选项，不能直接改写最终模型消息                    |
| 上下文   | ContextManifest 与不可变 Turn 快照                | P1     | 记录来源、版本、token、排序和省略原因，不默认复制敏感正文          |
| 上下文   | 裁剪、压缩与 Artifact 投影                        | P1     | 保护指令、当前输入和未闭合工具对，大对象只投影引用                 |
| 记忆     | Task working memory 与 Session archive            | P1     | 前者服务执行，后者保存完整对话；两者不相互代替                     |
| 记忆     | 用户/项目精炼记忆与候选写入                       | P2     | 有 scope、来源、TTL、敏感度、冲突检查和审批                        |
| 知识     | Knowledge/Retriever 端口与 EvidencePack           | P1     | 精确查询、全文、向量和引用使用统一可替换契约                       |
| 知识     | Wiki revision 与来源依赖                          | P2     | Wiki 是可审查派生层，Raw Source 和 Server 数据才是证据             |
| Artifact | ArtifactRef 与版本化存储端口                      | P1     | 文件、媒体和大型工具输出独立存储并在解引用时重新鉴权               |
| 可靠性   | ToolExecutionLedger 与幂等语义                    | P1     | 审批、执行、终态和 unknown 都有稳定状态                            |
| 资源     | 分层配额、准入和背压                              | P1     | Tenant 到 ToolExecution 的并发、费用、时间和存储限制               |
| 状态     | 分支、回放和 time travel                          | P2     | 对交互式创作、对比方案和调试有价值                                 |
| 扩展     | 分阶段 Hook / middleware                          | P1     | run、turn、model、tool、message、compact、error 前后               |
| 扩展     | Agent 级与全局扩展分离                            | P1     | 局部 Agent 策略不与日志、审计、限流等全局关注点混合                |
| 扩展     | Hook 排序、短路、失败和重入语义                   | P1     | 契约必须明确，否则扩展组合后不可预测                               |
| 可观测   | Trace / span / log / metric 端口                  | P1     | run、model、tool、approval、checkpoint 具有因果链                  |
| 可观测   | token、成本、时延和停止原因                       | P1     | 能按 Agent、模型、用户和任务聚合                                   |
| 测试     | 确定性假模型、假工具和虚拟时钟                    | P0     | 默认测试不访问真实 Provider，不产生付费调用                        |
| 测试     | 事件序列、恢复和幂等性契约测试                    | P1     | 测试稳定协议，不只测最终文本                                       |

### 3.2 Agent 逻辑层

| 功能域     | 功能点                             | 优先级 | 边界说明                                                     |
| ---------- | ---------------------------------- | ------ | ------------------------------------------------------------ |
| Agent 定义 | 稳定 ID、名称、描述和版本          | P0     | ID 用于持久化恢复，不以展示名作唯一标识                      |
| Agent 定义 | 系统指令与提示词组装               | P0     | 支持静态指令和基于运行上下文的动态组装                       |
| Agent 定义 | 模型、采样参数和思考策略           | P0     | 只表达应用策略，Provider 协议仍属于 `@duoduo/ai`             |
| Agent 定义 | 可用工具与 tool-choice 策略        | P0     | 支持基于上下文的动态工具集，避免每轮暴露所有工具             |
| Agent 定义 | 结构化最终输出                     | P1     | JSON Schema 验证失败要有重试/失败语义，不用手写文本解析      |
| 上下文     | RunContext 动态注入                | P0     | 用户、项目、任务、locale、能力和授权信息与消息历史分离       |
| 上下文     | 模型输入投影策略                   | P1     | 选择模型真正可见的历史、记忆、产物和工具                     |
| 上下文     | ContextPolicy 与来源优先级         | P1     | 定义本 Agent 可读取的消息、权威数据、记忆、知识和 Artifact   |
| 记忆       | MemoryPolicy 与候选写入策略        | P2     | Agent 提议何时检索和写入，Core 执行作用域、安全和审批检查    |
| 知识       | KnowledgePolicy 与引用要求         | P1     | 决定精确查询/RAG/Wiki 使用条件、证据阈值和回答引用要求       |
| 资源       | Model fallback 与质量降级策略      | P1     | 业务决定何时换模型或降级；Provider 传输重试留在 `@duoduo/ai` |
| 行为       | 完成判定和停止策略                 | P0     | 文本输出、结构化输出、指定工具结果或业务目标可终止 Run       |
| 行为       | 工具审批与 Guardrail 业务策略      | P1     | 例如“发布前必须人工确认”，规则属于业务 Agent                 |
| 行为       | 错误恢复策略                       | P1     | 决定哪些错误重试、换模型、回填给模型或上报用户               |
| 编排       | Agent as tool                      | P2     | 主 Agent 保持对话控制，子 Agent 执行有界子任务               |
| 编排       | Handoff                            | P2     | 将后续会话控制交给专业 Agent，需要明确历史过滤和权限传递     |
| 编排       | 子 Agent 上下文隔离与并发          | P2     | 隔离中间轨迹，限制工具、成本和并发度                         |
| 资源       | Prompt Template / Skill 发现与版本 | P2     | 需要明确加载时机、引用资源和可用工具                         |
| 互操作     | MCP 工具适配                       | P2     | MCP 是工具/上下文协议，不应改变 Agent Core 内部 Tool 契约    |
| 评测       | 可重现 Agent 定义与 eval 元数据    | P1     | 保存 Agent/prompt/toolset 版本，便于比较轨迹和回归           |

## 4. 责任归属与边界

“分层轻内核”只约束 Harness 内部的依赖方向，不改变已经确认的产品分层。Provider、业务真相、客户端和 Harness 运行能力的归属如下：

| 能力                                                | 归属                       | 边界规则                                                                     |
| --------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------- |
| Provider HTTP 协议、认证、流式协议和传输级重试      | `@duoduo/ai` package       | Harness 只消费公开的 provider-neutral runtime，不复制 wire protocol          |
| 应用级模型选择、Prompt、工具和完成策略              | Agent 逻辑层               | 解析“本次运行什么”，不处理 Provider 网络协议                                 |
| Session、Task、Run、Turn、长时间任务和恢复          | Harness                    | 是 Agent 执行生命周期，不属于业务服务的领域状态机                            |
| Context、Memory、Knowledge/RAG/Wiki 检索            | Harness 能力模块           | 为 Execution Kernel 提供上下文与证据，内部通过稳定端口组合                   |
| Agent 运行数据库、队列、全文/向量索引、对象存储适配 | Harness Runtime Facilities | 属于 Harness 的持久化与检索实现，不进入 Execution Kernel                     |
| 容器、gVisor、浏览器等沙箱运行时                    | Harness Execution Facility | Harness 决定风险、资源、审批和执行方式，具体驱动放在内部适配器               |
| 用户、租户、项目权限和业务对象真相                  | Server 业务服务            | Server 计算并下发 `AuthorizationContext`；Harness 只强制执行，不复制业务规则 |
| 剧本、分镜、角色、素材等 Artifact 业务语义          | Server 业务服务            | 业务层定义归属、状态、版本关系和操作权限                                     |
| Artifact 运行引用、工具产物和上下文投影             | Harness Artifact Runtime   | 管理 `ArtifactRef`、执行血缘、大结果外置和模型可见投影                       |
| 短剧创作、审核、发布等确定性流程                    | 业务 Workflow              | 调用 Agent Task，不写入开放式模型—工具循环                                   |
| Web、移动端、通知和面向产品的后台 Worker            | 业务服务/应用层            | 通过任务、事件和审批协议使用 Agent Core                                      |
| Hono HTTP/SSE/WebSocket 路由                        | Agent 应用层               | 负责校验、调用和协议映射，不承载 Harness 状态机                              |

因此，Harness 可以拥有搜索、存储和沙箱，但 Execution Kernel 不能直接写 SQL、拼向量查询或启动容器。它只能依赖 Harness 内部能力端口。

## 5. 建议的分层契约

### 5.1 Harness 只回答“怎么运行”

Harness 可以接收一个完整的 Agent 运行快照，但不应理解“故事”、“分镜”或“发布”等业务语义。它的输入应近似：

```ts
interface AgentRunSnapshot {
  agentId: string;
  agentVersion: string;
  model: ResolvedModelPolicy;
  instructions: string;
  tools: AgentTool[];
  taskInput: AgentInput;
  contextPolicy: ResolvedContextPolicy;
  memoryPolicy: ResolvedMemoryPolicy;
  knowledgePolicy: ResolvedKnowledgePolicy;
  versions: RunVersionRefs;
  output?: OutputContract;
  limits: RunLimits;
  authorization: AuthorizationContext;
}
```

输出应由结果和事件流共同构成：

```ts
interface AgentRunHandle {
  readonly runId: string;
  readonly events: AsyncIterable<AgentEvent>;
  result(): Promise<AgentRunResult>;
  cancel(reason?: string): void;
}
```

持久化不应直接绑定某数据库：

```ts
interface AgentScope {
  tenantId: string;
  projectId: string;
  sessionId?: string;
  taskId?: string;
  runId?: string;
}

interface TranscriptStore {
  load(scope: AgentScope & { sessionId: string }): Promise<SessionTranscript>;
  append(
    scope: AgentScope & { sessionId: string },
    expectedVersion: number,
    entries: readonly AgentMessage[],
  ): Promise<SessionTranscript>;
}

interface TaskStore {
  load(scope: AgentScope & { taskId: string }): Promise<AgentTask | undefined>;
  transition(
    scope: AgentScope & { taskId: string },
    expectedVersion: number,
    transition: TaskTransition,
  ): Promise<AgentTask>;
}

interface CheckpointStore {
  save(
    scope: AgentScope & { taskId: string; runId: string },
    checkpoint: RunCheckpoint,
  ): Promise<void>;
  load(
    scope: AgentScope & { taskId: string; runId: string },
  ): Promise<RunCheckpoint | undefined>;
}
```

状态投影、checkpoint、event 和 outbox 不能由调用方依次写入。持久化适配器还必须暴露原子提交边界：

```ts
interface DurableCommitStore {
  commit(
    scope: AgentScope & { taskId: string; runId: string },
    expectedVersion: number,
    commit: DurableRunCommit,
  ): Promise<CommitReceipt>;
}
```

### 5.2 上下文、记忆、知识与 Artifact 使用独立端口

这些能力属于 Agent Core 架构，但不属于模型—工具循环本身。端口应围绕作用域、版本和引用设计：

```ts
interface ContextSource {
  collect(request: ContextRequest): Promise<readonly ContextCandidate[]>;
}

interface ContextAssembler {
  assemble(
    request: ContextRequest,
    candidates: readonly ContextCandidate[],
  ): Promise<{
    snapshot: TurnContextSnapshot;
    manifest: ContextManifest;
  }>;
}

interface MemoryRepository {
  search(query: MemoryQuery): Promise<readonly MemoryRecord[]>;
  saveCandidate(candidate: MemoryCandidate): Promise<void>;
  publish(
    candidateId: string,
    decision: MemoryWriteDecision,
  ): Promise<MemoryRecord>;
}

interface KnowledgeRetriever {
  retrieve(query: KnowledgeQuery): Promise<EvidencePack>;
}

interface ArtifactStore {
  put(request: ArtifactWriteRequest): Promise<ArtifactRef>;
  stat(scope: AgentScope, ref: ArtifactRef): Promise<ArtifactMetadata>;
  open(scope: AgentScope, ref: ArtifactRef): Promise<ArtifactContent>;
}

interface IsolatedExecutor {
  execute(request: SandboxedExecutionRequest): Promise<ToolExecutionResult>;
}
```

所有读写都必须携带完整 scope。Core 中的引用不保存数据库行、对象存储 URL 或向量库特有 ID；Harness 内部适配器负责将稳定引用映射到具体运行设施。

### 5.3 Agent 逻辑层只回答“运行什么”

Agent 逻辑层负责将运行时上下文解析为 Harness 快照：

```ts
interface AgentDefinition<TContext, TOutput> {
  id: string;
  version: string;
  resolve(context: TContext): Promise<AgentRunSnapshot>;
  parseResult(result: AgentRunResult): Promise<TOutput>;
}
```

具体的提示词组装、工具集、输出 schema、审批规则、记忆策略和多 Agent 编排都应在这一层。

## 6. Session、Task、Run、Turn 四级隔离模型

Session、Task、Run 和 Turn 必须是独立建模、独立寻址的一等作用域，不能只作为日志字段，也不能全部塞进同一个消息数组。

### 6.1 关系模型

```text
Tenant
└── Project
    ├── Session 1
    │   └── Messages / Branches / Summary
    ├── Session 2
    └── Task
        ├── originSessionId?       // 仅表示来源，不表示生命周期从属
        └── Run 1..N
            └── Turn 1..N
                ├── ModelCall
                └── ToolCall 0..N
```

Project 同时拥有 Session 和 Task。Session 可以发起 Task，但 Task 不从属于 Session；Task 启动后能够在原对话归档、客户端断线或服务重启后继续运行。

进入 Harness 的每次 Agent 执行都应属于一个 Task。普通对话回复可以是短时的 `interactive` Task，长时间作业可以是 `background` 或 `workflow` Task；任务中心是否展示已完成的短任务属于产品投影，不改变 Core 统一语义。

### 6.2 Session：对话隔离

Session 管理“聊过什么”，拥有：

- 独立 transcript、消息顺序和乐观版本；
- 对话分支、当前 leaf 和压缩摘要；
- 对话附件和已确认产物的引用；
- 从 Task 投影回来的结果摘要、产物引用和待用户操作提示。

Session 不保存 Task checkpoint、工具内部轨迹或 Workflow 执行状态。不同 Session 的 transcript 默认互不可见；共享项目数据必须通过 Project Context 显式注入，不得隐式合并其他 Session 的消息。

### 6.3 Task：目标与持久进度隔离

Task 管理“事情做到哪里”，至少拥有：

- 稳定 `taskId`、任务类型、目标和结构化输入快照；
- `tenantId` / `projectId` 以及可选 `originSessionId`；
- `queued` / `running` / `waiting_for_input` / `waiting_for_approval` / `completed` / `failed` / `cancelled` 状态机；
- 当前活动 Run、Workflow 位置、待审批项、任务预算和产物引用；
- 与 Server-owned 业务对象对应的 ID/version，而不是业务数据权威副本。

同一 Task 默认只允许一个 active root Run。并行子 Agent 使用 child Run 建模，不通过同时创建多个互相竞争的 root Run 实现。

### 6.4 Run：一次执行尝试隔离

Run 管理“这次如何执行”，拥有：

- 稳定 `runId` 和父 `taskId`；
- 解析后的 Agent、prompt、toolset、model policy、Memory、Wiki、索引和权威业务数据版本；
- Run 级 token、费用、时间和 turn 预算；
- 事件流、单调 `sequence`、trace 和 checkpoint；
- 当前 Turn、未解决审批、待执行工具和终止原因。

暂停/恢复继续原 Run；用新模型、新 Agent 版本或“从头再试”时必须创建新 Run，保留旧 Run 作为审计证据。

### 6.5 Turn：单轮决策与提交隔离

Turn 管理“这一轮发生了什么”，边界为：

```text
prepare snapshot
  → model call
  → zero or more tool calls
  → append tool results
  → commit events/checkpoint
  → next turn or terminal result
```

每个 Turn 必须具有 `turnId` 或在 Run 内唯一的单调 `turnIndex`。Turn 开始时固化模型、指令、工具可见性、权限和上下文投影；运行中的配置变更只能从下一 Turn 生效。

Turn 是最小逻辑隔离边界，但不是唯一持久化边界。用户输入、模型响应、每个工具结果、审批中断和终态都应形成独立耐久提交点。工具副作用仍需要幂等键和独立执行记录，不得假设恢复必然 exactly-once。

### 6.6 四级隔离的强制约束

1. **作用域完整**：任何存储查询不得只接收裸 `sessionId` / `taskId` / `runId`，必须同时携带租户和项目作用域。
2. **无隐式上下文共享**：Task 启动时保存明确的 context snapshot/reference，不在后台执行时自动吸收 Session 的新消息。
3. **无隐式权限继承**：Run 启动和每次恢复时都重新校验 AuthorizationContext；子 Run 默认降权，不复制父 Run 的全部工具。
4. **并发受控**：Session transcript 使用乐观版本追加；Task 限制 active root Run；Run 内同一时刻只有一个活动 root Turn。
5. **取消边界明确**：归档 Session 不取消 Task；取消 Task 会向当前 Run 传播；取消 Run 会向当前 Turn、模型和工具传播。
6. **记录不相互代替**：Session 只写入面向用户的任务摘要；Task/Run 保存执行轨迹和 checkpoint；可观测系统保存 trace，三者不复制对方的完整数据。
7. **恢复检查版本**：checkpoint 必须记录 Task schema、AgentDefinition、prompt、toolset 和 Harness 协议版本，不兼容时显式失败或进行受控迁移。
8. **事件可定位**：每个执行事件至少包含 `projectId` / `taskId` / `runId` / `sequence`，Turn 内事件额外包含 `turnId` 或 `turnIndex`。
9. **Run 版本冻结**：同一 Run 恢复时复用原有 Agent、prompt、toolset、Memory、Wiki、索引和业务数据版本；吸收新版本必须创建新 Run。
10. **引用重新鉴权**：Memory、Knowledge 和 Artifact 即使已经进入 Task，也必须在检索或解引用时重新检查当前作用域和授权。

## 7. 生产级能力架构与取舍

### 7.1 总体方案

| 方案                          | 做法                                                                                                           | 优点                     | 主要问题                                                                  | 决策           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------- | -------------- |
| 大一体式 Execution Kernel     | 在模型—工具循环中直接实现 Context、Memory、RAG、SQL、向量查询和沙箱驱动                                        | 初期调用方便             | 执行状态机与所有设施耦合，难测试、恢复和替换                              | 不采用         |
| 外部平台作为主 Runtime        | 直接让 LangGraph/Temporal、外部 Memory 或搜索平台定义状态                                                      | 能快速获得现成功能       | Session/Run/Checkpoint 和版本语义受外部产品控制，容易重复建模和供应商锁定 | 仅保留 Adapter |
| 分层轻内核 + Harness 能力模块 | Execution Kernel 只定义生命周期和调用顺序；存储、检索、记忆、Artifact 和沙箱仍归 Harness，但通过模块和端口接入 | 职责归属清楚，可渐进演进 | 前期需要严格设计契约                                                      | **采用**       |

采用后的职责关系为：

```text
Server Business Service
  ├── Tenant / Project / Authorization truth
  ├── Domain objects and Artifact business semantics
  └── Web / Mobile / product workers
        ↓ TaskInput / AuthorizationContext / ArtifactRef
Agent Logic Layer
  └── AgentDefinition / Prompt / Tools / Context-Memory-Knowledge Policies
        ↓
Harness Layer
  ├── Execution Kernel
  │   ├── Session / Task / Run / Turn
  │   ├── Model–Tool Loop / Event / Checkpoint
  │   └── Approval / Cancel / Budget / ToolExecutionLedger
  ├── Capability Modules
  │   ├── Context / Memory / Knowledge-RAG-Wiki
  │   └── Artifact Runtime / Observability / Resource Governance
  └── Runtime Facilities
      ├── Runtime State Store / Queue / Object Storage Adapter
      ├── Full-text / Vector Search Adapter
      └── Sandbox / Optional External Memory Adapter
        ↓
@duoduo/ai
  └── Provider / Model / Stream / Transport
```

这里的“轻内核”专指 Harness 的 Execution Kernel，而不是整个 Harness 功能少。Harness 仍拥有任务执行、知识检索、运行存储和沙箱；区别在于这些能力被拆成独立模块，Execution Kernel 只依赖稳定端口。更换搜索、存储或沙箱驱动时，Run 状态机和已经持久化的 Task、审批、记忆来源及引用语义不能随之改变。

### 7.2 上下文管理

Transcript、Memory 和检索结果都只是上下文来源，不能自行拼接模型消息。统一 `ContextAssembler` 应执行：

```text
ContextSource candidates
  → scope authorization and trust classification
  → normalization / deduplication
  → priority and token allocation
  → compaction / artifact projection
  → model message projection
  → immutable TurnContextSnapshot + ContextManifest
```

装配优先级为：

1. 安全策略、系统指令和程序性知识；
2. Task 目标、当前输入、待处理审批和未闭合工具对；
3. Server 提供的权威项目数据及版本；
4. 最近 Session 消息和有版本的 Session 摘要；
5. Task working memory；
6. 有界的用户/项目精炼记忆；
7. 按需召回的 Session 档案、Wiki 和 Raw Source；
8. 示例和低优先级补充信息。

预算采用“关键类别最小保留量 + 弹性共享池”，不为来源写死百分比。工具定义同样消耗 token，必须参与预算和动态裁剪。Anthropic 的上下文工程实践也建议保留最少的高信号 token，并结合预取、即时检索、渐进披露、压缩和结构化笔记。[Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

每个 Turn 持久化不可变 `TurnContextSnapshot` 和 `ContextManifest`。Manifest 记录来源引用、作用域、版本、token 成本、排序、压缩链路及省略原因，默认不重复保存敏感正文。Run 恢复复用原快照；上下文来源版本变化只能影响新 Run。

### 7.3 Hermes 风格的分层记忆

Hermes 的可取之处不是 Markdown 文件格式，而是“小型精炼记忆、完整 Session 档案、冻结注入快照、受控写入和外部 Provider 故障隔离”。[Persistent Memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/) [Memory Providers](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory-providers/)

| 记忆层                   | 内容                           | 默认生命周期与可见范围         |
| ------------------------ | ------------------------------ | ------------------------------ |
| Turn working memory      | 当前推理和临时工具结果         | 当前 Turn                      |
| Run working memory       | 计划、待办、中间状态和恢复信息 | 当前 Run                       |
| Task memory              | 任务事实、决策和产物索引       | 当前 Task                      |
| Session archive          | 完整对话、分支和摘要           | 当前 Session，按需检索         |
| Curated user memory      | 稳定偏好、身份事实和长期约束   | 当前用户，跨 Task              |
| Curated project memory   | 项目术语、规范和长期决策       | 当前 Project                   |
| Optional semantic memory | 外部 Provider 的补充召回       | 显式授权范围，非权威           |
| Procedural knowledge     | AgentDefinition、Prompt、Skill | 由发布版本控制，不写入事实记忆 |

长期记忆必须先形成 `MemoryCandidate`，至少包含：

```ts
interface MemoryCandidate {
  scope: MemoryScope;
  content: MemoryContent;
  provenance: readonly SourceRef[];
  confidence: number;
  sensitivity: Sensitivity;
  ttl?: string;
  supersedes?: readonly string[];
  status: 'proposed' | 'approved' | 'rejected' | 'expired';
}
```

写入管线必须检查来源、作用域、提示注入、秘密、重复、冲突、TTL 和审批。模型只能提出候选，不能直接覆写长期事实。子 Agent、压缩任务和定时任务默认无权写 User/Project memory；首版不实现无监督的全局 Agent 学习。

可见性采用稳定规则：Task memory 可以在下一 Turn 生效；User/Project memory 对当前 Run 使用冻结视图，在下一 Run 生效。用户明确要求“记住”时可以立即持久化，但不得悄悄改变当前 Run 的输入语义。

### 7.4 Knowledge、Hybrid RAG 与 LLM Wiki

知识平面采用四层模型：

```text
Immutable Raw Source / Server authoritative data
  → Extracted document and chunks
  → Reviewed Wiki pages and fact proposals
  → Rebuildable full-text / vector / relation indexes
```

Raw Source 和 Server 权威对象是证据；索引是可重建派生数据；Wiki 是可审查的综合视图，不是真相源。Karpathy 的 LLM Wiki 设计中，Raw Sources、互链 Wiki 和 schema/ingest/query/lint 同样相互分离。[LLM Wiki original design](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)

多租户服务不为每个项目维护可写 Git 仓库。Wiki 正文保持 Markdown 和可导出性，数据库管理 `sourceRefs`、hash、revision、依赖、ACL、审批和 stale 状态。新来源生成 `WikiChangeProposal`；经过引用检查、矛盾/重复检查、lint 和必要审批后发布。来源改变时通过依赖关系标记下游页面过期。

检索顺序为：

1. 明确 ID、结构化字段和业务对象优先请求 Server 精确查询；
2. 文档语义查询执行强制 Tenant/Project/Corpus 过滤；
3. BM25/全文和向量并行召回；
4. 使用 RRF 融合、去重和证据多样性选择；
5. 仅对复杂或高价值查询启用 reranker；
6. 输出带来源和版本的 `EvidencePack`；
7. 回答前校验引用覆盖率和最低证据阈值。

纯向量检索容易漏掉精确标识符和专业术语；Anthropic 与 Azure 的官方方案都采用关键词和向量混合召回，再进行融合或可选重排。[Introducing Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval) [Hybrid Search](https://learn.microsoft.com/en-us/azure/search/hybrid-search-overview)

首版默认使用 PostgreSQL 全文检索和 pgvector，并把 Tenant/Project/Corpus 约束同时用于查询过滤和结果重新鉴权，不能只在召回后依赖应用代码过滤。多租户索引应采用 RLS、分区或作用域索引控制搜索空间。若规模、召回率或 SLA 证明不足，再通过 `Retriever` 端口替换为专用搜索服务。首版不引入 GraphRAG、知识图数据库或多个外部 Memory Provider。

### 7.5 Artifact

Artifact 是业务层与 Harness 的协作边界。业务服务负责“这是什么业务产物”：例如剧本、角色图、分镜图、音频或成片，以及它属于哪个项目、剧集、场景或镜头，当前处于草稿、待审核还是已确认状态。Harness 不复制这些领域规则。

Harness 的 Artifact Runtime 负责“执行时如何引用和投影”：工具产生哪个 `ArtifactRef`、它与 Run/Turn/ToolExecution 的血缘、大结果何时外置，以及模型应看到摘要、片段还是引用。文件、图片、音视频、代码包和大型工具输出不能直接塞入 Transcript、Memory 或 checkpoint。Google ADK 也将 Artifact 作为命名、版本化的大对象，通过独立服务管理。[Artifacts](https://adk.dev/artifacts/)

默认实现为“数据库元数据 + 对象存储不可变 blob”：

- Blob 使用 content hash、MIME、大小和版本标识；
- metadata 保存 tenant、project、owner scope、来源、lineage、retention 和安全状态；业务对象类型、审核状态和领域版本由 Server 维护；
- Transcript、Memory、Wiki、ToolResult 只保存 `ArtifactRef`；
- 每次解引用重新鉴权，存储 URL 本身不代表授权；
- 上传时执行 MIME sniff、大小限制、恶意内容检查和生命周期清理；
- 派生产物保留父引用和生成 Run/ToolExecution，支持追踪与删除传播。

### 7.6 工具、凭据与沙箱隔离

沙箱属于 Harness Execution Facility。Harness 定义风险分类和执行政策，并由内部适配器选择容器、gVisor 或其他具体运行时：

| 工具类型                            | 默认执行方式                                          |
| ----------------------------------- | ----------------------------------------------------- |
| 纯函数、受信任只读计算              | 允许进程内执行，仍受 timeout 和输出限制               |
| 受信任外部 API                      | 经 Network/Credential Broker 调用，不直接暴露长期凭据 |
| Shell、代码解释器、浏览器、未知程序 | 进程外临时沙箱                                        |
| 改变授权边界、外网范围或持久数据    | 持久化审批后执行                                      |

Task 持有工作空间快照；Run 或高风险 ToolExecution 获得临时执行环境。项目输入默认只读，scratch/output 可写，网络默认拒绝或使用 allowlist，凭据短期签发。沙箱必须同时限制文件系统、网络、CPU、内存、PID、墙钟时间和输出大小；仅靠审批弹窗不足以隔离副作用。[Claude Code sandboxing](https://www.anthropic.com/engineering/claude-code-sandboxing)

子 Run 只接收父 Task 显式投影的文件、Artifact、Memory、Knowledge、工具和网络能力，默认降权，不共享可写工作目录和长期凭据。

### 7.7 持久化、恢复与副作用一致性

以下位置必须形成耐久提交点：

- 用户输入已接受；
- 模型响应已完成；
- 每个工具结果已完成；
- 请求审批、等待输入或发生中断；
- Run 进入成功、失败或取消终态。

同一数据库事务写入当前状态投影、checkpoint、append-only event 和 outbox。首版不需要完整 Event Sourcing，但 UI 可见事件不得早于对应状态的耐久提交，异步消费者必须容忍至少一次投递和重复消息。[Transactional outbox pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)

每个工具调用写入 `ToolExecutionLedger`：

```text
proposed → awaiting_approval → prepared → running → succeeded
                                              ├── failed
                                              ├── cancelled / timed_out
                                              └── unknown
```

记录至少包含工具/参数摘要、作用域、幂等键、副作用等级、审批引用、attempt、超时、结果/Artifact 引用。恢复时可重试无副作用或已声明幂等的调用；外部副作用处于 `unknown` 时禁止自动重试，必须先对账或请求审批。

### 7.8 分层资源治理与故障隔离

配额采用以下层级：

```text
Tenant → Project → Task → Run → Turn / ToolExecution
```

每层可限制 token、费用、墙钟时间、并发、工具次数、检索/rerank 次数、存储和 Artifact 大小。执行前做 admission control；队列实施项目公平性、优先级、最大深度和 backpressure；过载时先拒绝低优先级新工作，不让进程因无限排队失稳。

只有明确的瞬时错误可以自动重试，并使用指数退避和 jitter。Provider、外部工具和检索服务分别设置 circuit breaker 与并发舱壁。取消从 Task 传播到 Run、Turn、模型、工具和沙箱，但归档 Session 不传播取消。

Provider 协议、认证和传输级重试属于 `@duoduo/ai`；Agent Logic 决定模型 fallback、质量降级、成本策略和用户可见的失败处理。

### 7.9 可观测性与隐私

Trace 因果层级为：

```text
Task
└── Run
    └── Turn
        ├── Context Assemble
        ├── Model Call
        ├── Retrieval
        ├── Memory Read/Write Proposal
        └── Tool Execution / Approval
```

记录 ID、版本、token、费用、时延、重试、检索排名和状态等元数据。Prompt、工具参数/输出、Memory 和 RAG 正文默认不进入 telemetry，只保存脱敏摘要或引用；调试内容采集必须有独立权限、采样和保留策略。字段命名优先对齐 [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)。

## 8. 建议实施顺序

### 阶段 A：可靠执行内核

1. 固定 Session / Task / Run / Turn 关系、作用域 ID、状态机和生命周期边界。
2. 固定事件、cursor、耐久提交点，以及流式/非流式结果一致性。
3. 引入 TranscriptStore、TaskStore、CheckpointStore、event/outbox 和乐观并发控制。
4. 引入 ToolExecutionLedger、幂等键、副作用等级、审批和 `unknown` 对账语义。
5. 完成取消、deadline、基础预算和进程重启恢复测试。

完成门槛：单 Agent 在错误、审批、取消、重启和客户端重连下可恢复、可审计且不重复副作用。

### 阶段 B：上下文、Artifact 与执行安全

1. 实现 ContextSource、ContextPolicy、ContextAssembler、ContextManifest 和不可变 Turn 快照。
2. 实现 ArtifactRef/ArtifactStore，阻止大产物进入 transcript 和 checkpoint。
3. 引入 AuthorizationContext、动态工具暴露、持久化审批和凭据 Broker 端口。
4. 引入沙箱策略、资源限制、分层配额、准入、背压和 circuit breaker。
5. 建立 OpenTelemetry 端口和敏感正文默认关闭策略。

完成门槛：不同 Tenant/Project/Task 的消息、文件、检索、工具和预算均无法串用，危险工具不能绕过审批或沙箱。

### 阶段 C：Agent 逻辑、记忆与知识

1. 定义带版本的 AgentDefinition、ContextPolicy、MemoryPolicy、KnowledgePolicy 和结构化输出。
2. 实现 Session archive、Task working memory 以及经审批的 User/Project curated memory。
3. 实现 Server 精确查询优先、全文 + 向量 + RRF 的 Hybrid RAG 和 `EvidencePack`。
4. 建立 retrieval、citation、memory write 和固定 Agent 版本的轨迹评测集。
5. 实现 Wiki proposal、revision、review、lint 和 stale refresh Workflow。

完成门槛：同一 Run 的输入、版本和执行轨迹可精确还原；回答证据可追溯；记忆写入有来源、作用域、审批和删除路径。模型输出本身不承诺重新采样后逐字一致。

### 阶段 D：证据驱动的增强

1. Agent as tool、handoff、隔离 child Run 和后台 Agent。
2. 会话分支、回放、方案对比和 time travel。
3. MCP、外部 Memory Provider 和专用搜索服务适配。
4. 数据和评测证明必要后再考虑 GraphRAG、知识图谱或重型 durable workflow。
5. 规模证明单进程 worker 不足后再引入分布式调度和更强 Harness Runtime Facilities。

## 9. 当前代码的能力映射

阶段 A1–A4b 已落地，但外部副作用对账和基础预算尚未关闭阶段 A。当前 Agent Core 实现和测试已经具备：

- 无状态内部 Executor，以及复用同一 Executor 的兼容 `createAgent()` facade；
- 生产入口 `createAgentHarness()` 与公开的 start/get/cancel/dispose task contract；
- caller 提供 Tenant/Project/可选 Session scope，Harness 生成稳定的 Task/Run/Turn/ToolExecution/Attempt/Event/Commit ID；
- 每个 Task 独立 transcript、事件序列、取消控制器与生命周期投影，可并发运行；
- Task/Run/Turn 状态机、不可变快照与 optimistic version；
- 模型—工具多轮循环和内存 transcript；
- 流式事件与非流式最终结果；
- 工具 JSON 参数解析、schema 验证、未知工具和工具异常回填；
- `maxTurns` 与可区分的取消结果；
- caller、Task、Harness dispose 的取消传播与 scope-safe lookup/cancel；
- 有界单消费者事件队列、稳定终态和 observer overflow 失败语义；
- 未知 Harness 内部异常的脱敏失败终态；
- PostgreSQL 与内存 `AgentRuntimeStore`，以及原子 projection/checkpoint/event/outbox/receipt 提交；
- 追加式 checkpoint 历史、事件 cursor/replay、耐久微批和 Outbox 租约；
- 强制工具声明副作用、幂等模式和 timeout，工具上下文携带稳定执行 ID、Attempt、幂等键与 deadline；
- `proposed -> prepared -> running -> terminal` ToolExecutionLedger、Attempt 和追加式 transition；
- 未知/非法工具的零 Attempt 拒绝、普通外部异常的保守 `unknown`、结构化 effect outcome；
- 注入式 deadline、Task/Harness 取消信号传播、scope-safe Ledger 分页与脱敏工具事件；
- Commit 重放、乐观冲突和 PostgreSQL 事务回滚下的 Ledger/Attempt/Event/Outbox 一致性；
- 持久 Approval、跨实例决定、过期处理与 exactly-once 消费；
- Run 初始所有权、heartbeat、数据库时间租约、单调 fencing、恢复审计与显式 handoff；
- checkpoint v3、不可变恢复快照和模型、工具、审批、finalize、孤儿 Attempt 的确定性恢复；
- 有界 Recovery Worker、配置指纹过滤、退避、结构阻塞和 reconciliation 隔离；
- PostgreSQL 0007 的 `SKIP LOCKED` 多 Worker 竞争、旧 fence 原子拒写和真实 `SIGKILL` 进程接管测试；
- Provider 调用次数与 durable model Attempt 证明已完成 Turn 不会在恢复后重复采样；
- 基于 `@duoduo/ai/testing` faux Provider 的确定性测试。

当前仍没有外部系统对账或基础预算。无副作用孤儿 Attempt 可以安全重试；reversible/external 的 `unknown` 会进入 `waiting_for_reconciliation`，不会被 Worker 猜测或自动重试。阶段 A 的下一批工作按依赖关系应是：

1. A4c 增加外部副作用对账和人工处置闭环；
2. 增加基础预算并关闭阶段 A；
3. 阶段 B 实现 ContextAssembler、Artifact、授权、沙箱、资源治理和可观测性；
4. 阶段 C 实现分层 Memory、Hybrid RAG 和 Wiki Workflow；
5. 最后才是多 Agent、handoff、time travel 和外部高级平台。

## 10. 验收标准

当且仅当以下情况可通过确定性测试或隔离集成测试重现时，Agent Core 才具备可靠的生产基线：

### 10.1 生命周期与恢复

1. 纯文本 Run 的结果与事件序列一致。
2. 一次、连续多次和并行工具调用均保持稳定 transcript 顺序。
3. 未知工具、非法 JSON、schema 错误、工具异常和超时不会破坏 Run 生命周期。
4. 取消会终止模型、工具和沙箱，并且始终产生唯一终态。
5. 达到 turn/token/time/cost 上限时有稳定、可区分的停止原因。
6. 需要审批的工具在审批前不产生副作用，进程重启后可继续。
7. 同一审批或工具执行被重复提交时不会重复产生副作用。
8. 外部副作用中断为 `unknown` 时不会自动重试，能够进入对账或人工处理。
9. 断线客户端按 cursor 重连后不丢事件、不乱序。
10. 从 checkpoint 恢复时能检测 Agent、工具、Memory、Wiki 和索引版本不兼容。

### 10.2 作用域与安全

11. 两个 Session 并发运行时 transcript、摘要和工具结果不会串话。
12. 同一 Session 发起多个 Task 时，各 Task 的状态、预算、checkpoint、审批、工作区和产物保持隔离。
13. 归档 Session 不取消 Task；取消 Task 只传播到该 Task 的 active Run 和 Turn。
14. 重试 Task 产生新 Run 并保留旧 Run；暂停恢复继续原 Run。
15. 缺失 tenant/project scope 的 Session、Task、Run、Memory、Knowledge 或 Artifact 读写必须失败。
16. child Run 无法读取父 Task 未显式投影的消息、文件、记忆、知识或工具凭据。
17. Shell、代码和浏览器工具在文件系统与网络均受限的沙箱中执行，越界操作失败并被审计。
18. Artifact 存储 URL 泄漏时，未授权请求仍无法读取内容。

### 10.3 上下文、记忆与知识

19. 历史超过 token 预算时能够裁剪或压缩，不会孤立丢弃 tool call/tool result 或安全约束。
20. ContextManifest 可解释每个来源为何入选、被压缩或被舍弃，并能在授权和保留期内重建原 Turn 输入；来源依法删除后应明确标记不可重建，而不是使用错误的新版本替代。
21. 当前 Run 不会静默吸收新的长期记忆、Wiki revision 或业务对象版本。
22. MemoryCandidate 缺失来源、越权、包含秘密/注入、冲突或重复时不能直接发布。
23. RAG 在强制 scope filter 后执行，跨项目文档即使向量相似也不可召回。
24. 关键知识回答包含可解析到 Raw Source 或权威业务对象版本的引用。
25. Wiki 来源改变后下游页面会标记 stale，未审查 proposal 不会成为已发布知识。

### 10.4 资源与可观测性

26. 租户或项目达到并发、费用、队列或存储限制时只影响本作用域，不拖垮其他租户。
27. 瞬时故障按策略退避，持续故障触发 circuit breaker，不形成重试风暴。
28. trace 可以还原 Run 的上下文、模型、检索、记忆、工具、审批和错误因果链。
29. telemetry 默认不包含密钥、完整 prompt、工具正文、Memory 或 RAG 私密内容。
30. 固定 Agent 与数据版本的 eval 能验证最终结果、工具轨迹、检索召回、引用和成本预算。

## 11. 最终建议

Agent Core 的生产目标不是“拥有尽可能多的 Agent 功能”，而是让状态、上下文、知识和副作用都具备明确的作用域、版本、恢复和审计语义。

最终取舍如下：

- 采用分层轻内核，不采用大一体式 Harness，也不让外部平台成为核心状态真相；
- 保留 Session、Task、Run、Turn 四级隔离，并补充 ToolExecution 作为副作用账本；
- 使用集中式 ContextAssembler 和不可变 Turn 快照；
- 使用 Hermes 风格的有界精炼记忆、完整 Session 档案和可选外部 Provider；
- 让 Hybrid RAG 提供证据，让 Wiki 提供可审查的知识综合，Raw Source 和 Server 数据保持权威；
- Artifact 由业务层和 Harness 协作：业务层拥有领域语义，Harness Artifact Runtime 管理执行引用、血缘和上下文投影；
- Harness 拥有知识检索、运行存储、沙箱、审批、资源和恢复能力，但 Execution Kernel 只通过内部端口调用这些模块；
- 第一阶段由 Harness Runtime Facilities 采用 PostgreSQL、对象存储和队列，不提前引入专用图数据库、重型 Agent Runtime 或多个知识平台；
- Provider 协议和传输始终由 `@duoduo/ai` 提供；租户、项目、业务权限和客户端始终由业务服务层负责。

第一个里程碑仍然不是“支持多 Agent”，而是“单 Agent 在工具错误、取消、超时、审批、重启、断线重连和多租户竞争下保持一致、可恢复、可审计、不串数据且不重复副作用”。完成这一基线后，长期记忆、RAG、Wiki 和多 Agent 才有稳定的承载面。

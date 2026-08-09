# Agent Core 上下文、记忆与知识架构调研

> 调研日期：2026-08-01
> 范围：Context Management、分层 Memory、LLM Wiki、RAG，以及它们与多租户 Agent Runtime 的边界。
> 资料原则：仅采用官方文档、官方源码和原始设计。

## 1. 结论

业界没有一个应该直接复制的“统一记忆系统”。成熟实现更倾向于拆分为几个相互独立的平面：

1. **运行状态平面**：Session、Task、Run、Turn、checkpoint，回答“执行到哪里”。
2. **上下文平面**：每次模型调用前选择、排序、压缩和投影信息，回答“本轮让模型看到什么”。
3. **记忆平面**：保存跨轮次或跨会话仍有价值的用户偏好、项目约定和历史经验，回答“过去有什么值得保留”。
4. **知识平面**：保存来源明确的外部资料、项目知识和 LLM 综合结果，回答“有哪些可验证证据”。
5. **Artifact 平面**：保存大文本、文件、图片、音视频和中间产物，模型上下文只持有引用。

推荐 `duoduo-drama` 采用：

- 集中的 `ContextAssembler`，而不是让每个 Provider 直接修改消息数组；
- Hermes 式“小型精炼记忆 + 完整 Session 档案 + 可选外部 Provider”；
- LLM Wiki 与 Hybrid RAG 并存，Wiki 是可审查的派生知识，原始来源才是证据；
- Harness 拥有 Context、Memory、Knowledge、Artifact Runtime、运行存储、搜索和沙箱能力；Execution Kernel 只依赖这些能力的稳定端口，具体驱动放在 Harness 内部模块或适配器；
- 首版不引入知识图谱数据库、多个 Memory Provider 或重型 Agent Runtime。

## 2. Context Management

Anthropic 将 context engineering 定义为对模型每次推理所见全部 token 的持续治理，而不只是 system prompt。其核心建议是使用尽可能少的高信号 token，并结合预取、即时检索、渐进披露、压缩和结构化笔记。[Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

Microsoft Agent Framework 使用 Context Provider 在调用前提供上下文、调用后处理和保存状态，并明确区分 History Provider、Memory Provider 与 RAG Provider。官方还提醒只应有一个 History Provider 负责加载完整历史，避免重复回放。[Memory and persistence](https://learn.microsoft.com/en-us/agent-framework/get-started/memory)、[Integrations](https://learn.microsoft.com/en-us/agent-framework/integrations/)

因此上下文不应等同于 Transcript，也不应由多个 Provider 无序拼接。建议采用以下管线：

```text
ContextSource
  -> authorization and trust classification
  -> candidate normalization and deduplication
  -> priority and token budget allocation
  -> compaction / artifact projection
  -> model message projection
  -> immutable TurnContextSnapshot + ContextManifest
```

建议的优先级是：

1. 安全策略、Agent 指令与程序性知识；
2. Task 目标、待处理动作和未闭合 tool-call/tool-result；
3. Server 提供的权威项目数据及版本；
4. 最近 Session 消息和 Session 摘要；
5. 有界的用户/项目精炼记忆；
6. 按需召回的 Session 档案、Wiki 和原始证据；
7. 可选示例和低优先级补充信息。

预算应采用“关键类别最小保留量 + 弹性共享池”，而不是给每类来源写死百分比。工具定义本身也消耗上下文，必须参与预算和动态裁剪。

## 3. Hermes 的分层记忆模式

Hermes 内置两类有严格容量限制的常驻记忆：`MEMORY.md` 保存环境、项目约定和经验，`USER.md` 保存用户偏好。它们在 Session 开始时作为冻结快照注入；写入会立即持久化，但不会在同一 Session 中悄悄改变已经注入的快照。内置写入支持容量检查、重复检查、安全扫描和可选人工批准。[Persistent Memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/)

Hermes 把完整 Session 历史保存在 SQLite，并通过 FTS5 按需搜索；Session Search 返回实际消息，不用另一轮 LLM 自动摘要替代原始证据。这样形成“小型常驻记忆 + 大型按需档案”的分层。[Sessions](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/sessions.md)

外部 Memory Provider 是附加能力，不替换内置记忆；一次只启用一个外部 Provider。其生命周期覆盖 prompt context、每轮预取、Turn 后同步、Session 结束提取和内置记忆写入镜像。Provider 失败不应阻断核心记忆。[Memory Providers](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory-providers/)、[MemoryManager source](https://github.com/NousResearch/hermes-agent/blob/main/agent/memory_manager.py)、[MemoryProvider source](https://github.com/NousResearch/hermes-agent/blob/main/agent/memory_provider.py)

Hermes 还将 Context Files 与 Skills 分开：Context Files 是项目指令，Skills 是程序性知识；它们不应被混入用户事实记忆。[Context Files](https://hermes-agent.nousresearch.com/docs/user-guide/features/context-files)

对多租户服务的适配不能照搬本地 Markdown 文件，应采用结构化、有作用域、有版本的记录：

```text
WorkingMemory       Task / Run / Turn scope
SessionArchive      Session scope
CuratedUserMemory   Tenant / User scope
CuratedProjectMemory Tenant / Project scope
SemanticMemory      optional provider, additive only
ProceduralMemory    AgentDefinition / Prompt / Skill version
```

长期记忆写入必须形成 `MemoryCandidate`，经过来源、作用域、敏感度、提示注入、重复、冲突、TTL 和审批检查。subagent、cron 和压缩流程默认无权直接写入长期记忆。

## 4. LLM Wiki

Karpathy 的原始设计将 LLM Wiki 分为三层：不可变 Raw Sources、由 LLM 维护的互链 Wiki、规定结构和维护流程的 Schema。主要操作是 ingest、query 和 lint。Wiki 的价值是把多来源综合结果积累下来，避免每次查询都从原始分片重新综合。[LLM Wiki original design](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)

该模式适合个人知识库使用 Markdown 和 Git，但多租户 SaaS 不应把每个项目直接实现为可写 Git 仓库。推荐保留 Markdown 作为页面内容和导出格式，在数据库中管理页面元数据、revision、依赖、审批、锁和 ACL；原始大文件放对象存储。

Wiki 必须是派生层：

- 页面保存 `sourceRefs`、`sourceHashes`、`wikiRevision` 和生成策略版本；
- 新来源只能产生 `WikiChangeProposal`，经验证和策略审批后发布；
- 来源变化通过依赖关系将下游页面标记为 stale；
- lint 检查失效引用、矛盾、孤立页面、重复实体、缺失证据和过期结论；
- 回答可以优先读取 Wiki，但关键结论必须能回到 Raw Source 或 Server 权威版本。

## 5. RAG

Anthropic 的 Contextual Retrieval 说明纯向量检索会遗漏精确标识符和专业术语；其推荐组合是上下文化 chunk、BM25、Embedding、rank fusion 和可选 reranker。官方实验中，Contextual Embedding + Contextual BM25 降低检索失败率，加入 reranking 后进一步改善，但带来额外成本和延迟。[Introducing Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval)

Azure AI Search 的官方方案同样采用全文与向量并行召回，通过 Reciprocal Rank Fusion 合并，再按需做 semantic reranking。[Hybrid Search](https://learn.microsoft.com/en-us/azure/search/hybrid-search-overview)、[RRF scoring](https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking)

因此推荐：

```text
query normalization / decomposition
  -> mandatory tenant/project/corpus authorization filter
  -> BM25 or full-text retrieval
  -> vector retrieval
  -> RRF fusion and deduplication
  -> optional reranking for complex/high-value queries
  -> evidence threshold and diversity selection
  -> EvidencePack with citations
```

不推荐纯向量检索，也不推荐每轮都使用昂贵 reranker。简单查询、明确 ID 和结构化数据应优先走精确查询；复杂语义查询再走 Hybrid RAG。首版可在一个关系数据库中组合全文索引与向量扩展，规模或 SLA 明确超出后再替换为专用搜索服务。所有索引都属于可重建派生数据。

## 6. Artifact

Google ADK 将 Artifact 定义为与 Session 或 User 关联的命名、版本化二进制数据，并用独立 ArtifactService 管理保存、加载、列举、版本和删除；大对象不放入 Session state。[Artifacts](https://adk.dev/artifacts/)

`duoduo-drama` 应采用“数据库元数据 + 对象存储 blob”：

- Blob 由 content hash、MIME、大小和版本标识；
- 元数据记录 tenant、project、owner scope、来源、lineage、retention 和安全状态；
- Transcript、Memory、Wiki 和 Tool Result 只保存 `ArtifactRef`；
- 解引用时重新鉴权，不把存储 URL 当授权；
- 上传执行 MIME sniff、大小限制、恶意内容检查和生命周期清理。

## 7. 与 Session / Task / Run / Turn 的关系

- **Session** 保存对话档案和面向用户的 Task 结果投影。
- **Task** 固化目标、允许的 Memory scope、Corpus scope、Workspace 和 ContextPolicy。
- **Run** 固化 Agent/prompt/toolset/model 版本，以及 memory、wiki、index 和权威业务数据版本引用。
- **Turn** 保存实际模型输入的不可变 `TurnContextSnapshot`，以及 `ContextManifest` 中的来源、版本、token、检索排名和省略原因。
- **subagent/child Run** 只接收父 Task 显式投影的 Memory、Knowledge、Artifact 和工具权限。

Run 恢复必须复用已经持久化的版本和 Turn snapshot；需要吸收新的项目数据、Wiki revision 或长期记忆时，创建新 Run，而不是静默改变旧 Run。

## 8. Harness、业务层与 `@duoduo/ai` 的边界

Harness 应拥有：

- Context source、assembler、policy、budget 和 snapshot 契约；
- Memory record/candidate、read/write policy 和 Provider 生命周期端口；
- Knowledge query、EvidencePack、citation 和 revision 引用契约；
- ArtifactRef、执行血缘、上下文投影与 ArtifactStore 端口；
- 作用域、授权、版本、审计和失败隔离语义。
- Agent 运行数据库、队列、全文/向量索引、对象存储和沙箱适配器。

Harness 的 Knowledge/Memory 维护模块应拥有：

- 文件解析、OCR、chunking、Embedding 和索引重建；
- Wiki ingest、compile、review、publish、lint 和 stale refresh；
- 批处理、队列、定时维护与重新嵌入。

业务服务应拥有：

- tenant、project、用户身份和业务权限真相；
- 剧本、图片、音频、视频等 Artifact 的领域类型、归属、状态和业务版本；
- 短剧创作、审核、发布等确定性业务 Workflow；
- Web、移动端、通知和面向产品的后台 Worker。

Harness 消费业务服务下发的 `AuthorizationContext` 并在 Session、Task、Run、Turn、Memory、Knowledge、Artifact 和工具执行边界强制隔离，但不复制业务授权规则。Artifact 是协作边界：业务层拥有领域语义，Harness 拥有运行引用、工具结果外置和模型上下文投影。

`@duoduo/ai` 应继续拥有模型 Provider 的 wire protocol、认证、流式协议和传输级重试；Harness 只消费其 provider-neutral runtime。

## 9. 方案取舍

### 方案 A：Transcript + 单向量库

实现快，但会混淆状态、记忆和知识，难以治理来源、ACL、过期和删除。拒绝。

### 方案 B：外部 Memory/RAG 平台作为权威层

集成快，但恢复、隔离、版本复现和供应商迁移受外部语义约束。外部 Provider 只能作为可选适配器，不能成为 Core 真相。拒绝作为默认。

### 方案 C：分层内置能力 + 可插拔 Provider

以有界精炼记忆、完整 Session 档案、Hybrid RAG、派生 Wiki 和版本化 Artifact 为默认；外部语义 Memory 或专用搜索服务按需附加。该方案边界最清楚，也最适合从单体逐步演进。推荐。

## 10. 建议实施顺序

1. 先固定 ContextSource、ContextPolicy、ContextManifest、Memory/Knowledge/Artifact port 和作用域不变量。
2. 实现 Session Archive、Task Working Memory、权威项目数据投影和 ArtifactRef。
3. 实现全文检索与向量检索的 Hybrid RAG，并建立 retrieval/citation eval。
4. 增加经审批的用户/项目精炼记忆。
5. 再增加 Wiki compile/review/lint 工作流。
6. 只有数据量、召回指标或运维需求证明必要时，才引入外部 Memory Provider、专用搜索服务或知识图谱。

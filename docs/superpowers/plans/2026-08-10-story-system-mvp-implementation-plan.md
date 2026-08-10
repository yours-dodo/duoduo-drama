# 故事系统 MVP 实施计划

> 日期：2026-08-10
>
> 状态：待执行
>
> 依据：[故事系统 MVP 设计](../specs/2026-08-10-story-system-design.md)

## 1. 目标

在现有多租户故事后端基础上，完成故事系统的第一个可用闭环：用户创建故事项目，在项目对话中发送创作请求，得到一份确定性 Mock Agent 生成的草稿成果，编辑并确认该成果，随后查看当前有效版本和历史版本。

本计划只实现故事系统 MVP。短剧项目、剧集、场景、镜头、分镜、图片、视频和成片导出不进入本轮。真实 Agent 调用也暂不作为 MVP 的完成条件；Server 先通过稳定的 `AgentGateway` 端口接入可预测的 Mock 适配器，为后续连接 `agent/` 保留边界。

## 2. 当前基线

- `apps/server` 已具备身份、团队、租户上下文、审计、故事项目、项目授权、对话、消息和待处理生成请求。
- 保存用户消息时，消息、生成请求和幂等记录已经在同一事务中创建。
- 生成请求目前尚未接入 Agent Gateway，也没有成果和版本持久化。
- `apps/web` 仍是最小 Nuxt 应用，没有故事页面、API 适配器或状态管理。
- `agent/` 当前提供 Agent 服务健康基座；框架无关的执行能力位于 `packages/agent-runtime`。
- `packages/ai` 继续只负责 Provider-neutral AI Runtime 和 Provider 适配，不在本轮扩展通用模型能力。
- 当前工作区已有资产和 MinIO 相关修改。本计划不覆盖、不回滚、不重排这些修改；故事成果以文本内容为主，不依赖素材上传闭环。

## 3. 实施原则

- 保持模块化单体；不新增故事服务或短剧服务。
- Server 是故事业务数据和权限的唯一权威，Agent 只通过显式端口返回候选成果。
- 先使用 Mock Agent 验证业务流程，再接入真实 Agent；默认测试不进行真实模型调用。
- 领域代码不依赖 NestJS、Prisma、HTTP DTO 或 Agent 实现。
- 所有租户查询显式接收 `tenantId`；所有故事子对象通过项目和租户复合关系校验归属。
- 数据库事务不等待外部 Agent 调用；请求事务提交后才开始生成。
- 草稿和版本内容不可被静默覆盖；确认、放弃、编辑和回退都保留来源和审计关联。
- 每个切片先补失败测试，再实现最小行为，完成切片验证后形成一个聚焦提交。
- 只创建真实功能需要的目录和接口，不提前抽象短剧领域或通用内容平台。

## 4. 目录边界

```text
apps/server/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
└── src/
    ├── domain/story/
    │   ├── story-artifact.ts
    │   ├── story-artifact-version.ts
    │   └── story-generation-request.ts
    ├── integrations/agent/
    │   ├── agent-contracts.ts
    │   ├── agent-gateway.ts
    │   └── mock-agent-gateway.ts
    └── modules/story/
        ├── application/
        ├── http/
        ├── infrastructure/
        └── ports/

apps/web/app/
├── components/story/
├── composables/
├── pages/story/
├── pages/login.vue
├── types/story.ts
└── services/
```

Web 只调用 Server API；Server 不依赖 Web 类型；Agent 不导入 Server 源码，也不连接 Server 数据库。

## 5. 通用验证命令

Server 切片至少运行：

```bash
pnpm --filter @duoduo/server test
pnpm --filter @duoduo/server typecheck
pnpm --filter @duoduo/server build
pnpm lint
pnpm format:check
git diff --check
```

涉及迁移、仓储或 HTTP 的切片还要运行：

```bash
pnpm --filter @duoduo/server test:postgres
```

Web 切片至少运行：

```bash
pnpm --filter @duoduo/web test
pnpm --filter @duoduo/web typecheck
pnpm --filter @duoduo/web build
```

最终切片运行根级测试、类型检查、构建、Lint、格式检查和 Git 差异检查，并完成桌面宽度和窄屏宽度的浏览器验收。

## 6. 切片 S01：故事成果与不可变版本

### 目标

将故事成果从对话消息中独立出来，支持成果类型、草稿版本、已确认版本、放弃版本和当前有效版本指针。

### 文件

- 修改 `apps/server/prisma/schema.prisma`。
- 新增故事成果数据库迁移。
- 新增 `apps/server/src/domain/story/story-artifact.ts` 及测试。
- 新增 `apps/server/src/domain/story/story-artifact-version.ts` 及测试。
- 新增或扩展 `apps/server/src/domain/story/story-errors.ts`。
- 新增 `apps/server/src/modules/story/ports/story-artifact-repository.ts`。
- 新增 `apps/server/src/modules/story/ports/story-artifact-version-repository.ts`。
- 新增 `apps/server/src/modules/story/infrastructure/prisma-story-artifact.repository.ts`。
- 新增 `apps/server/src/modules/story/infrastructure/prisma-story-artifact-version.repository.ts`。
- 修改 `apps/server/src/modules/story/story.module.ts` 注册仓储。

### 数据模型

`StoryArtifact` 保存稳定的成果身份、项目归属、有限成果类型、标题、生命周期和当前有效版本指针。首版成果类型为 `idea`、`world_setting`、`character`、`outline`、`script`。

`StoryArtifactVersion` 保存不可变内容快照、版本序号、`markdown` 或 `text` 内容格式、版本状态、来源类型、触发消息、生成请求和创建者关联。版本状态至少包括 `draft`、`confirmed`、`discarded`。

成果版本使用项目和租户复合约束，版本号在同一成果内递增。历史已确认版本保留不变；当前有效版本由成果上的指针确定。

### 实施步骤

1. 为成果类型、标题、内容、版本状态和版本序号编写领域不变量测试。
2. 实现成果与版本的纯领域对象和快照类型。
3. 设计 Prisma 复合关系，确保版本不能跨租户或跨项目挂载。
4. 创建迁移和 Prisma 仓储映射，拒绝数据库中的未知枚举字符串。
5. 补充成果列表、版本列表和按 ID 查询所需的最小仓储方法。
6. 在真实 PostgreSQL 中验证版本唯一性、复合外键和归属隔离。

### 验收

- 未知成果类型、空标题、超长标题和空正文无法进入领域层。
- 版本内容创建后不可原地修改。
- 同一成果不能出现重复版本号。
- 跨租户、跨项目查询返回空或统一不可访问结果。
- 归档项目不会删除已保存的成果和版本。

### 提交

`feat(server): add story artifacts and immutable versions`

## 7. 切片 S02：生成请求状态与 Mock Agent

### 目标

在现有待处理生成请求基础上，建立 Server-owned Agent Gateway，生成确定性的 Agent 草稿、Agent 消息和可恢复的请求状态。

### 文件

- 新增 `apps/server/src/integrations/agent/agent-contracts.ts`。
- 新增 `apps/server/src/integrations/agent/agent-gateway.ts`。
- 新增 `apps/server/src/integrations/agent/mock-agent-gateway.ts` 及测试。
- 扩展 `apps/server/src/domain/story/story-generation-request.ts` 及测试。
- 扩展 `apps/server/src/modules/story/ports/story-generation-request-repository.ts`。
- 扩展 `apps/server/src/modules/story/infrastructure/prisma-story-generation-request.repository.ts`。
- 新增 `apps/server/src/modules/story/application/generate-story-draft.ts` 及测试。
- 新增 `apps/server/src/modules/story/application/retry-story-generation.ts` 及测试。
- 新增 `apps/server/src/modules/story/http/generation-requests.controller.ts`。
- 修改 `apps/server/src/modules/story/http/messages.controller.ts` 和 `story.module.ts`。
- 修改 Prisma Schema，保存处理时间、失败类别、Agent 消息 ID、成果 ID 和成果版本 ID。

### Agent 契约

请求只包含：请求 ID、幂等键、授权范围、对话消息快照、当前成果摘要和用户创作目标。返回值只包含成果类型、标题、正文和来源关联。

Mock Agent 对规范化输入计算稳定结果，允许测试注入可分类失败。它不读取数据库、不接触凭证、不直接写入故事表。

### 实施步骤

1. 为生成请求增加 `processing`、`succeeded` 和 `failed` 的合法状态转换，拒绝重复完成和非法回退。
2. 定义 Agent Gateway 端口与 DTO，明确超时、失败类别和幂等语义。
3. 实现 Mock Agent，确保相同输入产生相同候选成果，并可以模拟超时、不可用和协议错误。
4. 保持现有消息事务不变：先提交用户消息和待处理请求，再在事务外调用生成用例。
5. 成功时在第二个事务中创建 Agent 消息、StoryArtifact、StoryArtifactVersion 草稿，并回写生成请求结果关联。
6. 失败时保存安全失败类别；重试复用原始请求和用户消息，不重复追加用户消息。
7. 对请求恢复设置明确规则：处于 `processing` 但没有结果的请求只能通过显式重试重新执行，已有结果的请求直接返回同一结果。
8. 增加查询和重试接口，接口响应只暴露状态、错误类别和结果引用，不暴露内部堆栈或完整模型输入。

### 验收

- 用户消息与待处理请求仍然原子创建。
- Mock Agent 成功后可查到 Agent 消息、草稿成果和生成结果关联。
- Agent 失败、超时和协议错误可以查询并重试。
- 重复 HTTP 请求、重复回调和进程中断不会重复用户消息、草稿或生成结果。
- 外部 Agent 调用不在数据库事务内执行。
- Server 不向 Agent 发送数据库凭据或越权内容。

### 提交

`feat(server): add mock story generation`

## 8. 切片 S03：草稿编辑、确认和版本回退

### 目标

实现故事成果的人工编辑和确认流程，让用户可以安全地把草稿变成当前有效版本，并保留全部历史。

### 文件

- 新增 `apps/server/src/modules/story/application/list-story-artifacts.ts` 及测试。
- 新增 `apps/server/src/modules/story/application/get-story-artifact.ts` 及测试。
- 新增 `apps/server/src/modules/story/application/edit-story-draft.ts` 及测试。
- 新增 `apps/server/src/modules/story/application/discard-story-draft.ts` 及测试。
- 新增 `apps/server/src/modules/story/application/confirm-story-draft.ts` 及测试。
- 新增 `apps/server/src/modules/story/application/rollback-story-artifact.ts` 及测试。
- 新增 `apps/server/src/modules/story/application/list-story-versions.ts` 及测试。
- 新增成果和版本 HTTP Controller、DTO 和错误映射。
- 扩展审计记录调用和幂等仓储使用。

### 实施步骤

1. 测试只有草稿可以编辑或放弃；已确认和已放弃版本不可修改。
2. 编辑草稿时创建新的不可变版本，保留原版本和来源关系，不直接覆盖正文。
3. 确认操作使用预期版本号，并在同一事务中更新当前有效版本指针和审计记录。
4. 为确认操作增加幂等支持，重复确认返回相同版本结果。
5. 实现历史版本列表和回退；回退只切换当前指针，不删除版本。
6. 在所有用例中复用现有项目/对话授权策略，禁止通过成果 ID 绕过项目权限。
7. 添加 PostgreSQL 并发测试，验证两个确认请求不会产生错误的当前版本指针。

### 验收

- 草稿可以编辑、放弃和确认。
- 已确认版本内容不可变。
- 确认和回退都保留来源、操作者、时间和审计关联。
- 正确处理过期版本号、重复确认、跨租户访问和归档项目。
- 当前有效版本与历史版本在并发场景下保持一致。

### 提交

`feat(server): confirm immutable story versions`

## 9. 切片 S04：Web 会话与故事 API 适配

### 目标

为 Nuxt Web 接入现有 Server 身份和团队上下文，并建立可替换的故事 API 适配层；本切片不新增 Server 身份或权限规则。

### 文件

- 新增 `apps/web/app/services/http-client.ts`。
- 新增 `apps/web/app/services/story-api.ts`。
- 新增 `apps/web/app/types/story.ts`。
- 新增 `apps/web/app/composables/use-session.ts`。
- 新增 `apps/web/app/composables/use-story-projects.ts`。
- 新增 `apps/web/app/composables/use-story-workspace.ts`。
- 新增 `apps/web/app/pages/login.vue`。
- 新增 Web 端 API、错误映射和 Composable 测试。
- 修改 `apps/web/app/app.vue`，增加最小路由出口和会话加载边界。

### 实施步骤

1. 复用现有 Server 的密码less 登录和团队 API，不在 Web 复制认证、租户或项目授权逻辑。
2. 实现带 Cookie、请求编号和稳定错误映射的 HTTP 客户端。
3. 为项目、对话、消息、生成请求、成果和版本定义 Web view model；不直接导入 Server 源码类型。
4. 为加载、未登录、无团队、无权限和网络失败编写 Composable 测试。
5. 仅在真实页面需要时引入客户端状态；服务端数据不复制到本地全局状态。

### 验收

- 未登录用户进入故事页面会进入登录流程。
- Web 请求只发往 Server，不直接访问 Agent。
- 401、403、404、409、429 和 5xx 错误有稳定的用户可理解状态。
- 刷新页面后项目、对话和成果状态从 Server 恢复。

### 提交

`feat(web): connect story workspace APIs`

## 10. 切片 S05：故事创作工作台

### 目标

提供完成故事 MVP 的最小 Web 工作台，覆盖项目、对话、消息、草稿成果和版本确认。

### 文件

- 新增 `apps/web/app/pages/story/index.vue`。
- 新增 `apps/web/app/pages/story/[projectId].vue`。
- 新增 `apps/web/app/components/story/story-project-list.vue`。
- 新增 `apps/web/app/components/story/story-conversation-list.vue`。
- 新增 `apps/web/app/components/story/story-message-list.vue`。
- 新增 `apps/web/app/components/story/story-composer.vue`。
- 新增 `apps/web/app/components/story/story-artifact-list.vue`。
- 新增 `apps/web/app/components/story/story-artifact-editor.vue`。
- 新增 `apps/web/app/components/story/story-version-history.vue`。
- 为消息发送、生成状态、草稿编辑和版本操作新增组件测试。

### 页面行为

- 项目页显示项目列表、创建、编辑和归档。
- 工作台支持切换对话、查看消息历史和发送创作请求。
- 生成中显示明确状态；失败显示原因类别和重试入口。
- Agent 返回的内容显示为草稿，不自动标记为正式成果。
- 用户可以编辑、确认、放弃草稿，并查看版本历史和当前有效版本。
- 项目、对话、成果和版本操作使用 Server 返回的权限与状态，不由 UI 自行推断可写性。

### 验收

- 正常桌面宽度下可以完成完整故事闭环。
- 窄屏宽度下主要操作仍可访问，不出现横向溢出。
- 覆盖加载、空项目、空对话、生成中、生成失败、无权限和禁用状态。
- 浏览器刷新不会丢失已确认成果或当前有效版本。

### 提交

`feat(web): build story creation workbench`

## 11. 切片 S06：全链路验收与运行文档

### 目标

验证一个用户可以从登录进入故事工作台，完成一次 Mock Agent 生成、草稿编辑、确认和历史版本查看，并冻结 MVP 的运行方式和验收证据。

### 文件

- 新增 `apps/server/src/test/story-system-mvp.e2e.test.ts`。
- 新增或扩展 `apps/server/src/test/security-boundaries.e2e.test.ts`。
- 新增或扩展 Web 端页面流程测试。
- 更新 `README.md`，将当前阶段明确为故事系统 MVP，移除短剧能力已完成的暗示。
- 更新 `PROJECT-PLAN.md` 和 `remaining-tasks.md`，标记已完成的故事系统决策并保留短剧待办。
- 更新必要的 `.env.example` 和开发运行说明。

### 实施步骤

1. 用两个用户、两个团队和一个项目验证租户隔离、私人项目和协作者权限。
2. 验证消息、生成请求、Mock Agent、草稿、确认版本和审计记录的完整链路。
3. 验证幂等键冲突、生成失败重试、重复确认、并发编辑和项目归档。
4. 从全新 PostgreSQL 迁移开始运行 Server 契约测试。
5. 在浏览器中验证桌面和窄屏布局的完整操作流程。
6. 运行根级检查并确认没有生成文件、凭据或不相关改动进入提交。

### MVP 完成定义

以下条件全部满足时，故事系统 MVP 才算完成：

- 用户可以创建故事项目和创作对话。
- 用户消息与待处理生成请求原子保存。
- Mock Agent 可以生成可预测的候选成果。
- 候选成果先进入草稿状态。
- 用户可以编辑、确认、放弃和回退版本。
- 当前有效版本和历史版本可查询。
- 失败、重试、重复提交和并发修改不会破坏业务状态。
- Web 可以完成上述闭环，并覆盖加载、空、错和禁用状态。
- 所有租户、权限、审计、迁移和自动化测试通过。

### 提交

`test: verify story system MVP`

## 12. MVP 后续，不纳入本轮

故事 MVP 通过后，再单独设计和实施以下内容：

1. 将 Mock Gateway 替换为 `agent/` 中的真实故事生成工作流。
2. 文件上传、剧本文件解析和成果导入。
3. 更严格的结构化剧本内容模型。
4. 故事成果导出为不可变快照。
5. 独立短剧系统及其项目、剧集、场景、镜头和制作产物。

短剧系统只能消费已确认故事成果的快照，不直接读取故事系统内部表，也不与故事系统建立默认实时同步。

## 13. 最终验证

S06 完成后，在没有后续文件改动的情况下执行：

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm format:check
pnpm --filter @duoduo/server test:postgres
git diff --check
git status --short
```

只有所有命令成功、浏览器验收完成、工作区状态符合预期，并且 MVP 完成定义逐项有测试或操作证据后，才能宣告故事系统 MVP 完成。

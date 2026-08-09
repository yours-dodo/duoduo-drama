# 多租户故事创作后端实施计划

> 日期：2026-08-09
>
> 状态：执行中（S01–S07 已完成）
>
> 依据：[多租户故事创作后端框架设计](../specs/2026-08-09-multi-tenant-story-backend-framework-design.md)

## 1. 目标

在现有 NestJS Server 中实现首个可运行的多租户故事创作后端。完成后，用户能够通过邮箱无密码登录，加入多个团队，在严格的团队租户边界内创建故事项目和对话，通过模拟 Agent 生成草稿，并将草稿确认为不可变版本。

本计划只实现已确认设计中的首期范围。真实 Agent、Redis、任务队列、对象存储、文件解析和短剧制作模块不进入本轮。

## 2. 实施原则

- 保持模块化单体，不创建新的微服务或共享 contracts 包。
- 每个切片先写失败测试，再实现最小行为，最后运行该切片与仓库级验证。
- 领域代码不导入 NestJS、Prisma、HTTP DTO 或 Agent 协议。
- 所有租户数据查询显式接收 `tenantId`，数据库关系使用租户复合约束兜底。
- 外部邮件和 Agent 调用不放在数据库事务内。
- 每个切片形成一个聚焦提交；前一个切片通过后再开始下一个。
- 生成的 Prisma Client 不提交，由脚本在测试、类型检查和构建前生成。

## 3. 技术基线

### 3.1 依赖

Server 继续使用 NestJS 11、TypeScript NodeNext 和 Vitest，并增加：

- 运行依赖：`@nestjs/config`、`@nestjs/swagger`、`class-transformer`、`class-validator`、`cookie-parser`、`@prisma/client`、`@prisma/adapter-pg`、`pg`。
- 开发依赖：`prisma`、`@nestjs/testing`、`supertest`、`@types/cookie-parser`、`@types/supertest`。

Prisma 使用当前 `prisma-client` 生成器、显式输出目录和 PostgreSQL Driver Adapter。Server package 切换为 ESM，Prisma 配置从 `DATABASE_URL` 读取迁移连接，运行时数据库适配器从经过校验的 Server 配置读取连接字符串。该接入方式与当前官方 NestJS 指南和 Prisma 7 生成器要求一致：

- [Prisma NestJS 指南](https://docs.prisma.io/docs/guides/frameworks/nestjs)
- [Prisma 7 升级说明](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7)
- [Prisma Client 生成器](https://www.prisma.io/docs/orm/prisma-schema/overview/generators)

### 3.2 目录边界

```text
apps/server/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── prisma.config.ts
└── src/
    ├── config/
    ├── domain/
    │   ├── identity/
    │   ├── tenancy/
    │   └── story/
    ├── integrations/
    │   └── agent/
    ├── modules/
    │   ├── identity/
    │   ├── tenancy/
    │   ├── audit/
    │   └── story/
    ├── platform/
    │   ├── database/
    │   ├── http/
    │   └── observability/
    └── test/
```

只在对应切片需要真实代码时创建目录。Prisma 生成目录位于 `src/generated/prisma/`，加入忽略规则。

### 3.3 通用验证

每个切片至少运行：

```bash
pnpm --filter @duoduo/server test
pnpm --filter @duoduo/server typecheck
pnpm --filter @duoduo/server build
pnpm lint
pnpm format:check
git diff --check
```

涉及迁移或 Prisma 仓储的切片还要运行真实 PostgreSQL 契约测试：

```bash
pnpm --filter @duoduo/server test:postgres
```

最终切片运行全部根级检查。

## 4. 切片 S01：HTTP 平台基座

### 目标

建立后续所有业务模块共享的配置、请求追踪、验证和错误边界，同时保留现有健康检查。

### 文件

- 修改 `apps/server/package.json`。
- 修改 `apps/server/src/main.ts`、`apps/server/src/app.module.ts`。
- 将现有健康控制器整理为 `apps/server/src/platform/http/health.controller.ts`。
- 新增 `apps/server/src/config/server-config.ts` 及测试。
- 新增 `apps/server/src/platform/http/application-error.ts`。
- 新增 `apps/server/src/platform/http/http-exception.filter.ts` 及测试。
- 新增 `apps/server/src/platform/http/request-id.middleware.ts` 及测试。
- 新增 `apps/server/src/platform/observability/request-logging.interceptor.ts`。
- 新增 `apps/server/src/test/create-test-app.ts`。

### 实施步骤

1. 安装本切片所需的配置、DTO 验证、Cookie 和 HTTP 测试依赖；OpenAPI 依赖延后到 S11。
2. 为默认/非法端口、非法环境、Cookie 密钥和可信 Origin 写配置解析测试。
3. 实现纯函数配置解析，并通过 Nest 配置模块只暴露经过校验的配置对象。
4. 为请求编号透传、非法编号替换和统一错误结构写测试。
5. 实现请求编号中间件、JSON 日志拦截器和全局异常过滤器。
6. 启用 URI 版本 `v1`、全局 DTO 验证和 Cookie 解析；健康接口不参与业务版本。
7. 保留 `/health` 存活检查，新增 `/ready`，数据库接入前两者都只报告进程状态。

### 验收

- 非法配置阻止服务启动。
- 业务错误返回稳定的 `error.code`、安全消息和 `requestId`。
- 未知异常不返回堆栈。
- `/health` 与 `/ready` 可用，现有测试迁移后继续通过。

### 提交

`feat(server): establish HTTP platform baseline`

## 5. 切片 S02：Prisma 与 PostgreSQL 运行边界

### 目标

建立 Prisma 7 ESM 生成、数据库连接、显式迁移和真实 PostgreSQL 测试基座。

### 文件

- 修改 `apps/server/package.json`、根 `.gitignore`。
- 新增 `apps/server/prisma.config.ts`。
- 新增 `apps/server/prisma/schema.prisma`。
- 新增 `apps/server/src/platform/database/database.module.ts`。
- 新增 `apps/server/src/platform/database/prisma.service.ts` 及测试。
- 新增 `apps/server/src/platform/database/transaction-runner.ts`。
- 新增 `apps/server/src/platform/database/database-readiness.service.ts`。
- 新增 `apps/server/src/test/postgres-test-context.ts`。
- 新增 `apps/server/compose.postgres.test.yml`。
- 修改健康控制器，使 `/ready` 验证业务数据库。

### 实施步骤

1. 安装 Prisma CLI、Client、PostgreSQL Driver Adapter 和 `pg`，并将 Server package 切换为 ESM。
2. 为数据库配置缺失、连接失败和连接释放写测试。
3. 增加 `db:generate`、`db:migrate:dev`、`db:migrate:deploy`、`test:postgres` 脚本，以及测试、类型检查和构建前的 Client 生成步骤。
4. 配置 `prisma-client` 输出到 Server 源码生成目录，使用 ESM 和 `@prisma/adapter-pg`。
5. 实现 Prisma 生命周期和窄接口事务执行器，业务模块不直接依赖全局 Prisma Client。
6. 建立 Server 独立测试数据库 Compose 配置和可清理的测试上下文。
7. 在真实 PostgreSQL 中验证连接、事务提交、事务回滚和就绪检查。

### 验收

- 空 Server 数据库可以执行迁移部署和 Client 生成。
- PostgreSQL 不可用时 `/health` 仍存活，`/ready` 返回未就绪。
- 真实事务测试证明异常会完整回滚。
- Server 与 Agent 使用不同数据库名和凭据。

### 提交

`feat(server): add PostgreSQL persistence boundary`

## 6. 切片 S03：邮箱登录请求

### 目标

实现无密码登录的第一半：规范化邮箱、创建一次性挑战并通过本地适配器交付验证码和魔法链接。

### 文件

- 修改 Prisma Schema，新增首个身份迁移。
- 新增 `apps/server/src/domain/identity/email-address.ts` 及测试。
- 新增 `apps/server/src/domain/identity/login-challenge.ts` 及测试。
- 新增 `apps/server/src/modules/identity/application/request-email-login.ts` 及测试。
- 新增 `apps/server/src/modules/identity/ports/login-challenge-repository.ts`。
- 新增 `apps/server/src/modules/identity/ports/email-delivery.ts`。
- 新增 `apps/server/src/modules/identity/infrastructure/prisma-login-challenge.repository.ts`。
- 新增 `apps/server/src/modules/identity/infrastructure/local-email-delivery.ts`。
- 新增 `apps/server/src/modules/identity/http/auth.controller.ts` 和 DTO。
- 新增 `apps/server/src/modules/identity/identity.module.ts`。

### 数据

新增 `User` 和 `EmailLoginChallenge`。邮箱使用规范化值建立全局唯一约束；挑战只保存令牌哈希、过期时间、尝试次数、来源摘要和消费时间。

### 实施步骤

1. 测试邮箱规范化、非法邮箱、挑战十分钟过期和原始令牌不可持久化。
2. 测试同一邮箱和来源地址的限流；限流计数使用 PostgreSQL 数据，不引入 Redis。
3. 实现 `POST /v1/auth/email-login-requests`，无论邮箱是否已存在都返回相同外部响应。
4. 实现本地邮件适配器，仅在测试上下文暴露最近一次令牌；普通日志不得记录令牌。
5. 在 PostgreSQL 测试中验证唯一约束、过期查询和限流竞争。

### 验收

- 合法邮箱收到一次性登录内容。
- 数据库和日志中不存在原始验证码或魔法链接令牌。
- 枚举邮箱无法从响应状态、结构或文案中判断账号是否存在。
- 限流行为可在多进程共享数据库时保持一致。

### 提交

`feat(server): request passwordless email login`

## 7. 切片 S04：登录验证与安全会话

### 目标

消费一次性登录挑战，自动创建用户和持久会话，并保护 Cookie 写请求。

### 文件

- 修改 Prisma Schema，新增会话和身份安全事件迁移。
- 新增 `apps/server/src/domain/identity/session.ts` 及测试。
- 新增 `apps/server/src/modules/identity/application/verify-email-login.ts` 及测试。
- 新增 `apps/server/src/modules/identity/application/logout.ts` 及测试。
- 新增用户和会话仓储端口及 Prisma 实现。
- 新增身份安全事件仓储端口及 Prisma 实现。
- 新增 `apps/server/src/modules/identity/http/session-auth.guard.ts` 及测试。
- 新增 `apps/server/src/modules/identity/http/trusted-origin.guard.ts` 及测试。
- 扩展身份控制器与 `/v1/me` 控制器。

### 实施步骤

1. 写过期、错误、尝试超限、重复消费和并发消费挑战的失败测试。
2. 在一个事务内消费挑战、按邮箱获取或创建用户、创建会话。挑战锁定和会话撤销写入全局身份安全事件，不写租户审计表。
3. Cookie 只包含随机不透明令牌，数据库只保存哈希；生产配置强制 `Secure`。
4. 实现 `POST /v1/auth/email-login-verifications`、`DELETE /v1/auth/session` 和 `GET /v1/me`。
5. 为所有 Cookie 认证写请求校验可信 `Origin`；安全读取请求不要求 Origin。
6. 用真实 PostgreSQL 竞争测试证明同一挑战只产生一个有效验证结果。

### 验收

- 新邮箱验证后自动创建用户，会话可读取 `/v1/me`。
- 同一挑战只能成功一次。
- 登出后旧 Cookie 立即失效。
- 不可信 Origin 无法执行写请求。

### 提交

`feat(server): establish passwordless sessions`

## 8. 切片 S05：团队租户与请求上下文

### 目标

实现“团队即租户”、多团队成员关系、团队创建与基于路径的租户上下文。

### 文件

- 修改 Prisma Schema，新增团队、成员、幂等记录和审计迁移。
- 新增 `apps/server/src/domain/tenancy/team.ts` 及测试。
- 新增 `apps/server/src/domain/tenancy/team-membership.ts` 及测试。
- 新增 `apps/server/src/modules/tenancy/application/create-team.ts` 及测试。
- 新增 `apps/server/src/modules/tenancy/application/list-my-teams.ts` 及测试。
- 新增团队、成员、幂等和审计仓储端口及 Prisma 实现。
- 新增 `apps/server/src/modules/tenancy/http/tenant-context.guard.ts` 及测试。
- 新增 `apps/server/src/modules/tenancy/http/teams.controller.ts` 和 DTO。
- 新增 `apps/server/src/modules/tenancy/tenancy.module.ts`。
- 新增 `apps/server/src/modules/audit/audit.module.ts`。

### 实施步骤

1. 测试团队创建者自动成为管理员、同一用户可加入多个团队、最后管理员不变量。
2. `IdempotencyRecord` 使用非空 `scopeKey`：全局操作为 `user:{userId}`，租户操作为 `tenant:{tenantId}:user:{userId}`；唯一约束为“作用域 + 操作类型 + 幂等键”。
3. 在一个事务内创建团队、管理员成员关系、幂等结果和审计记录。
4. 实现 `POST /v1/teams`、`GET /v1/teams` 和 `GET /v1/me` 的团队列表。
5. 实现团队路径解析：只有有效成员才能建立 `TenantContext`，跨租户资源统一返回不存在。
6. 在复合唯一约束和仓储签名中强制 `tenantId`。

### 验收

- 一个用户能创建和访问多个互不干扰的团队。
- 重复团队创建请求返回原团队，不创建重复数据。
- 非成员不能建立目标团队的请求上下文。
- 业务日志可以添加租户标识，但不记录业务正文。

### 提交

`feat(server): add multi-tenant team context`

## 9. 切片 S06：团队邀请、成员管理与审计

### 目标

完成首期团队生命周期：管理员邀请、受邀用户加入、成员角色变化和安全移除。

### 文件

- 修改 Prisma Schema，新增邀请迁移。
- 新增 `apps/server/src/domain/tenancy/team-invitation.ts` 及测试。
- 新增邀请、加入、角色变化和成员移除应用用例及测试。
- 新增邀请仓储端口及 Prisma 实现。
- 新增 `apps/server/src/modules/tenancy/http/team-members.controller.ts`。
- 新增 `apps/server/src/modules/tenancy/http/team-invitations.controller.ts`。
- 新增 `apps/server/src/modules/audit/http/audit-records.controller.ts`。

### 实施步骤

1. 测试仅管理员可管理成员和邀请、邀请邮箱必须匹配、令牌不可复用。
2. 测试最后管理员不能降级或移除，以及被移除成员立即失去租户访问权。
3. 实现邀请令牌哈希、有效期、撤销和接受事务。
4. 实现成员列表、邀请列表、角色更新、成员移除和授权范围内审计查询。
5. 所有成员和邀请变更与审计在同一事务提交。
6. 用两个 Server 实例的 PostgreSQL 竞争测试验证邀请只能接受一次。

### API 契约

- `POST /v1/teams/{teamId}/invitations`：管理员创建邀请，要求 `Idempotency-Key`，成功返回 `201`。
- `GET /v1/teams/{teamId}/invitations`：管理员按不透明游标分页查看邀请；`limit` 为 1–100。
- `DELETE /v1/teams/{teamId}/invitations/{invitationId}`：管理员撤销邀请，成功返回 `204`。
- `POST /v1/team-invitation-acceptances`：当前登录邮箱使用请求体中的一次性令牌接受邀请，成功返回 `201`。
- `GET /v1/teams/{teamId}/members`：管理员按不透明游标分页查看有效成员；`limit` 为 1–100。
- `PATCH /v1/teams/{teamId}/members/{membershipId}`：管理员修改 `admin` 或 `member` 角色。
- `DELETE /v1/teams/{teamId}/members/{membershipId}`：管理员安全移除成员，成功返回 `204`。
- `GET /v1/teams/{teamId}/audit-records`：管理员按不透明游标分页查看租户审计记录；`limit` 为 1–100。

所有接口沿用 `/v1` URI 版本、Cookie 会话、统一错误信封和精确 Origin 写保护。团队路径先建立 `TenantContext`，再由应用用例重新校验管理员权限。OpenAPI 在 S11 统一生成。

### 验收

- 受邀邮箱登录后可以加入正确团队。
- 普通成员不能管理团队成员或邀请。
- 最后管理员保护在应用层和并发事务中都成立。
- 跨租户邀请、成员和审计记录不可探测。

### 提交

`feat(server): manage tenant members and invitations`

## 10. 切片 S07：故事项目与项目授权

### 目标

实现故事项目、团队或私人可见范围、项目协作者和项目级权限策略。

### 文件

- 修改 Prisma Schema，新增故事项目和协作者迁移。
- 新增 `apps/server/src/domain/story/story-project.ts` 及测试。
- 新增 `apps/server/src/domain/story/project-access-policy.ts` 及权限矩阵测试。
- 新增项目创建、列表、详情、修改、归档应用用例及测试。
- 新增协作者邀请和移除应用用例及测试。
- 新增项目和协作者仓储端口及 Prisma 实现。
- 新增 `apps/server/src/modules/story/http/story-projects.controller.ts`。
- 新增 `apps/server/src/modules/story/http/project-collaborators.controller.ts`。
- 新增 `apps/server/src/modules/story/story.module.ts`。
- 扩展审计查询策略，允许项目创建者只查询自己项目的审计记录。

### 实施步骤

1. 用表驱动测试覆盖管理员、创建者、协作者和普通成员对团队与私人项目的权限矩阵。
2. 实现带 `tenantId` 的项目和协作者复合约束，数据库拒绝跨租户关联。
3. 实现创建、列表、详情、修改可见范围和归档，所有修改使用 `expectedRevision`。
4. 项目切换为私人时，在同一事务撤销协作者并写审计；恢复团队范围不自动恢复。
5. 管理员读取或修改私人项目时写审计记录。
6. 列表查询在数据库层应用可见范围条件，不先读取全部项目再过滤。

### 验收

- 权限矩阵全部通过。
- 跨租户项目和协作者关联被应用层及数据库双重拒绝。
- 普通成员无法通过列表、详情或错误差异发现私人项目。
- 修订冲突返回稳定 `409` 错误。

### 提交

`feat(server): add authorized story projects`

### 状态

已完成。项目与协作者的领域规则、租户复合约束、HTTP 接口、项目级审计和 PostgreSQL 回归验证均已落地。

## 11. 切片 S08：创作对话与消息

### 目标

实现项目内多个对话、不可变消息、归档和稳定游标分页，并为生成流程建立输入记录。

### 文件

- 修改 Prisma Schema，新增对话、消息和生成请求迁移。
- 新增 `apps/server/src/domain/story/conversation.ts` 及测试。
- 新增 `apps/server/src/domain/story/message.ts` 及测试。
- 新增 `apps/server/src/domain/story/story-generation-request.ts` 及测试。
- 新增对话创建、列表、重命名、归档应用用例及测试。
- 新增消息追加、消息列表应用用例及测试。
- 新增对话、消息、生成请求仓储端口及 Prisma 实现。
- 新增 `apps/server/src/modules/story/http/conversations.controller.ts`。
- 新增 `apps/server/src/modules/story/http/messages.controller.ts`。

### 实施步骤

1. 测试归档项目不能创建对话，归档对话不能追加消息，历史消息仍可读取。
2. 实现按创建时间和 UUID 组成的稳定游标分页。
3. 在一个事务内保存用户消息、待处理生成请求和幂等结果。
4. 重复同一消息幂等请求返回原消息和生成请求；同一键不同内容返回冲突。
5. 消息正文追加后不可原地修改，归档对话不删除消息。
6. 验证项目权限在每个对话和消息用例入口重新执行。

### 验收

- 一个故事项目可包含多个独立对话。
- 分页没有重复或遗漏稳定数据。
- 幂等重试不会产生重复消息或生成请求。
- 归档不破坏消息、成果或未来版本的来源关系。

### 提交

`feat(server): persist story conversations`

## 12. 切片 S09：模拟 Agent 与生成恢复

### 目标

通过稳定端口生成可预测草稿，并在请求失败或进程中断后安全接续原生成请求。

### 文件

- 新增 `apps/server/src/integrations/agent/agent-gateway.ts`。
- 新增 `apps/server/src/integrations/agent/agent-contracts.ts`。
- 新增 `apps/server/src/integrations/agent/mock-agent-gateway.ts` 及测试。
- 新增 `apps/server/src/domain/story/story-result.ts` 及草稿创建不变量测试。
- 新增 `apps/server/src/modules/story/application/generate-story-draft.ts` 及测试。
- 新增 `apps/server/src/modules/story/application/retry-story-generation.ts` 及测试。
- 新增 `apps/server/src/modules/story/http/generation-requests.controller.ts`。
- 修改 Prisma Schema，新增草稿成果迁移。
- 新增成果仓储端口及 Prisma 实现。

### 实施步骤

1. 定义只包含授权上下文、输入快照、能力范围和幂等键的 Agent 请求契约。
2. 测试模拟实现对相同规范化输入产生相同草稿，并可注入可分类失败。
3. 在保存用户消息的事务完成后调用 Agent，禁止持有数据库事务等待外部端口。
4. 成功时在第二个事务保存 Agent 消息、`StoryResult` 和生成状态。
5. 失败时保存安全失败类别；重试复用原生成请求和消息。
6. 模拟进程在两个事务之间退出，验证重复原请求或显式重试可以接续且不重复用户消息。

### 验收

- 模拟草稿可预测且不依赖真实模型。
- Agent 请求不包含数据库凭据或未授权业务数据。
- 失败与未完成生成可查询、可重试。
- 接续过程不重复消息、草稿或生成请求。

### 提交

`feat(server): add mock story generation`

## 13. 切片 S10：草稿编辑与确认版本

### 目标

实现草稿状态机、乐观并发、不可变版本和项目当前有效版本。

### 文件

- 修改 Prisma Schema，新增故事版本迁移。
- 扩展 `apps/server/src/domain/story/story-result.ts` 的编辑、放弃和确认状态测试。
- 新增 `apps/server/src/domain/story/story-version.ts` 及测试。
- 新增草稿编辑、放弃、确认、版本列表应用用例及测试。
- 新增版本仓储端口及 Prisma 实现。
- 新增 `apps/server/src/modules/story/http/story-results.controller.ts`。
- 新增 `apps/server/src/modules/story/http/story-versions.controller.ts`。

### 实施步骤

1. 测试只有 `draft` 可编辑或放弃，`confirmed` 与 `discarded` 不可修改。
2. 测试草稿修订冲突、项目修订冲突和项目内递增版本号。
3. 在一个事务内创建不可变版本、确认草稿、切换项目当前版本并写审计。
4. 为重复确认建立数据库唯一约束和应用幂等返回。
5. 验证确认较早但仍为草稿的成果会创建新版本，不修改旧版本。
6. 验证归档对话或项目不会级联删除成果与版本。

### 验收

- 草稿修改必须携带正确修订号。
- 重复确认返回同一版本。
- 已确认版本内容不可变且可以追溯来源消息、对话、生成请求和确认人。
- 项目当前版本与审计记录在并发竞争下保持一致。

### 提交

`feat(server): confirm immutable story versions`

## 14. 切片 S11：OpenAPI 与整体验收

### 目标

冻结首批 API 契约，完成跨租户全链路验收和运行文档。

### 文件

- 补充所有 HTTP DTO 的 OpenAPI 描述和稳定错误码。
- 新增 `apps/server/src/test/multi-tenant-story.e2e.test.ts`。
- 新增 `apps/server/src/test/security-boundaries.e2e.test.ts`。
- 新增或更新 `apps/server/.env.example`。
- 更新 `apps/server/AGENTS.md`、根 `README.md` 和后端设计状态。

### 实施步骤

1. 安装 `@nestjs/swagger`，生成并检查 `/v1` OpenAPI 文档，健康接口保持非版本化。
2. 端到端演示两个用户、两个团队和一个跨团队用户的隔离场景。
3. 覆盖登录、团队邀请、项目权限、私人访问审计、对话、模拟草稿和版本确认。
4. 覆盖幂等键冲突、乐观并发冲突、令牌复用、Origin 拒绝和 Agent 失败重试。
5. 在新建测试数据库上从零执行全部迁移和测试。
6. 运行根级测试、类型检查、代码检查、构建、格式检查和 Git 差异检查。

### 验收

- 设计文档中的完成定义全部有自动化证据。
- OpenAPI、实际响应和错误码一致。
- 新开发者只使用仓库文档即可启动 Server、数据库和测试。
- 工作区无生成文件、凭据或机器专属配置。

### 提交

`test(server): verify multi-tenant story backend`

## 15. 最终验证

S11 完成后，在没有后续文件改动的情况下执行：

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

真实 PostgreSQL 验收必须覆盖全新迁移和非空数据库升级。只有所有命令成功、工作区状态符合预期、完成定义逐项有证据后，才能宣告后端框架里程碑完成。

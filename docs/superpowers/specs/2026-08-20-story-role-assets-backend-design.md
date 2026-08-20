# 角色资产后端持久化与服务端 UUID 设计

## 背景

当前角色资产仍由 Web 端静态数据和 `localStorage` 驱动。角色主键使用
`lin-yao`、`zhou-yan` 等前端固定字符串，角色编辑页虽然将 ID 设置为只读，
但仍向用户展示该字段。服务端尚不存在角色资产表、项目级角色资产接口或
角色资产授权边界。

角色资产应成为故事项目下的正式业务资源。客户端不得创建、指定或修改角色
主键；UUID、权限判断、持久化、并发控制和审计均由 Server 与 PostgreSQL
负责。

## 目标

- 为个人和团队故事项目提供持久化角色资产。
- 由服务端生成角色 UUID，创建请求不接受客户端 ID。
- 提供角色资产列表、创建、读取、更新和归档接口。
- 复用现有故事项目的查看、编辑、归档、协作者和租户边界。
- 使用乐观锁防止并发更新相互覆盖。
- 让 Web 端以后端数据为唯一权威来源，并移除用户可见的角色 ID 字段。
- 为以后世界观、剧情关系和 Agent 上下文引用角色 UUID 保留稳定边界。

## 非目标

- 本次不把角色之间的关系拆成独立关系图。
- 本次不建立角色分类、阵营或剧情功能字典表。
- 本次不把角色资产继续存储为 `StoryArtifact` JSON 内容。
- 本次不把“雾城”示例角色自动插入所有真实项目。
- 本次不自动迁移浏览器 `localStorage` 中的临时编辑数据。
- 本次不实现角色头像、媒体资产或角色版本历史。

## 方案选择

采用独立 `story_role_assets` 表，把每个角色建模为 Story 模块中的项目子资源。

未采用以下方案：

- 将所有角色继续存入 `StoryArtifact` JSON：无法自然提供逐角色 UUID、权限、
  并发控制和独立更新。
- 立即拆分角色分类表、剧情功能表和多张关联表：当前字段规模和查询方式不需要
  这部分复杂度。

## 数据模型

新增 Prisma 模型 `StoryRoleAsset`，映射到 PostgreSQL 表
`story_role_assets`。

| 字段 | PostgreSQL 类型 | 约束与含义 |
| --- | --- | --- |
| `id` | `uuid` | 主键；应用层生成，数据库保留 UUID 默认值作为兜底 |
| `tenant_id` | `uuid`，可空 | 团队项目的租户；个人项目为空 |
| `project_id` | `uuid` | 所属故事项目，不可空 |
| `category` | `varchar(32)` | `protagonists`、`core`、`supporting`、`background` |
| `name` | `varchar(100)` | 去除首尾空白后长度为 1–100 |
| `occupation` | `varchar(200)` | 身份或职业，可为空字符串 |
| `summary` | `text` | 核心印象 |
| `desire` | `text` | 角色目标 |
| `mainline_relation` | `text` | 与故事主线的关系描述 |
| `narrative_order` | `varchar(16)` | `一号`、`二号`、`三号`、`未设定` |
| `gender` | `varchar(16)` | `男`、`女`、`未设定` |
| `camp` | `varchar(32)` | `主角方`、`对立方`、`中立`、`立场变化` |
| `prominence` | `varchar(16)` | `核心`、`高频`、`低频`、`背景` |
| `functions` | `text[]` | 剧情功能字符串数组，默认空数组 |
| `revision` | `integer` | 乐观锁版本，从 1 开始 |
| `created_by_user_id` | `uuid` | 创建用户 |
| `updated_by_user_id` | `uuid` | 最近更新用户 |
| `created_at` | `timestamptz(3)` | 创建时间 |
| `updated_at` | `timestamptz(3)` | 更新时间 |
| `archived_at` | `timestamptz(3)`，可空 | 归档时间；为空代表活跃角色 |

角色名称不设唯一约束，同一故事允许存在重名角色。

数据库需要保证：

- `project_id` 引用 `story_projects.id`，防止孤立角色。
- `tenant_id` 引用 `teams.id`；服务端事务保证它与所属项目的租户一致。
- 分类、叙事顺序、性别、阵营和戏份均通过数据库 `CHECK` 约束限制取值。
- `revision >= 1`。
- 建立 `(project_id, archived_at, category, created_at, id)` 查询索引。
- 建立 `(tenant_id, project_id, id)` 租户范围索引。

## UUID 所有权

创建角色时，应用用例通过可注入的 `ids.create()` 生成 UUID。该模式与 Story
模块现有 ID 生成方式一致，并允许单元测试注入确定性 ID。

数据库 `id` 字段同时保留 `@default(uuid())` 作为存储层兜底，但正常应用请求
始终由服务端显式提供生成后的 UUID。

创建 DTO 不声明 `id`。角色资产控制器对请求体启用白名单和
`forbidNonWhitelisted: true`；客户端一旦提交 `id`，接口返回 400，而不是静默
接受、覆盖或忽略。

API 响应会返回 `id`，但它只作为路由参数、实体引用和接口资源键。Web 端不再
显示“角色 ID”输入框或允许用户修改 ID。

## 领域模型与校验

新增 `StoryRoleAsset` 领域模型，负责：

- 创建和恢复角色快照。
- 校验受约束字符串取值。
- 修剪名称等文本字段，并限制名称长度。
- 更新可编辑字段并递增 `revision`。
- 根据 `expectedRevision` 检测并发冲突。
- 归档角色且保持 UUID 和历史内容不变。

数组输入需要过滤首尾空白和空项，并保持用户提交顺序。相同剧情功能是否允许
重复由领域模型统一处理；本方案选择去重，保留第一次出现的位置。

## Repository 边界

新增 `StoryRoleAssetRepository` 端口和 Prisma 实现，包含：

- `create`
- `findById`
- `findByIdLocked`
- `listByProject`
- `update`

所有查询都必须显式接收 `tenantId` 和 `projectId`。个人项目使用
`tenantId: null`；团队项目必须同时匹配租户和项目，不能只根据角色 UUID 查询。

列表默认只返回 `archived_at IS NULL` 的角色，按分类、叙事顺序、创建时间和 UUID
稳定排序。单项读取默认只读取活跃角色；归档角色仅保留在数据库和审计历史中。

## 应用用例

新增以下应用用例：

- `ListStoryRoleAssets`
- `CreateStoryRoleAsset`
- `GetStoryRoleAsset`
- `UpdateStoryRoleAsset`
- `ArchiveStoryRoleAsset`

每个用例先通过现有项目授权边界读取项目：

- 查看列表和单项要求项目查看权限。
- 创建、更新和归档要求项目编辑权限。
- 已归档项目拒绝创建、更新和归档角色。
- 不可访问、租户不匹配、项目不匹配和角色不存在统一映射为不暴露资源存在性的
  404/访问错误语义，遵循现有 Story 模块规则。

创建、更新和归档在数据库事务中写入角色资产与审计记录。创建接口还复用现有
幂等键、请求指纹和幂等结果机制。

## HTTP API

个人项目接口：

```text
GET    /v1/me/story-projects/{projectId}/role-assets
POST   /v1/me/story-projects/{projectId}/role-assets
GET    /v1/me/story-projects/{projectId}/role-assets/{roleId}
PATCH  /v1/me/story-projects/{projectId}/role-assets/{roleId}
DELETE /v1/me/story-projects/{projectId}/role-assets/{roleId}
```

团队项目接口：

```text
GET    /v1/teams/{teamId}/story-projects/{projectId}/role-assets
POST   /v1/teams/{teamId}/story-projects/{projectId}/role-assets
GET    /v1/teams/{teamId}/story-projects/{projectId}/role-assets/{roleId}
PATCH  /v1/teams/{teamId}/story-projects/{projectId}/role-assets/{roleId}
DELETE /v1/teams/{teamId}/story-projects/{projectId}/role-assets/{roleId}
```

`projectId`、`teamId` 和 `roleId` 都使用 UUID v4 校验。

### 创建

`POST` 请求要求 `Idempotency-Key`，请求体仅包含可编辑业务字段，不包含 `id`、
租户、项目、revision、审计用户或时间字段。成功返回 201：

`category` 和 `name` 为必填字段；其余字段使用服务端默认值：文本字段为空字符串，
`narrativeOrder` 和 `gender` 为 `未设定`，`camp` 为 `中立`，`prominence` 为
`背景`，`functions` 为空数组。客户端可以在创建时显式覆盖这些默认值。

```json
{
  "roleAsset": {
    "id": "6ad5fcdf-5239-47d7-bfa5-8766e7395a9f",
    "projectId": "...",
    "category": "protagonists",
    "name": "林遥",
    "occupation": "档案修复师",
    "revision": 1,
    "archivedAt": null,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

### 更新

`PATCH` 请求包含一个或多个可编辑字段，并强制包含 `expectedRevision`。版本不一致
返回 409 `STORY_ROLE_ASSET_REVISION_CONFLICT`；成功后 revision 加一并返回最新
角色。

### 归档

`DELETE` 不物理删除记录。客户端通过查询参数 `expectedRevision` 提交当前版本；
成功时设置 `archived_at`、递增 revision，并返回 204。缺少或使用无效版本参数返回
400，版本不一致返回 409 `STORY_ROLE_ASSET_REVISION_CONFLICT`。

如果角色仍被正式持久化的世界观实体、剧情关系或其他业务记录引用，接口返回
409 `STORY_ROLE_ASSET_IN_USE`。当前这些引用尚未落到服务端表时，归档用例通过
独立引用检查端口实现空检查；以后新增引用表时扩展该端口，而不修改 HTTP 契约。

## 错误映射

新增稳定错误码：

- `STORY_ROLE_ASSET_NOT_FOUND`：角色不存在、已归档或不属于指定项目。
- `STORY_ROLE_ASSET_INVALID`：业务字段校验失败。
- `STORY_ROLE_ASSET_REVISION_CONFLICT`：更新或归档版本冲突。
- `STORY_ROLE_ASSET_IN_USE`：角色仍被其他正式资源引用。
- 现有项目无权编辑、项目归档和幂等键冲突继续使用 Story 模块已有错误码。

## 审计

角色写操作记录以下审计动作：

- `STORY_ROLE_ASSET_CREATED`
- `STORY_ROLE_ASSET_UPDATED`
- `STORY_ROLE_ASSET_ARCHIVED`

审计目标类型为 `STORY_ROLE_ASSET`，目标 ID 为角色 UUID。摘要只记录必要业务字段
和 revision，不记录完整长文本，避免审计表膨胀。

## Web 集成

`apps/web` 的 `story-api.ts` 增加个人项目和团队项目角色资产 API 类型与方法。
角色资产工作区根据已经加载的项目空间信息选择正确接口，不通过尝试两套接口来
猜测项目归属。

Web 端改造包括：

- 角色资产列表从 Server 加载，并覆盖加载中、空列表、失败和重试状态。
- 编辑页根据路由中的 UUID 获取角色。
- 创建请求不发送 ID，成功后使用响应 UUID 导航到编辑页。
- 更新请求发送 `expectedRevision`。
- 移除角色 ID 表单字段和标题中的用户可见 ID。
- 移除 `story-role-assets.ts` 的 `localStorage` 权威存储职责；只保留必要的显示枚举和
  类型，或将其拆到无状态模型文件。
- 服务端数据加载成功后不再回退到浏览器中的旧固定 ID 数据，避免形成双写和两个
  权威来源。

现有示例角色不写入所有项目。开发环境需要展示“雾城”示例时，通过明确的开发
seed 或项目模板调用服务端创建流程生成 UUID。

## 测试策略

### Server 单元测试

- 创建请求不能指定 ID，服务端生成 UUID。
- 字段校验、剧情功能去重和文本修剪。
- 项目查看与编辑权限。
- 个人项目与团队项目的租户隔离。
- 已归档项目拒绝写操作。
- 创建幂等性与幂等键冲突。
- 更新和归档的 revision 冲突。
- 角色被引用时拒绝归档。
- 审计记录与角色写入处于同一事务。

### Server HTTP 与 PostgreSQL 测试

- DTO 拒绝客户端 `id`。
- 路径参数拒绝非 UUID。
- PostgreSQL 实际生成或接受服务端 UUID，并满足外键、CHECK 和索引约束。
- 角色不能跨项目或跨租户读取、更新、归档。
- 个人项目的 `tenant_id IS NULL` 边界正确。

### Web 测试

- API adapter 不发送角色 ID。
- 列表和编辑页使用服务端 UUID。
- 更新请求携带最新 revision。
- 编辑页不显示角色 ID 表单字段。
- 加载、空列表、错误、重试、保存冲突和无权限状态。

### 页面验证

- 桌面和窄屏访问角色资产列表、创建和编辑页面。
- 新建角色后 URL 使用服务端返回 UUID。
- 刷新页面后角色数据仍然存在。
- 客户端无法通过请求体指定或修改角色 ID。

## 实施顺序

1. 增加 Prisma 模型、SQL migration 和数据库约束。
2. 增加领域模型、Repository 端口与 Prisma 实现。
3. 增加应用用例、授权、事务、幂等和审计。
4. 增加个人项目与团队项目 HTTP 接口和 DTO。
5. 增加 Web API adapter 并把角色列表、创建和编辑切换到服务端。
6. 移除 Web 端角色 ID 展示与 `localStorage` 权威状态。
7. 运行 Server/Web 测试、类型检查、构建、migration 检查和浏览器验证。

## 完成标准

- 任何角色创建接口都不接受客户端 ID。
- 新角色获得服务端生成的有效 UUID，并以该 UUID 作为资源路由参数。
- 角色数据写入 PostgreSQL，刷新页面后保持不变。
- 个人项目和团队项目都遵守现有访问控制和租户隔离。
- 并发更新不会静默覆盖，删除不会破坏正式资源引用。
- Web 页面不再向用户显示或要求填写角色 ID。
- 相关测试、类型检查、构建和数据库边界验证通过。

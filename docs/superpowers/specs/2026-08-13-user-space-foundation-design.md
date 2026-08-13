# 用户空间模型基础切片设计

## 状态

- 状态：待实现前审阅
- 日期：2026-08-13
- 依据：C 端用户体系与权限设计、C 端用户体系数据库表设计
- 范围：建立个人空间和团队空间的持久化基础
- 非目标：本切片不迁移项目归属、协作者、权限覆盖、审计范围或现有 `tenant_id` 模型

## 1. 目标

完成用户体系的第一个可独立验证切片：

- 每个用户最多且最终拥有一个个人空间。
- 每个团队最多且最终拥有一个团队空间。
- 个人空间和团队空间由统一 `spaces` 表表示。
- 创建团队时，团队、团队空间和初始 `admin` 成员关系在一个事务中提交。
- 身份登录首次创建用户时，用户和个人空间在一个事务中提交。
- 重复登录或重复创建团队不会产生重复空间。

本切片只建立数据基础，不改变现有项目接口的授权语义。项目仍按照当前实现工作，后续切片再迁移到 `story_projects.space_id`。

## 2. 目标数据模型

### `spaces`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `UUID` | 主键 |
| `kind` | `VARCHAR(16)` | `personal` / `team` |
| `owner_user_id` | `UUID` nullable | 个人空间的用户归属；团队空间必须为空 |
| `owner_team_id` | `UUID` nullable | 团队空间的团队归属；个人空间必须为空 |
| `created_at` | `TIMESTAMPTZ(3)` | 创建时间 |
| `updated_at` | `TIMESTAMPTZ(3)` | 更新时间 |

数据库约束：

- `kind = personal` 时，`owner_user_id` 非空且 `owner_team_id` 为空。
- `kind = team` 时，`owner_team_id` 非空且 `owner_user_id` 为空。
- `UNIQUE (owner_user_id) WHERE kind = 'personal'`。
- `UNIQUE (owner_team_id) WHERE kind = 'team'`。
- `owner_user_id` 外键到 `users.id`，删除策略为 `RESTRICT`。
- `owner_team_id` 外键到 `teams.id`，删除策略为 `RESTRICT`。

`users` 和 `teams` 不增加 `personal_space_id` 或 `team_space_id` 反向冗余字段；空间归属以 `spaces` 为唯一来源。

## 3. 领域与应用边界

### `Space` 领域类型

新增框架无关的 `Space` 类型和值对象，至少提供：

- `SpaceKind = personal | team`。
- `Space.createPersonal({ id, ownerUserId, createdAt })`。
- `Space.createTeam({ id, ownerTeamId, createdAt })`。
- `toSnapshot()` 返回持久化端口需要的稳定数据。

领域类型负责检查 owner 与 kind 的互斥关系；数据库负责最终约束。领域层不导入 Prisma、NestJS 或 HTTP DTO。

### 空间仓储端口

新增最小端口，不暴露 ORM 类型：

- `findPersonalByUserId(userId)`。
- `findTeamByTeamId(teamId)`。
- `create(space)`。

这些端口由 `SpacesModule` 提供。`IdentityModule` 和 `TenancyModule` 只依赖 `SpacesModule` 导出的端口，不直接依赖 Prisma 或读取 `spaces` 表。

本切片不新增面向终端用户的空间 Controller。空间会随用户、团队和后续项目查询返回；单独的空间 API 等授权模型稳定后再增加。

## 4. 事务接入

### 首次创建用户

身份模块当前通过 `findOrCreateByEmail` 完成登录时用户创建。该操作需要扩展为：

```text
锁定或创建 users
  → 查询个人空间
  → 不存在时创建 personal space
  → 返回用户
  → 与当前登录挑战消费、会话创建保持原有事务边界
```

并发登录时由个人空间部分唯一索引兜底；重复键冲突必须转换为重新读取已存在空间，而不能让成功登录因空间初始化竞态失败。

现有用户在迁移部署时通过数据迁移补齐个人空间。应用运行期间的 `findOrCreateByEmail` 仍需具备幂等补齐能力，以覆盖迁移后新用户和异常恢复。

### 创建团队

现有 `CreateTeam` 用例的事务扩展为：

```text
锁定创建者用户或团队创建范围
  → 插入 teams
  → 插入 team space
  → 插入初始 team_memberships(role=admin)
  → 写入现有幂等记录和团队审计记录
  → 提交
```

团队空间创建失败时，团队、成员、幂等记录和审计记录全部回滚。重复幂等请求返回原团队，不插入第二个团队空间。

团队创建者的个人空间不在创建团队事务中重复创建；它由首次创建用户流程保证，若历史用户缺失则由个人空间补齐逻辑创建。

## 5. 迁移策略

新增一条 Prisma migration，按以下顺序执行：

1. 创建 `spaces` 表。
2. 添加 `kind`、owner 字段的 `CHECK` 约束。
3. 添加 owner 外键和两个部分唯一索引。
4. 为所有现有用户插入个人空间；插入必须可重复执行。
5. 为所有现有团队插入团队空间；插入必须可重复执行。
6. 验证每个用户和每个团队恰好一个对应空间。

现有团队只需要存在于 `teams` 表即可完成团队空间回填，不需要依赖创建者或有效管理员数据；`spaces.owner_team_id` 直接引用团队主键。回填完成后，所有新建团队必须通过同一事务创建团队空间。

迁移不修改 `story_projects`、`conversations`、`messages`、`assets` 或其他项目子表，也不删除 `tenant_id`、`visibility` 等旧字段。

## 6. 测试验收

### 领域测试

- personal space 必须有 `owner_user_id`，不能有 `owner_team_id`。
- team space 必须有 `owner_team_id`，不能有 `owner_user_id`。
- 非法 kind/owner 组合被拒绝。

### 应用测试

- 首次登录创建一个用户和一个个人空间。
- 已有用户再次登录不创建第二个个人空间。
- 并发首次登录最终只有一个个人空间。
- 创建团队同时创建团队空间和 `admin` 成员关系。
- 创建团队事务失败时不残留团队空间。
- 重放创建团队幂等键不产生第二个团队或团队空间。

### PostgreSQL 边界测试

- 部分唯一索引阻止同一用户拥有两个个人空间。
- 部分唯一索引阻止同一团队拥有两个团队空间。
- 数据库拒绝 kind 与 owner 字段不匹配的记录。
- 删除仍被空间引用的用户或团队被 `RESTRICT` 拒绝。

## 7. 后续切片边界

本切片完成后，后续实现按以下顺序推进：

1. 将项目增加 `space_id` 和 `owner_user_id`。
2. 迁移项目子表到目标父级关系。
3. 增加协作者角色、撤销状态和权限覆盖上限。
4. 统一个人空间、团队空间、所有者和管理员授权策略。

后续切片不得在本切片中提前修改项目授权，避免空间基础和项目迁移处于不可验证的半完成状态。

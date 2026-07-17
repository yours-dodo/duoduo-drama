# TypeScript + pnpm Monorepo 基础架构设计

## 背景

多多短剧当前处于产品规划和核心领域模型设计阶段，仓库尚未引入应用代码、构建系统或测试框架。第一版工程基础架构需要支持 Web 工作台、业务服务端和独立 Agent 服务，并为移动端预留位置，同时避免在业务边界尚未稳定时过早引入数据库、队列或部署方案。

## 目标

- 使用 TypeScript 和 pnpm workspace 建立统一的 monorepo。
- 为 Nuxt Web、NestJS Server 和 Hono Agent 提供可独立开发、构建和测试的工程骨架。
- 为移动端保留明确位置，但暂不选择框架或生成应用代码。
- 建立领域模型、跨服务契约和通用代码的共享边界。
- 提供一致的格式化、静态检查、类型检查和测试命令。
- 允许将外部参考项目放入本地 `vendor/` 目录供 AI 分析，同时确保正式代码和 CI 不依赖它们。

## 非目标

本次基础架构不包含：

- 数据库、迁移或种子数据。
- 用户认证、权限和具体业务接口。
- 任务队列、独立 Worker 或长任务调度。
- AI 模型、提示词或工具的实际接入。
- Server 与 Agent 的真实网络调用。
- 移动端框架选型和应用实现。
- Docker、持续集成和生产部署配置。

## 仓库结构

```text
apps/
├── web/             # Nuxt + TypeScript Web 工作台
├── server/          # NestJS + TypeScript 业务服务
└── mobile/          # 移动端预留目录及说明
agent/               # Hono + TypeScript 独立 Agent 服务
packages/
├── contracts/       # Server 与 Agent 的通信契约
├── domain/          # 与框架无关的领域模型和业务规则
├── shared/          # 无领域含义的通用工具和基础类型
├── config/          # 环境配置读取与校验
└── tsconfig/        # 共享 TypeScript 配置
vendor/
└── README.md        # 外部参考项目的使用规范
```

`apps/server` 与 `agent` 是两个独立的运行单元。`agent` 与 `apps/` 同级，以突出 Agent 是产品核心子系统，而不是某个客户端或普通业务应用。

## 模块职责

### Web

`apps/web` 使用 Nuxt 和 TypeScript，承担完整 Web 工作台的用户界面。基础架构阶段只提供框架默认的最小可运行页面和必要脚本，不实现业务功能。

### Server

`apps/server` 使用 NestJS 和 TypeScript，未来负责认证授权、团队与项目业务、持久化、面向客户端的 API，以及对 Agent 的任务发起和状态查询。基础架构阶段只提供健康检查或等价的最小接口。

### Agent

`agent` 使用运行于 Node.js 的 Hono 和 TypeScript，未来负责模型接入、上下文组装、提示词管理、工具调用和 Agent 流程。它作为独立服务对 Server 暴露接口，基础架构阶段只提供健康检查或等价的最小接口。

选择 Node.js 作为 Agent 的首期运行时，使其与 NestJS 共用依赖生态和开发环境。未来若明确需要边缘运行时，可在评估依赖兼容性后调整。

### Mobile

`apps/mobile` 只包含范围和后续选型说明，不生成虚假的可运行应用。确定 React Native、原生或其他跨端方案后，再将其转换为正式 workspace。

### 共享包

- `packages/domain` 保存不依赖 Nuxt、NestJS、Hono 或基础设施的领域对象和业务规则。
- `packages/contracts` 保存 Server 与 Agent 之间的 DTO、错误结构和接口契约，不包含服务实现。
- `packages/shared` 只保存没有领域含义、且确实被多个 workspace 使用的通用代码。
- `packages/config` 提供统一的环境配置读取和校验能力，但各运行单元拥有自己的配置入口。
- `packages/tsconfig` 提供基础 TypeScript 配置，各 workspace 根据运行环境扩展。

## 依赖与通信边界

目标依赖方向为：

```text
Web / Mobile -> Server -> Agent
                    |        |
                    +--> contracts / domain <--+
```

- Web 和未来的 Mobile 只通过 Server 的公开 API 使用业务能力。
- Server 与 Agent 不直接导入彼此的源码。
- Server 与 Agent 通过 `packages/contracts` 共享静态协议定义。
- `packages/domain` 不依赖任何应用或框架。
- `packages/shared` 不允许成为绕过模块边界的杂物目录。
- 基础架构阶段不建立 Server 到 Agent 的真实调用；通信方式在接口与任务模型设计完成后确定。

长任务初期不单独创建 Worker。当模型生成、文件处理或视频任务需要持久化队列、故障恢复或独立扩缩容时，再设计 Worker 运行单元。

## Workspace 与构建策略

根目录使用 `pnpm-workspace.yaml` 管理 `apps/*`、`agent` 和 `packages/*`。尚不可运行的 `apps/mobile` 不声明 package manifest，因此不会参与 workspace 命令。

不引入 Turborepo 或 Nx。根目录脚本使用 pnpm workspace 的递归执行能力，统一暴露：

- `pnpm dev`：并行启动 Nuxt Web、NestJS Server 和 Hono Agent 的开发进程；移动端不参与。
- `pnpm build`：构建所有可构建 workspace。
- `pnpm typecheck`：执行 TypeScript 类型检查。
- `pnpm lint`：执行 ESLint。
- `pnpm format`：使用 Prettier 格式化受管文件。
- `pnpm format:check`：检查格式但不修改文件。
- `pnpm test`：执行 Vitest 测试。

应用和共享包保留独立脚本，使开发者既能从根目录运行全量检查，也能通过 pnpm filter 操作单个 workspace。

第一版优先采用简单的 workspace 源码引用和各应用自身的构建器。暂不引入 TypeScript Project References 或强制所有包发布 `dist/`，待共享包数量、发布需求或构建性能证明有必要时再升级。

## 代码质量与测试

- TypeScript 开启严格类型检查。
- ESLint 提供 TypeScript 基础静态检查；Nuxt 和 NestJS 所需规则在各自 workspace 扩展。
- Prettier 统一 Markdown、JSON、YAML、TypeScript 和 Vue 文件格式。
- Vitest 用于共享包和适合的应用单元测试。
- Nuxt、NestJS 和 Hono 各至少提供一个与骨架范围匹配的冒烟验证。
- 根目录命令必须能够在全新检出并安装依赖后复现。

## 错误处理

基础架构阶段只定义最低要求：

- Server 和 Agent 启动时对缺失或无效配置快速失败，并给出可定位的错误信息。
- HTTP 服务使用稳定的 JSON 错误外形，不向调用方泄漏堆栈或敏感配置。
- 后续跨服务错误码和重试语义必须在 `packages/contracts` 中显式设计，而不是由 NestJS 或 Hono 的默认异常格式决定。

## 外部参考项目

`vendor/` 用于保存从外部拉取、供开发者和 AI 阅读的参考项目。它遵循以下规则：

- `.gitignore` 忽略 `vendor/*`，仅提交 `vendor/README.md`。
- `vendor/` 不属于 pnpm workspace，不参与构建、检查和测试。
- 正式代码不得导入或运行时依赖 `vendor/` 中的内容。
- 拉取参考项目时使用 `vendor/<project-name>/`，必要时记录来源仓库、固定 commit 和许可证。
- AI 可以分析其架构和实现思路，但不得直接复制不符合许可证要求的代码。
- CI 和其他开发者不需要拥有这些参考项目也能完成全部正式构建与测试。

## 验收标准

基础架构完成时应满足：

1. 使用仓库声明的 pnpm 版本可一次安装所有正式依赖。
2. Nuxt Web、NestJS Server 和 Hono Agent 能分别启动。
3. `build`、`typecheck`、`lint`、`format:check` 和 `test` 根命令全部通过。
4. 各运行单元和共享包的依赖方向符合本设计。
5. Mobile 目录清楚说明其预留状态，不伪装为已实现应用。
6. `vendor/` 中的本地参考项目不会被 Git 跟踪，也不会影响 workspace 命令。
7. README 和 AGENTS.md 记录新增顶层目录与可复现命令。

## 后续演进条件

- 确定 Server/Agent 任务模型后，设计通信 API、错误码、幂等与重试语义。
- 出现长时间任务、持久化恢复或独立扩缩容需求后，设计队列和 Worker。
- 确定移动端技术路线后，将 `apps/mobile` 转为正式 workspace。
- 出现明显构建性能问题或包发布需求后，再评估 Turborepo、Nx、Project References 或独立产物构建。

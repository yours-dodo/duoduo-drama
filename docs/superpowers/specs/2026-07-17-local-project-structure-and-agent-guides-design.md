# 项目内聚目录与分层 AGENTS.md 设计

## 背景

仓库初始化时创建了 `packages/domain`、`packages/contracts`、`packages/shared`、`packages/config` 和 `packages/tsconfig`。这些包表达了潜在的长期边界，但当前只有少量骨架代码，业务模型和服务通信协议尚未形成。继续保留这些抽象会增加文件跳转和理解成本，并容易让开发者误以为边界已经稳定。

本设计以“代码先靠近唯一真实使用者”为原则简化目录，并为每个独立项目建立可被 Codex 自动识别的 `AGENTS.md`。本设计取代 `2026-07-17-typescript-pnpm-monorepo-design.md` 中关于 `packages/*` 共享包的目录方案；该文档的 Nuxt、NestJS、Hono、pnpm、ESLint、Prettier 和 Vitest 选择继续有效。

## 目标

- 删除当前没有真实复用价值的 `packages/*` 工作区。
- 将领域、配置和集成代码放回负责它们的应用。
- 使用根目录 TypeScript 配置消除重复，而不为配置创建 workspace 包。
- 为 Web、Server、Mobile、Agent 和 Vendor 编写职责明确的目录级 `AGENTS.md`。
- 让目录级规则继承根规则，只补充局部信息，避免重复和规则漂移。
- 为未来提取共享模块定义清晰条件，而不是永久禁止共享包。

## 非目标

- 本次不实现新的业务功能、数据库或 Server/Agent 调用。
- 不设计完整的领域模型或通信 API。
- 不选择或初始化移动端框架。
- 不引入 OpenAPI、JSON Schema 或代码生成工具。
- 不为 `src/` 下的每个子目录创建 `AGENTS.md`。

## 简化后的仓库结构

```text
AGENTS.md
tsconfig.base.json
apps/
├── web/
│   ├── AGENTS.md
│   └── app/
├── server/
│   ├── AGENTS.md
│   └── src/
│       ├── domain/
│       ├── modules/
│       └── integrations/
│           └── agent/
└── mobile/
    ├── AGENTS.md
    └── README.md
agent/
├── AGENTS.md
└── src/
    ├── config/
    ├── contracts/
    ├── tools/
    └── workflows/
vendor/
├── AGENTS.md
└── README.md
```

目录只在出现真实代码时创建。结构图中的 Server 和 Agent 子目录表达代码归属规则，不要求本次为了占位创建空目录。

## 代码归属

### Web

`apps/web` 负责 Nuxt 页面、组件、组合式函数、客户端状态和面向 Server 的 API 适配。核心业务规则不能只存在于 Web；Web 也不能绕过 Server 直接调用 Agent。

### Server

`apps/server` 是产品业务规则和数据访问的所有者：

- `src/domain`：框架无关的领域对象、值对象和业务规则。
- `src/modules`：NestJS 业务模块和应用用例。
- `src/integrations/agent`：调用 Agent 的客户端、请求映射和响应映射。
- Server 自己的环境配置保留在 Server 内部。

领域代码不得依赖 NestJS Controller、数据库 ORM 或 Agent 实现。即使物理上位于 Server，仍保持纯 TypeScript，以便未来在确有复用需求时安全提取。

### Agent

`agent` 负责模型接入、上下文组装、提示词、工具调用和 Agent 工作流：

- `src/config`：Agent 独有的模型和运行时配置。
- `src/contracts`：Agent 对外 HTTP 接口的数据外形。
- `src/tools`：Agent 可调用工具及适配器。
- `src/workflows`：任务编排和工作流。

Agent 不直接导入 Server 源码，也不直接操作 Server 数据库。需要业务数据时必须通过已定义的服务接口获取。

### 通信契约

基础阶段允许 Server 和 Agent 在各自边界内维护少量请求与响应类型，避免为健康检查等临时协议保留独立包。出现真实通信 API 后，应选择一个运行时可验证的协议来源，例如 OpenAPI 或 JSON Schema，再生成或共享类型。

只有当协议稳定、两端重复维护已经造成实际成本时，才评估恢复 `packages/contracts`。

### 通用代码

工具函数先放在实际使用它的项目中。只有同时满足以下条件才提取共享包：

1. 至少有两个真实消费者。
2. 代码语义在消费者之间完全一致，而非表面实现相似。
3. 公共接口已经稳定。
4. 提取后不会引入反向依赖或隐藏业务归属。

因此本次删除 `packages/shared` 和示例 `unreachable` 函数。

### 配置

Server 与 Agent 分别拥有自己的环境变量定义和校验入口。可以在各项目内部实现小型校验函数；只有出现相同且稳定的配置基础设施需求后，才考虑共享实现。本次删除 `packages/config` 及其演示函数。

### TypeScript 配置

删除 `packages/tsconfig`，在仓库根目录创建 `tsconfig.base.json`。Node 项目直接继承根配置，并在自身 `tsconfig.json` 中声明模块、类型、输出目录及框架差异。Nuxt 继续继承其生成的 `.nuxt/tsconfig.json`。

## AGENTS.md 层级设计

### 根目录

根 `AGENTS.md` 记录所有项目共同遵守的规则：

- 仓库总体结构和职责边界。
- pnpm、Node、构建、检查和测试命令。
- TypeScript、格式化和测试命名约定。
- Git、提交、安全和配置规范。
- 目录级 `AGENTS.md` 的继承原则。

根文件不承载 Nuxt、NestJS 或 Hono 的详细实现规则。

### `apps/web/AGENTS.md`

记录：

- Nuxt Web 的职责和非职责。
- 页面、组件、组合式函数及客户端 API 代码放置方式。
- 只能通过 Server 使用业务与 Agent 能力的依赖规则。
- Web 专用的开发、类型检查、测试和构建命令。
- 用户界面变更的验证要求。
- 禁止在组件中实现核心业务规则或提交 `.nuxt`、`.output`。

### `apps/server/AGENTS.md`

记录：

- Server 对业务、认证、持久化和 Agent 集成的所有权。
- `domain`、`modules`、`integrations` 的边界和依赖方向。
- Controller 保持轻量、用例承载应用流程、领域层不依赖框架的规则。
- Server 专用开发、测试、类型检查和构建命令。
- 新接口与业务规则需要测试的要求。
- 禁止导入 Agent 源码或把模型编排放入 Server。

### `apps/mobile/AGENTS.md`

记录：

- 目录当前处于预留状态。
- 未经明确技术选型和设计批准，不得自行初始化框架。
- 未来客户端只通过 Server 使用业务能力。
- 框架确定后必须同步补充命令、测试和目录规范。

### `agent/AGENTS.md`

记录：

- Agent 对模型、上下文、工具和工作流的所有权。
- `config`、`contracts`、`tools`、`workflows` 的代码放置原则。
- Agent 通过公开接口与 Server 协作的依赖规则。
- Hono 开发、测试、类型检查和构建命令。
- 工具调用、错误路径和外部模型适配需要测试的要求。
- 禁止直接连接 Server 数据库、导入 Server 源码或把业务授权规则复制进 Agent。

### `vendor/AGENTS.md`

记录：

- `vendor` 仅供读取、研究和比较。
- 外部项目不进入 workspace、构建、测试或运行时依赖。
- 使用前记录来源、固定 commit 并检查许可证。
- AI 可以总结模式和思路，但不得复制许可证不允许使用的代码。
- 不修改外部参考项目，除非用户明确要求对本地副本做实验。

## 继承与维护原则

- 子目录 `AGENTS.md` 自动继承根规则，并以更具体的局部规则补充根规则。
- 不在子文件复制根目录的通用安全、Git 或格式化内容。
- 命令使用项目级 pnpm filter，保证可以直接复制执行。
- 当项目结构或工具链变化时，在同一变更中更新对应 `AGENTS.md`。
- 规则必须描述当前事实；未来设想只能作为明确的演进条件，不能伪装成现有能力。

## 迁移步骤

1. 创建根 `tsconfig.base.json`，迁移 Node TypeScript 公共编译选项。
2. 更新 Server 和 Agent 的 `tsconfig.json` 继承路径。
3. 移除 Server 和 Agent 对 `@duoduo/contracts` 的依赖，将健康响应类型就近定义。
4. 删除全部 `packages/*` 和 pnpm workspace 中对应配置。
5. 创建五份目录级 `AGENTS.md`，并更新根 `AGENTS.md` 的结构说明。
6. 调整 `.gitignore`，确保 `vendor/AGENTS.md` 与 `vendor/README.md` 都能被提交。
7. 更新 README 和设计文档索引信息。
8. 重新安装依赖并验证 lockfile 不再包含已删除 workspace 的链接。

## 验收标准

1. pnpm 只识别 Web、Server 和 Agent 三个子 workspace，以及根项目。
2. 仓库不再存在 `packages/` 目录或 `@duoduo/*` 共享包依赖。
3. Server 和 Agent 从根 `tsconfig.base.json` 继承公共规则。
4. 根目录及 Web、Server、Mobile、Agent、Vendor 均有职责适配的 `AGENTS.md`。
5. 子级规则不大段复制根规则，且不存在互相矛盾的依赖说明。
6. `format:check`、`lint`、`typecheck`、`test`、`build` 和 `git diff --check` 全部通过。
7. Nuxt、NestJS 和 Hono 的现有健康骨架继续正常构建和测试。

## 后续演进条件

- 当两个项目真实复用相同且稳定的代码时，再提取命名明确的共享包。
- 当 Server/Agent 通信形成真实 API 时，优先采用可进行运行时校验的协议来源。
- 当移动端技术选型确认后，扩展 `apps/mobile/AGENTS.md` 并将其加入 workspace。
- 当某个项目内部子域规则明显分化时，才在更深层目录增加 `AGENTS.md`。

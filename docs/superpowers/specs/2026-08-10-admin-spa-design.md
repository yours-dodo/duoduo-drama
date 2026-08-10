# Admin 管理端 React SPA 设计

## 1. 目标

新增独立的 `apps/admin` 管理后台前端，面向平台运营、系统管理员和 Agent 运维人员，统一承载业务后端与 Agent Runtime 的管理视图。

`apps/web` 继续面向 C 端创作者；`apps/admin` 不与 C 端页面、布局或客户端状态混用。

本阶段只建设前端骨架和本地占位数据，不新增 Server Admin API，不直接调用 Agent 服务，也不改变现有业务权限模型。

## 2. 技术方案

```text
React + TypeScript + Vite
Ant Design + @ant-design/icons
react-router-dom
Zustand
TanStack Query
Axios
```

职责划分：

- React/Vite：SPA 启动、构建和模块边界。
- Ant Design：管理端布局、表格、表单、反馈和状态组件。
- `react-router-dom`：嵌套路由、懒加载和路由守卫接缝。
- Zustand：登录态、当前租户、侧边栏和主题等客户端状态。
- TanStack Query：后端数据缓存、分页、加载、错误和失效刷新。
- Axios：统一请求实例、Base URL、超时、认证头、请求 ID 和错误拦截。

服务端状态不得复制到 Zustand。TanStack Query 是后续接入 Admin API 的唯一服务端数据缓存入口；第一阶段可以使用相同接口的本地 mock/queryFn 占位。

## 3. 应用结构

```text
apps/admin/
├── app/
│   ├── App.tsx
│   ├── main.tsx
│   ├── router/
│   ├── layouts/
│   ├── pages/
│   ├── components/
│   ├── stores/
│   ├── queries/
│   ├── services/
│   └── types/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── vitest.config.ts
```

`apps/admin` 是独立 workspace，包名为 `@duoduo/admin`，开发端口为 `3003`。

## 4. 路由和页面骨架

第一阶段建立以下路由；页面以真实管理端布局和明确的占位状态呈现，不实现业务操作：

```text
/login
/
├── /dashboard
├── /tenants
├── /users
├── /projects
├── /agent/runs
├── /agent/approvals
├── /agent/recovery
└── /settings/models
```

根布局包含：

- Ant Design `Layout`、可折叠侧边栏和顶部栏；
- 当前租户/环境占位信息；
- 页面标题和面包屑；
- 统一的加载、空数据和错误占位区域；
- 退出登录和后续权限守卫的接缝。

第一阶段的 `/login` 只展示登录表单和本地占位提交反馈，不持久化真实凭证。受保护路由使用本地 mock session 判断，后续替换为 Server 会话认证。

## 5. 数据和适配器边界

```text
Admin 页面
   ↓
TanStack Query / Zustand
   ↓
Axios client（当前使用 mock adapter）
   ↓
未来的 apps/server Admin API
   ↓
业务数据库与显式 Agent 运维集成
```

浏览器代码不得直接访问 Agent 服务或数据库。未来 Agent Runs、审批、恢复和模型配置的读写都通过 Server 明确暴露的 Admin API 完成，由 Server 负责管理员身份、租户权限和审计边界。

Axios 层应预留：

- `VITE_API_BASE_URL`；
- Cookie/认证头注入；
- `x-request-id` 传播；
- 统一错误响应转换；
- 超时和取消信号。

## 6. 非目标

本阶段不包含：

- Server Admin API 或数据库迁移；
- Agent 直接 HTTP 调用；
- 真实登录、RBAC、租户授权和审计写入；
- Agent Prompt、Provider 或模型配置的真实修改；
- 复杂图表、实时 WebSocket/SSE 监控和批量运维操作；
- 抽取共享 UI 包或修改 `apps/web`。

## 7. 验证标准

- `pnpm --filter @duoduo/admin dev` 能在 `3003` 启动。
- `pnpm --filter @duoduo/admin build` 成功。
- `pnpm --filter @duoduo/admin typecheck` 成功。
- `pnpm --filter @duoduo/admin test` 覆盖路由、布局、登录占位状态和 Query/Store 基础行为。
- `pnpm lint` 与 `pnpm format:check` 通过。
- Admin 不引入对 `agent/` 源码或数据库的直接依赖。
- 后续接入 API 时只需替换 Axios/query adapter，不改变页面路由和核心布局。

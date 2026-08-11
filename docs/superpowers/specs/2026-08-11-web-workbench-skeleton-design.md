# Web 工作台纵切片骨架设计

## 状态

已确认，进入实现计划阶段前的设计基线。

## 背景

Web 端同时承载公开页面和两个技术栈不同的创作工作台：故事工作台使用 Vue，短剧工作台使用 React。Astro 作为页面级外壳，负责公开页面、布局、MPA 路由和工作台入口；两个工作台分别维护自己的交互状态，不引入 Next.js 或 Nuxt.js。

仓库当前已经存在 Astro 路由、鉴权门、故事 API 接入、Vue 故事工作台和 React 短剧占位入口。本次工作以增量方式完成一条可运行纵切片，保留现有未提交成果，不做无关重构。

## 目标

- 打通工作台选择页、项目列表页和项目工作台页的页面级导航。
- 保持故事工作台的真实 API 和草稿版本流程。
- 建立短剧工作台可进入、可切换流程的 React 骨架。
- 明确 Astro、Vue、React 和 Server API 的职责边界。
- 为加载、空数据、鉴权失败和请求失败提供可见状态。
- 让动态项目路由可以在 Astro Server 输出模式下运行。

## 非目标

- 不实现短剧项目真实 CRUD、剧集生成、分镜、素材或 Agent 流程。
- 不实现故事与短剧之间的业务数据转换。
- 不引入 Next.js、Nuxt.js、状态管理库或微前端运行时。
- 不重构完整的服务端 session 鉴权体系。
- 不做全局 UI 视觉系统重做。

## 总体架构

```text
Astro 页面级路由和布局
├── /app
├── /app/stories
├── /app/stories/:projectId
├── /app/dramas
└── /app/dramas/:projectId
        │
        ├── StoryApp.vue       Vue 故事工作台
        └── DramaApp.tsx       React 短剧工作台
                │
                └── Server API
```

Astro 负责页面边界、布局、路由参数、鉴权入口和页面级状态承载；Vue 或 React 负责对应工作台内部的导航、主面板、编辑交互和本地状态。两个工作台只通过框架无关的 API 请求工具、数据类型、Session 表示和设计 token 共享基础协议，不共享组件或响应式状态。

## 渲染与路由策略

Astro 配置调整为 Server 输出模式，以支持未知项目 ID 的动态私有路由。公开页面可以显式使用 `prerender = true`；工作台、登录、账户和 API 路由保持非预渲染。工作台根应用暂时继续使用 `client:only`，避免当前浏览器鉴权门在服务端渲染私有工作台内容；Astro 仍然负责服务端页面壳和动态路由。

页面级导航使用普通链接，保持 MPA 行为：从项目列表进入工作台、从故事切换到短剧、返回工作台选择页时进行完整页面导航。工作台内部的高频交互由各自的 Vue/React 应用处理，本轮不额外引入客户端跨页面路由。

## 页面与组件边界

### Astro 页面

```text
apps/web/src/pages/app/
├── index.astro
├── stories/
│   ├── index.astro
│   └── [projectId].astro
└── dramas/
    ├── index.astro
    └── [projectId].astro
```

这些页面只负责 `BaseLayout`、`AuthGate`、页面标题、`projectId` 和工作台根组件挂载。

### 故事工作台

```text
apps/web/src/features/story/
├── StoryApp.vue
├── story-api.ts
└── components/
    ├── StoryHeader.vue
    ├── StoryProjectCatalog.vue
    ├── StoryProjectSidebar.vue
    ├── StoryArtifactWorkbench.vue
    └── StoryStatusBar.vue
```

`StoryApp.vue` 保留加载和业务协调职责。项目列表页使用现有项目查询、新建项目和跳转流程；项目页使用现有成果列表、成果详情、草稿保存、版本确认和草稿丢弃流程。结构性模板可以拆分到子组件，但不改变现有 API 请求语义和版本并发参数。

### 短剧工作台

```text
apps/web/src/features/drama/
├── DramaApp.tsx
└── components/
    ├── DramaHeader.tsx
    ├── DramaProjectCatalog.tsx
    ├── DramaWorkflowNav.tsx
    ├── DramaCanvas.tsx
    └── DramaStatusBar.tsx
```

短剧列表页提供入口和空状态；项目页提供制作流程导航、项目上下文、主工作区和状态栏。流程导航可以在 `episodes`、`scenes`、`shots`、`assets` 之间切换。尚未存在后端能力的按钮保持 disabled，并使用明确的占位文案。

## 数据流与状态

### 故事

故事工作台沿用现有真实 API 适配器。最小状态包括加载中、准备完成、错误和鉴权失效；没有团队时由 `AuthGate` 进入 onboarding。服务端返回结果确认后再更新编辑器状态，保存失败时保留用户当前输入。

### 短剧

本轮只维护客户端占位状态：当前项目 ID、当前流程步骤和工作台可见状态。短剧不调用不存在的业务 API，也不创建伪造的持久化数据。

### 鉴权

`AuthGate` 只负责当前浏览器登录态检查和页面跳转，不承担最终权限判断。项目读取、编辑和版本操作的权限由 Server API 校验，客户端根据 API 错误展示提示。

### 状态栏

故事状态栏展示团队、项目和保存状态；短剧状态栏展示团队、项目、当前流程和“占位/即将接入”状态。状态栏只反映当前工作台状态，不成为业务数据来源。

## 错误与空状态

- 未登录：跳转登录页，保留当前路径作为 `next`。
- 无团队：跳转 onboarding。
- 项目不存在或不可访问：显示项目不可用状态，并提供返回项目列表的链接。
- 故事 API 加载失败：显示错误信息和重新加载操作。
- 故事项目或成果为空：显示明确的下一步提示。
- 短剧能力未接入：显示占位状态，禁用不可用操作。

## 验收标准

1. `/app` 可以进入故事和短剧入口。
2. `/app/stories` 可以加载故事项目列表并创建项目。
3. `/app/stories/:projectId` 可以加载成果、编辑草稿、保存、确认和丢弃。
4. `/app/dramas` 和 `/app/dramas/:projectId` 可以进入短剧占位工作台。
5. 短剧流程导航可以切换当前步骤，且不请求不存在的后端能力。
6. 未登录、无团队、加载失败和空数据都有明确状态。
7. 故事页面不加载 React 工作台代码，短剧页面不加载 Vue 工作台代码。
8. `pnpm --filter @duoduo/web typecheck`、`pnpm --filter @duoduo/web test` 和 `pnpm --filter @duoduo/web build` 通过。
9. `git diff --check` 通过，并在桌面宽度和窄屏下检查工作台入口、项目页和占位工作台。

## 风险与后续决策

- 当前鉴权门主要在浏览器侧运行，Server 输出模式本身不等于服务端鉴权；后续需要单独设计 session-aware SSR 或统一的服务端页面保护。
- 短剧工作台的领域模型、API 和持久化边界留待下一轮，不在本纵切片中提前固化。
- 当工作台内部出现多级深链接需求时，再分别评估 Vue Router 或 React Router；本轮保持页面级 MPA 和简单根应用。

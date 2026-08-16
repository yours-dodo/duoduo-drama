# /stories Vue Router 工作台设计

## 状态

已确认，2026-08-15。

## 背景

当前 `/stories` 由多个 Astro 页面和一个 Vue 作品列表组成。作品列表、沉浸式创作、模版库和故事编辑模块之间通过普通 `<a href>` 跳转，导致每次切换都会重新请求并重建整页，header、侧栏和右侧聊天区也会重新挂载。

本次改造只统一 Web 端故事工作台，不改 React 管理端，也不改后端 API。

## 目标

- 使用 Vue Router 管理整个 `/stories` 路由树。
- 作品列表、沉浸式创作、模版库和故事编辑页在同一个 Vue 应用内切换。
- 切换路由时不触发整页刷新。
- header、左侧导航和右侧聊天区作为工作台常驻壳存在。
- 保留直接访问深层 URL、浏览器前进/后退和现有视觉样式。
- 复用现有 `story-api.ts` 和服务端接口。

## 非目标

- 不迁移 `apps/admin` 的 React 路由。
- 不替换服务端鉴权机制。
- 不在本次改造中实现聊天消息发送和 Agent 生成逻辑。
- 不重新设计当前故事工作台视觉，仅迁移组件结构和导航行为。

## 路由架构

新增单一 Astro 入口：

```text
apps/web/src/pages/stories/[...path].astro
```

该入口负责所有 `/stories` 地址的首次请求，并挂载 `StoryWorkspaceApp.vue`。Astro 只负责基础 HTML、鉴权和样式加载；工作台 header、侧栏、页面内容和聊天区全部由 Vue 渲染。

Vue Router 使用 HTML5 History 模式，基础路径为 `/stories`，路由表为：

```text
/                               作品列表
/immersive                      沉浸式创作
/templates                      模版库
/:projectId                     重定向到 /:projectId/outline
/:projectId/:module             故事项目模块
/immersive/:projectId           重定向到 /immersive/:projectId/outline
/immersive/:projectId/:module   沉浸式项目模块
```

模块只允许 `outline`、`roles`、`worldview`、`story`。沉浸式动态路由必须在普通项目动态路由之前定义，避免将 `immersive` 误识别为项目 ID。

现有故事 Astro 页面不再作为独立运行入口，避免直接访问深层 URL 时重新挂载不同应用。迁移完成后，`[...path].astro` 成为 `/stories` 路由树的唯一入口。

## Vue 组件边界

```text
StoryWorkspaceApp.vue
├── StoryWorkspaceHeader.vue
├── StorySidebar.vue
├── RouterView
│   ├── StoryCatalogView.vue
│   ├── StoryImmersiveView.vue
│   ├── StoryTemplatesView.vue
│   └── StoryProjectView.vue
│       ├── StoryModuleNav.vue
│       ├── StoryModuleContent.vue
│       └── StoryChatPanel.vue
```

### StoryWorkspaceApp

持有当前用户、空间、主题色、侧栏状态、最近对话和当前项目上下文，并提供全局工作台布局。路由变化不会销毁该组件。

### StoryWorkspaceHeader

从故事 header 中迁移品牌、模块导航、主题切换、全屏和帮助菜单。模块导航使用 `RouterLink`，active 状态直接来自当前路由。

### StorySidebar

从 Astro 组件迁移左侧创作空间、沉浸式创作、模版库、最近对话和用户区域。折叠状态及最近对话继续使用现有 localStorage key。

### StoryCatalogView

承接现有 `StoryApp.vue` 的作品列表、空间切换、搜索、日期筛选、创建故事、沉浸式创作和上传故事逻辑。所有创建完成后的跳转改为 `router.push()`。

### StoryProjectView

承接当前故事项目模块内容和右侧常驻聊天区。切换 `outline`、`roles`、`worldview`、`story` 时只替换模块内容，工作台壳和聊天区保持不变。

## 状态和数据流

### 路由状态

由 Vue Router 管理：

- 创作模式
- 项目 ID
- 当前模块
- 搜索参数
- 导入状态参数

内部导航禁止使用 `window.location.assign()`，统一使用 `router.push()`、`router.replace()` 或 `RouterLink`。

### 工作台状态

由根组件管理：

- session 和当前空间
- 主题色
- 左侧导航展开/折叠
- 最近对话列表
- 当前聊天项目

同一项目切换模块时保留聊天上下文；切换项目时重新读取对应项目的数据。

### 页面状态

由页面组件管理：

- 作品筛选条件
- 加载、错误和操作状态
- 模块编辑内容
- 创建、保存、确认和导入状态

现有 `story-api.ts` 作为唯一 API 调用边界，不在路由组件中重复实现请求协议。

## 鉴权和首次加载

Astro 的 `AuthGate` 继续包裹 Vue 工作台，只在首次进入 `/stories` 路由树时执行鉴权。内部 Vue 路由切换不重复执行 Astro 鉴权脚本。

首次直接访问深层 URL 时，Astro catch-all 入口将当前 pathname 和 search 传给 Vue 应用，Vue Router 使用同一地址初始化，避免 hydration 后先渲染错误页面再跳转。

## 迁移策略

1. 安装 `vue-router`，建立路由表和工作台根组件。
2. 将故事 header 和侧栏的 Astro markup 及交互逻辑迁移到 Vue。
3. 将作品列表从 `StoryApp.vue` 拆为 `StoryCatalogView.vue`，保留现有 API 和交互。
4. 将 `StoryProjectModulePage.astro` 转为 Vue 项目模块视图，保留四个模块路径和聊天区。
5. 将创建、上传、搜索和项目卡片链接改为 Vue Router 导航。
6. 调整 `BaseLayout`，允许故事 catch-all 页面关闭 Astro header，避免重复渲染。
7. 用单个 `/stories/[...path].astro` 替代现有故事 Astro 入口。
8. 删除或停用旧的故事页面入口，确保普通请求和客户端导航都进入同一 Vue 应用。
9. 保留现有 CSS class，完成构建和浏览器导航验证。

## 错误处理

- 未登录：沿用现有登录跳转，并保留当前 pathname 和 query。
- API 错误：在当前 Vue 页面显示既有错误状态，不触发整页刷新。
- 无效模块：路由重定向到同一项目的 `outline`。
- 无效项目：显示项目加载错误，并提供返回作品列表操作。
- 浏览器前进/后退：由 Vue Router 恢复对应路由和页面状态。

## 验收标准

- 从 `/stories` 进入任意故事项目时，document 不重新加载。
- 在四个故事模块之间切换时，header、侧栏和聊天区不销毁。
- `/stories`、`/stories/immersive`、`/stories/templates` 均由同一 Vue 应用渲染。
- 直接打开普通和沉浸式深层编辑 URL 能正确显示对应模块。
- 创建故事、沉浸式故事和上传故事完成后使用 Vue Router 进入目标页面。
- 主题色、侧栏折叠、最近对话和搜索行为保持现有表现。
- Vue 类型检查、故事工作台测试和 Web 构建全部通过。

## 验证计划

- 为路由路径归一化和模块匹配增加单元测试。
- 在开发服务器中验证作品列表到编辑页、模块间切换、普通/沉浸式切换和前进后退。
- 使用浏览器网络面板确认内部导航没有新的 document 请求。
- 运行 `pnpm --filter @duoduo/web typecheck`。
- 运行 `pnpm --filter @duoduo/web test`。
- 运行 `pnpm --filter @duoduo/web build`。
- 运行 `git diff --check`。

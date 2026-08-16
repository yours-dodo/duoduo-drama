# /stories Vue Router 工作台实施计划

> 日期：2026-08-15
>
> 状态：实施中
>
> 依据：[/stories Vue Router 工作台设计](../specs/2026-08-15-stories-vue-router-design.md)

## 1. 目标

把整个 `/stories` 路由树统一交给一个 Vue Router 应用管理，消除作品列表、创作入口、模版库和项目模块之间的整页刷新，同时保留现有 API、视觉 class、主题色、侧栏行为和项目创建流程。

本计划只覆盖 `apps/web` 的故事工作台，不修改 React 管理端、Server、数据库和 Agent。

## 2. 当前基线

- `StoryApp.vue` 同时包含作品列表和旧的项目成果编辑模板。
- `/stories/index.astro` 挂载作品列表 Vue，其他故事页面分别由 Astro 页面或 Astro 组件渲染。
- `SiteHeader.astro`、`StorySidebar.astro` 和 `StoryProjectModulePage.astro` 当前由 Astro 输出。
- 四个项目模块链接是普通 `<a href>`，跨模块会触发整页导航。
- `story-api.ts` 已包含故事项目、成果、对话和导入任务 API 适配器。
- 当前工作区存在大量用户已有改动，实施时只修改本计划涉及的 Web 文件，不回滚、不格式化、不暂存无关文件。

## 3. 实施原则

- 先建立可匹配所有 `/stories` 地址的单一 Astro 入口，再迁移 Vue 壳，避免出现客户端路由已更新但深链接仍进入旧页面的中间状态。
- 统一使用 `RouterLink`、`router.push` 和 `router.replace`；故事工作台不再使用 `window.location.assign`。
- 迁移时尽量保留现有 `story-*` class，避免把路由重构扩大为视觉重构。
- API 调用继续集中在 `story-api.ts`；路由和组件只组织调用，不复制 HTTP 协议。
- 每个切片先做窄验证，再做 Web 全量 typecheck、test 和 build。
- 设计文档和本计划文档使用精确路径强制提交，不能暂存其他文件。

## 4. 目标目录

```text
apps/web/src/
├── pages/stories/
│   └── [...path].astro
├── layouts/
│   └── BaseLayout.astro
├── workspaces/story/
│   ├── StoryWorkspaceApp.vue
│   ├── router.ts
│   ├── StoryWorkspaceHeader.vue
│   ├── StorySidebar.vue
│   ├── StoryCatalogView.vue
│   ├── StoryImmersiveView.vue
│   ├── StoryTemplatesView.vue
│   ├── StoryProjectView.vue
│   ├── StoryModuleContent.vue
│   └── StoryChatPanel.vue
└── styles/workspace.css
```

具体文件可以在实施中合并，但组件职责必须保持上述边界：根壳常驻，路由页面可替换，API 适配器独立。

## 5. 切片 S01：Vue Router 依赖、路由表与纯路径测试

### 目标

建立可独立测试的 Vue Router 路由表，覆盖故事列表、模版、沉浸式和两套项目模块路径。

### 文件

- 修改 `apps/web/package.json`，增加 `vue-router`。
- 修改 pnpm lockfile。
- 新增 `apps/web/src/workspaces/story/router.ts`。
- 新增 `apps/web/src/workspaces/story/router.test.ts`。

### 实施步骤

1. 使用 `createRouter`、`createWebHistory('/stories')`；服务端渲染时使用兼容的 memory history 初始化策略。
2. 定义静态路由和动态路由，先声明沉浸式动态路由，再声明普通项目动态路由。
3. 为 `/:projectId` 和 `/immersive/:projectId` 增加到 `outline` 的重定向。
4. 通过 route meta 暴露 `mode`、`projectId` 和 `module`，限制模块为四个合法值。
5. 对未知模块返回同项目 `outline`，对未知故事路径返回工作台空状态或列表路由。
6. 用 memory history 测试普通列表、沉浸式列表、模版、普通模块、沉浸式模块、重定向和无效模块。

### 验收

- 所有路径都能得到稳定的 route name、mode 和 module。
- `immersive` 不会被误判为普通项目 ID。
- 路由测试不依赖浏览器、网络或真实 API。

## 6. 切片 S02：单一 Astro 入口与 Vue 工作台根壳

### 目标

让所有 `/stories` 深链接进入同一个 Astro 页面并挂载同一个 Vue 应用，先建立常驻壳，不迁移所有页面内容。

### 文件

- 新增 `apps/web/src/pages/stories/[...path].astro`。
- 修改 `apps/web/src/layouts/BaseLayout.astro`，支持故事页面关闭 Astro header。
- 新增 `apps/web/src/workspaces/story/StoryWorkspaceApp.vue`。
- 按需要修改 `apps/web/src/styles/workspace.css`。

### 实施步骤

1. 在 catch-all 页面使用 `BaseLayout` 和现有 `AuthGate`，页面 class 保持 `story-page story-catalog-page`。
2. 将当前 pathname/search 作为初始路由上下文传入 Vue，避免深链接 hydration 后先渲染错误路由。
3. 在 `StoryWorkspaceApp` 中创建 router、挂载 `RouterView`，先为每条路由输出可识别的临时页面状态。
4. 让 BaseLayout 不输出 Astro `SiteHeader`，避免 Vue header 与 Astro header 重复；footer 保持当前故事页隐藏策略。
5. 保留 head 中故事主题初始化逻辑，确保刷新第一帧仍使用 localStorage 主题。
6. 通过 curl 确认四类入口和深层 URL 都返回同一 catch-all 页面标记。

### 验收

- `/stories`、`/stories/immersive`、`/stories/templates`、普通/沉浸式深层模块 URL 都能打开。
- 页面中只存在一个故事工作台根壳。
- 直接访问深层 URL 不返回 Astro 404。

## 7. 切片 S03：Vue header、侧栏和常驻聊天区

### 目标

将当前 Astro header、故事侧栏和编辑页右侧聊天区迁移到 Vue，使它们在 Vue Router 路由切换时不销毁。

### 文件

- 新增 `apps/web/src/workspaces/story/StoryWorkspaceHeader.vue`。
- 新增 `apps/web/src/workspaces/story/StorySidebar.vue`。
- 新增 `apps/web/src/workspaces/story/StoryChatPanel.vue`。
- 修改 `apps/web/src/workspaces/story/StoryWorkspaceApp.vue`。
- 可删除或停用 `apps/web/src/components/astro/StorySidebar.astro`、`SiteHeader.astro` 中仅供故事页面的渲染入口；保留其他页面需要的 header 能力。
- 修改 `apps/web/src/styles/workspace.css`，只补 Vue 需要的状态 class。

### 实施步骤

1. 按当前视觉 markup 迁移品牌、四个编辑模块导航、故事工作区导航、主题、全屏和帮助菜单。
2. 模块导航使用 `RouterLink`，active 状态由 `useRoute` 计算，普通故事和沉浸式故事使用当前模式拼接路径。
3. 迁移侧栏折叠、最近对话展开/收起、折叠态历史弹层和用户信息读取逻辑。
4. 迁移右侧聊天区的历史区域、输入区域、发送按钮和常驻高度布局；先保持当前发送按钮的 UI 行为，不接入真实消息提交。
5. 主题色和全屏逻辑改为 Vue 生命周期和事件监听，避免 Astro inline script 在内部路由切换时重复绑定。
6. 确认 header、侧栏和聊天区不被 `RouterView` 包裹，保证模块切换时不重建。

### 验收

- `/stories` 到 `/stories/templates` 的切换不销毁 header 和侧栏。
- 四个编辑模块切换时聊天区 DOM 节点保持不变。
- 侧栏折叠状态、最近对话和主题色在路由切换后保持。
- 聊天区上下占满空间、无圆角；左侧内容区无边框。

## 8. 切片 S04：作品列表、创作入口和模版页面迁移

### 目标

将 `StoryApp.vue` 的作品列表能力拆入 Vue Router 页面，保留搜索、空间切换、卡片排序、创建、上传和骨架屏行为。

### 文件

- 新增或修改 `apps/web/src/workspaces/story/StoryCatalogView.vue`。
- 新增 `apps/web/src/workspaces/story/StoryImmersiveView.vue`。
- 新增 `apps/web/src/workspaces/story/StoryTemplatesView.vue`。
- 修改 `apps/web/src/workspaces/story/StoryApp.vue`，提取或复用可共享的 catalog 逻辑。
- 修改 `apps/web/src/styles/workspace.css`，只修正迁移后页面壳选择器。

### 实施步骤

1. 将作品列表 template 和 loading/error/auth 状态从 `StoryApp.vue` 拆到 `StoryCatalogView`。
2. 保留个人空间、团队空间切换、关键词搜索、日期搜索和无条件时最近编辑作品置顶。
3. 保留三个小面积创建按钮及其颜色、hover、禁用和骨架屏表现。
4. 创建故事、沉浸式创作和上传成功后改用 `router.push`，导入状态通过 query 保留。
5. 作品卡片使用 `RouterLink` 进入普通或沉浸式项目 outline。
6. 沉浸式创作和模版库先迁移现有页面内容及导航状态，不扩展未实现的业务能力。
7. 保证 session 只在根工作台或 catalog 需要时加载一次，空间切换只刷新作品列表。

### 验收

- 作品列表、沉浸式入口、模版库都由 Vue Router 页面渲染。
- 搜索条件和卡片排序行为不回归。
- 三个创作入口可点击，个人空间也可以创建。
- 作品卡片进入目标模式的正确模块路径。
- 列表 loading 骨架屏不影响常驻 header、侧栏和聊天区。

## 9. 切片 S05：项目模块和编辑数据迁移

### 目标

将当前 `StoryProjectModulePage.astro` 和项目数据逻辑迁移到 Vue，完成四个模块的无刷新切换，并保留右侧聊天区。

### 文件

- 新增 `apps/web/src/workspaces/story/StoryProjectView.vue`。
- 新增 `apps/web/src/workspaces/story/StoryModuleContent.vue`。
- 按实际拆分修改 `apps/web/src/workspaces/story/StoryApp.vue`。
- 可停用 `apps/web/src/components/astro/StoryProjectModulePage.astro` 及旧项目 Astro 页面。
- 修改 `apps/web/src/workspaces/story/story-api.ts` 仅在类型或请求参数确有需要时。

### 实施步骤

1. 使用 route params 读取 projectId、module 和 immersive mode。
2. 通过 `getStoryProject`、`listStoryArtifacts` 和既有 API 加载项目模块数据。
3. 保留四个模块标题、说明和导入 pending 状态。
4. 将模块切换实现为 `RouterLink`，同一项目只替换模块内容。
5. 对项目切换、模块切换和错误状态分别处理，避免上一个项目的内容短暂残留。
6. 从作品列表进入项目时，使用同一 Vue 工作台根壳，聊天区根据 projectId 更新上下文。
7. 维持普通创建和沉浸式创建的路由前缀差异。

### 验收

- 四个模块页面均能直接访问和无刷新切换。
- 普通和沉浸式项目都使用正确的 API 上下文和路由。
- 右侧聊天区在模块切换时保持常驻。
- 导入 pending query 在大纲页仍能显示导入任务状态。

## 10. 切片 S06：旧入口清理、导航回归和最终验证

### 目标

删除故事路由树中会导致整页重建的旧入口，完成无刷新导航验证和交付检查。

### 文件

- 停用或删除旧故事入口：
  - `apps/web/src/pages/stories/index.astro`
  - `apps/web/src/pages/stories/immersive.astro`
  - `apps/web/src/pages/stories/templates.astro`
  - `apps/web/src/pages/stories/[projectId].astro`
  - `apps/web/src/pages/stories/[projectId]/[module].astro`
  - `apps/web/src/pages/stories/immersive/[projectId]/[module].astro`
- 清理只服务旧 Astro 故事页面的导入和脚本。
- 更新 `apps/web/src/workspaces/story` 下相关测试。

### 实施步骤

1. 确认 catch-all 页面优先承接所有 `/stories` 深链接，再移除旧页面。
2. 全局搜索故事区的 `window.location.assign`、旧 module href 和重复 Astro header 输出。
3. 运行开发服务器，通过浏览器检查 document 请求计数、当前 URL、active 导航和浏览器后退。
4. 检查桌面和窄屏布局，重点确认常驻聊天区、侧栏折叠和 skeleton 初始状态。
5. 执行完整 Web 验证命令。

### 验证命令

```bash
pnpm --filter @duoduo/web test
pnpm --filter @duoduo/web typecheck
pnpm --filter @duoduo/web build
git diff --check
git status --short
```

### 浏览器验收场景

1. `/stories` → `/stories/immersive` → `/stories/templates`：确认无 document reload。
2. `/stories` → 普通项目 outline → roles → worldview → story：确认 header、sidebar、chat 不销毁。
3. `/stories` → 沉浸式项目 outline → 其他模块：确认模式前缀不丢失。
4. 刷新普通和沉浸式深层 URL：确认正确渲染且首帧主题正确。
5. 创建故事、沉浸式故事、上传故事：确认 API 完成后由 Vue Router 进入目标页。
6. 浏览器后退/前进：确认页面和 active 导航恢复。

## 11. 交付边界

最终交付包含：

- 单一 `/stories` Astro 入口。
- Vue Router 故事工作台。
- Vue 常驻 header、左侧导航和右侧聊天区。
- Vue 作品列表、沉浸式入口、模版库和项目模块页面。
- 无刷新内部导航和深链接兼容。
- 原有故事 API 和视觉行为保持可用。

不包含：

- React Router 改造。
- Server、Prisma 或 Agent 修改。
- 真实聊天消息发送、Agent 生成和对话持久化实现。
- 视觉重新设计或非故事页面重构。

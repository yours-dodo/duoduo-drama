# 故事项目资产工作区实现计划

> 设计依据：[故事项目资产工作区重排设计](../specs/2026-08-16-story-project-asset-workspace-design.md)

## 目标

在不改变 `/stories` 根页面的前提下，将普通项目和沉浸式项目的编辑页统一为四个一级资产模块：世界观、角色资产、大纲、故事正文，并保持右侧 AI 对话常驻。

## 改动边界

允许修改：

- `apps/web/src/workspaces/story/StoryWorkspaceHeader.vue`
- `apps/web/src/workspaces/story/StoryProjectView.vue`
- `apps/web/src/workspaces/story/router.ts` 及其测试（仅当模块显示映射或路由断言需要）
- `apps/web/src/styles/workspace.css` 中项目编辑模块所需的样式

不修改：

- `StoryApp.vue` 根页面结构和创作入口
- 根页面的系统导航、最近对话、作品卡片和搜索交互
- Server、Prisma、Agent 及现有数据库改动
- 大纲内部的故事线、章节、场景卡实现

## 实现步骤

### 1. Header 资产导航

- 将编辑页 Header 的四个展示名称固定为：世界观、角色资产、大纲、故事正文。
- 保留英文模块 key：`worldview`、`roles`、`outline`、`story`。
- 保持现有无背景选中态：主题色、加粗、下边框、`aria-current`。
- 保持普通项目和沉浸式项目的相对路由生成逻辑。
- 不向根页面 Header 注入项目资产导航。

### 2. 统一项目模块内容

- 保留 `StoryProjectView.vue` 作为统一模块入口，通过当前路由模块选择标题、说明和内容区文案。
- 将模块文案从“故事创建 / 沉浸式创作”与旧的通用描述调整为四个资产职责。
- 为世界观、角色资产、大纲、故事正文分别提供轻量内容面板，明确后续编辑器扩展边界。
- 不伪造业务内容；在没有 API 数据时显示模块说明、空状态和后续入口占位。
- 保留 `import=pending` 在大纲模块的导入状态提示。

### 3. 工作区样式

- 复用项目编辑页现有深色主题、版心、安全距离和右侧聊天区布局。
- 确保模块内容区不新增会与 Header 重复的二级导航。
- 统一四个模块的标题、说明、面板间距和空状态样式。
- 保持聊天区上下占满、贴近右侧、无圆角的现有约束。
- 增加必要的窄屏适配，避免四个 Header 导航溢出后遮挡工具区。

### 4. 验证

- 更新或补充路由测试，验证普通与沉浸式项目的四个模块都能解析。
- 验证根页面仍保留“创作空间、沉浸式创作、模版库、最近”。
- 运行：
  - `pnpm --filter @duoduo/web test`
  - `pnpm --filter @duoduo/web typecheck`
  - `pnpm --filter @duoduo/web build`
  - `git diff --check`
- 开发服务器下检查 `/stories`、普通项目四个模块和沉浸式项目四个模块返回正常，并确认模块切换不触发整页导航。

## 完成标准

- 编辑页 Header 四个导航按“世界观、角色资产、大纲、故事正文”顺序展示。
- 根页面视觉和交互保持现状。
- 四个项目模块使用统一内容工作区，右侧聊天不因切换而销毁。
- 故事线、章节、场景卡没有提前出现在 Header 或大纲页面中。
- Web 测试、类型检查和构建全部通过。

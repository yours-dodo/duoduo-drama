# 故事大纲双模式画布实现计划

设计依据：`docs/superpowers/specs/2026-08-16-story-outline-canvas-design.md`

## 实现边界

- 只修改 Vue 故事工作区，不引入新的画布依赖。
- 原型数据保存在组件内存中，不调用 Server API。
- 普通项目和沉浸式项目共用同一套 outline 组件。
- 保留现有 Header、项目路由和右侧常驻 AI 聊天区。

## 任务切片

### 1. 建立领域类型和布局纯函数

新增 `story-outline-types.ts`，定义节点、边、模式、视图和布局结果类型。

新增 `story-outline-layout.ts`，提供：

- 示例大纲数据工厂。
- 横向时间轴布局。
- 纵向时间轴布局。
- 鱼骨图布局。
- 逻辑图布局。
- 思维导图布局。
- 节点删除后的关系清理。
- 新节点插入和默认关系生成。

布局函数必须是纯函数，不读取 DOM，不依赖 Vue，并保证相同输入输出稳定。

### 2. 实现节点编辑器

新增 `StoryOutlineNodeEditor.vue`：

- 支持新增和编辑两种状态。
- 编辑标题、摘要和节点类型。
- 空标题阻止提交。
- 删除操作由父组件确认后执行。
- 使用原生表单控件、可访问标签和 `aria-live` 状态。

### 3. 实现画布

新增 `StoryOutlineCanvas.vue`：

- SVG 绘制关系线和箭头。
- HTML 节点层承载按钮、标题、摘要和操作条。
- 支持点击选中、空白取消、双击编辑。
- 支持 pointer drag，拖拽只更新当前视图位置。
- 支持缩放比例和滚动画布。
- 提供无障碍的编辑入口，不依赖拖拽才能完成操作。

### 4. 实现大纲工作区

新增 `StoryOutlineWorkspace.vue`：

- 第一层切换时间轴/世界构成。
- 第二层切换三种时间轴或两种世界构成视图。
- 默认世界构成/思维导图。
- 管理内存中的节点、边、选中节点、缩放和编辑器状态。
- 提供新增、缩放、重置布局工具。
- 将节点操作反馈通过 `aria-live` 和可见状态展示。

### 5. 接入项目页与样式

在 `StoryProjectView.vue` 中仅对 `outline` 模块渲染 `StoryOutlineWorkspace`，其他三个模块保留现有统一资产页。

在 `workspace.css` 中新增 outline 画布样式：

- 深色编辑室主题。
- 矩形节点、无圆角、低对比细线。
- 橙色选中态和工具状态。
- 桌面双栏布局与窄屏底部编辑浮层。
- `prefers-reduced-motion` 下关闭位置过渡。

### 6. 测试与验证

- 为布局纯函数和关系清理添加 Vitest 测试。
- 为默认模式、路由渲染和项目页不影响其他模块添加测试或 SSR smoke 检查。
- 运行 Web test、typecheck、build。
- 检查普通/沉浸式 outline 路由返回 200。
- 检查根 `/stories` 和右侧聊天区未被影响。
- 检查 `git diff --check`。

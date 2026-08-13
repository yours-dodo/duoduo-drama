# Onboarding 页面 Levels 视觉重构设计

## 背景

`/onboarding` 是已登录但尚未创建团队的用户首次进入创作工作区前的设置页面。当前页面复用通用认证卡片样式，能够完成创建工作空间，但视觉层级、设计令牌和移动端表达没有完整遵循 `apps/web/DESIGN.md`。

## 目标

- 将页面调整为现代、干净、面向转化的工作空间创建入口。
- 采用 `apps/web/DESIGN.md` 规定的 Levels 颜色、字体、字号和间距。
- 保持现有业务流程：提交 `POST /api/v1/teams`，携带 `Idempotency-Key`，成功后跳转 `/workspace`。
- 覆盖空闲、输入聚焦、提交中、创建失败和窄屏状态。
- 将样式限定在 `onboarding-page` 页面作用域内，避免影响登录页、公共页和工作台。

## 视觉方案

页面采用桌面端双栏、移动端单栏的编辑式布局：

- 左侧是创建阶段说明，包含 `01 / SETUP` 标签、标题、简短说明和三项工作空间用途，承担信任与上下文建立。
- 右侧是白色表单面板，包含步骤标签、工作空间名称输入、辅助说明和主操作按钮。
- 使用 `#EE752F` 作为品牌强调色，`#111827` 作为正文色，白色与浅灰背景作为表面层。
- 标题使用 Noto Serif SC，正文使用 Noto Sans SC，步骤与标签使用 IBM Plex Mono。
- 使用 4/8/12/16/24/32 间距以及 4/8 圆角；装饰仅使用细边框、短橙色标记和轻量背景网格，不引入登录页的深色剧场视觉。

## 交互与可访问性

- 表单继续使用原生 `required` 和 `maxlength` 校验，输入框始终保留显式 `label`。
- 提交时禁用按钮并将状态文本标记为 pending，避免重复提交。
- 服务端错误通过 `role="status"` 展示在表单下方，并使用 error 状态色。
- 输入框使用清晰的橙色 focus ring；窄屏下内容垂直排列，页面不产生横向滚动。
- `AuthGate`、接口地址、请求体、幂等键和成功跳转均不改变。

## 实现边界

- `BaseLayout` 为该页面增加 `onboarding-page` 页面类，以便安全限定布局和站点头尾样式。
- `/onboarding` 更新语义化结构与文案层级，但不引入新的前端框架或状态管理。
- 新增或调整 onboarding 专属 CSS，避免继续扩大通用 `.auth-card` 规则的职责。

## 验证

- `pnpm --filter @duoduo/web typecheck`
- `pnpm --filter @duoduo/web test`
- `pnpm --filter @duoduo/web build`
- `pnpm lint`
- `pnpm format:check`
- 浏览器检查桌面宽度和窄屏宽度，确认创建表单、提交中状态、错误状态和无横向溢出。

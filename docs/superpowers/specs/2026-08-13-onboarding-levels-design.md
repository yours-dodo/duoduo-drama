# Onboarding 页面首页主题重构设计

## 背景

`/onboarding` 是已登录但尚未创建团队的用户进入创作工作区前的设置页面。此前页面使用浅色 Levels 表单布局，虽然引用了橙色品牌色，但与首页实际使用的暗色剧场、故事节点图和悬浮 Header 视觉体系不一致。

## 目标

- 让 onboarding 与首页使用同一套暗色公共画布和故事创作语言。
- 复用首页的视觉层级：暗色背景、半透明悬浮导航、深色面板、橙色连接线与节点。
- 保持创建工作空间的业务流程：提交 `POST /api/v1/teams`，携带 `Idempotency-Key`，成功后跳转 `/workspace`。
- 保留可访问的表单标签、原生校验、提交中状态和错误状态。
- 在桌面端形成“故事空间预览 + 创建表单”双栏布局，移动端垂直堆叠且无横向溢出。

## 视觉方案

页面采用首页的“Story Creation Universe”方向：

- 页面画布使用 `#080808`，面板使用 `#0D0D0F`，节点使用 `#151517`。
- 文字使用首页的 `#F5F3EF` 与 `#99999F` 层级，品牌强调使用 `#EE752F`，悬停色使用 `#FF8C4D`。
- Header 改为首页同款固定悬浮玻璃面板，使用半透明暗色背景、细边框、14px 圆角和 backdrop blur。
- 左侧用故事节点图表达“创作空间正在建立”：中心节点为 WORKSPACE，周围连接故事、短剧、协作三个方向，使用细橙色连线。
- 右侧为深色创建面板，顶部展示 `WORKSPACE / SETUP` 和 `01 / 01`，表单控件与首页登录页保持同样的深色输入框和橙色 CTA。
- 标题使用 Noto Serif SC，正文使用 Noto Sans SC，元信息使用 IBM Plex Mono；圆角主要使用 8px/14px，保留首页的轻微阴影和空间感。

## 交互与可访问性

- `AuthGate`、接口地址、请求体、幂等键和成功跳转均不改变。
- 输入框继续使用显式 `label`、`required`、`maxlength` 和 `autocomplete`。
- 提交时按钮禁用并设置 `aria-busy`，状态文本通过 `role="status"` 和 `aria-live="polite"` 展示。
- 请求失败时显示错误状态并恢复按钮；输入框使用橙色 focus ring。
- 视觉节点图仅作为装饰和上下文，不承担交互功能；其无障碍描述由外层 `aria-label` 提供。

## 实现边界

- `/onboarding` 增加页面主题类，专属样式限定在 `body.onboarding-page` 下。
- 页面结构增加首页同款故事预览区，但不引入新框架、不复制业务逻辑、不修改 Server API。
- 不调整首页、登录页和工作台现有样式，只通过 onboarding 作用域建立同源视觉。

## 验证

- `pnpm --filter @duoduo/web typecheck`
- `pnpm --filter @duoduo/web test`
- `pnpm --filter @duoduo/web build`
- `pnpm lint`
- `pnpm format:check`
- 浏览器检查桌面宽度和窄屏宽度，确认暗色主题、表单提交状态、错误状态和无横向溢出。

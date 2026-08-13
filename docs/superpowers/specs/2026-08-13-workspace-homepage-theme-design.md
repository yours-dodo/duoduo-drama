# Workspace 页面首页主题对齐设计

## 背景

`/workspace` 是用户完成登录和团队创建后的创作方向选择页。当前页面复用通用浅色入口卡片，与首页的暗色剧场画布、悬浮 Header 和故事宇宙视觉不一致。

## 目标

- 让 `/workspace` 与首页共享暗色公共画布、字体层级、面板材质和橙色品牌强调。
- 保留“故事创作”和“短剧创作”两个入口及其 `/stories`、`/dramas` 路由。
- 保留 `AuthGate requireTeam`，不改变认证和团队校验流程。
- 桌面端突出两个创作方向，移动端垂直排列且无横向溢出。

## 视觉方案

- 页面使用首页同款 `#080808` 画布、`#0D0D0F` 面板、`#151517` raised surface、`#F5F3EF` 主文字、`#99999F` 次级文字和 `#EE752F` 品牌色。
- Header 复用首页的固定悬浮暗色玻璃样式；workspace 页面不额外引入新的导航行为。
- 顶部主标题继续表达“选择你的创作方向”，下方增加 `CREATIVE WORKSPACE / CHOOSE YOUR PATH` 元信息和简短说明。
- 两张入口卡片采用深色面板和轻量故事/制作视觉：故事卡展示中心节点与人物、世界、剧情连接；短剧卡展示剧本、镜头和制作状态条。
- 卡片保留明确的 `A / STORY`、`B / DRAMA` 标签、标题、说明与箭头，hover/focus 使用橙色边框和轻微位移。
- 不复制首页完整 Hero，不引入额外业务状态或前端框架。

## 可访问性与响应式

- 两个入口继续使用语义化 `<a>`，完整支持键盘 focus-visible。
- 装饰性节点和线条使用 `aria-hidden`，卡片文字作为真实可读内容。
- 桌面端双列，窄屏端单列；在 390px 宽度下保持内容不溢出。

## 验证

- `pnpm --filter @duoduo/web typecheck`
- `pnpm --filter @duoduo/web test`
- `pnpm --filter @duoduo/web build`
- `pnpm lint`
- 浏览器检查 `/workspace` 桌面/移动布局与两个入口链接。

# 工作台入口卡片呼吸动画移除设计

## 目标

移除工作台首页故事卡片和短剧卡片 hover/focus 状态中的持续呼吸光晕动画，降低视觉干扰，同时保留静态 hover 反馈。

## 范围

- 修改 `apps/web/src/styles/workspace.css`。
- 删除 `workspace-card-glow` keyframes 及两张卡片对该动画的引用。
- 保留卡片的静态光晕、边框、高亮和上浮效果。
- 更新 `apps/web/src/styles/workspace-theme.test.ts`，验证卡片不再使用持续动画。
- 不影响加载状态脉冲、页面入场动画、按钮交互或其他页面。

## 验证

- 运行工作台样式测试和 Web 类型检查。
- 运行 Web 构建。
- 检查差异，确认只涉及卡片动画规则与对应测试。

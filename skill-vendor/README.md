# 外部参考 Skill

此目录用于保存从外部拉取、供开发者和 AI 阅读的参考 Skill。参考 Skill 只存在于本地，不属于 pnpm workspace，也不能成为正式代码的构建或运行时依赖。

建议使用以下方式拉取并固定参考版本：

```sh
git clone <repository-url> skill-vendor/<project-name>
git -C skill-vendor/<project-name> checkout <commit>
```

使用参考代码前应检查其许可证。可以借鉴架构和实现思路，但不得复制许可证不允许使用的代码。除本说明外，`skill-vendor/*` 均由 Git 忽略。

# 项目内聚目录与分层 AGENTS.md 实施计划

1. 将公共 TypeScript 规则迁移到根目录 `tsconfig.base.json`。
2. 移除 Server、Agent 对共享包的依赖，并将健康接口类型就近定义。
3. 从 pnpm workspace 删除 `packages/*`，清理对应源码与锁文件记录。
4. 为 Web、Server、Mobile、Agent 和 Vendor 创建局部 `AGENTS.md`。
5. 更新根 `AGENTS.md`、README 和 Git 忽略规则。
6. 验证 workspace 清单、残留依赖、格式、Lint、类型、测试和构建。

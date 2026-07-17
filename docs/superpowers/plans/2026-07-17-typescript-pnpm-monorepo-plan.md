# TypeScript + pnpm Monorepo 实施计划

1. 建立 pnpm workspace、根脚本和统一 TypeScript、ESLint、Prettier、Vitest 配置。
2. 初始化 Nuxt Web、NestJS Server、Hono Agent，并为移动端保留说明目录。
3. 初始化 domain、contracts、shared、config、tsconfig 共享包及最小测试。
4. 配置本地 `vendor/` 参考项目目录的忽略和使用规范。
5. 安装依赖，运行格式、静态检查、类型检查、测试和生产构建。
6. 更新 README 与 AGENTS.md，记录目录和可复现命令。

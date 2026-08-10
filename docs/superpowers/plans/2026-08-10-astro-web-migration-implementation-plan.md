# Astro C 端 Web 迁移实施计划

> 日期：2026-08-10
>
> 状态：执行中
>
> 依据：[Astro C 端 Web 设计](../specs/2026-08-10-astro-web-design.md)

## 1. 目标

将当前最小 Nuxt `apps/web` 切换为 Astro Web workspace，并建立按业务域划分的前端宿主：Astro 负责 SEO 首屏和页面壳，Vue 负责故事创作入口，React 负责短剧项目入口。首轮只建立可靠的架构接缝和可运行页面，不伪造尚未完成的业务流程。

最终保持：

- workspace 名称 `@duoduo/web`。
- Web 开发端口 3000。
- Server 继续运行在 3001，并作为认证、授权和业务 API 的唯一权威。
- 根级 `pnpm dev`、`pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm format:check` 和 `pnpm test` 继续可用。

## 2. 当前基线与约束

- `apps/web` 只有 `app/app.vue`、`nuxt.config.ts`、`package.json` 和 Nuxt 生成的 TypeScript 配置。
- 当前 Web 没有业务页面、API 适配器、状态库或组件系统，因此不做逐页迁移。
- 故事和短剧后端仍按业务领域由 `apps/server` 负责；Web 不直接访问 Agent、数据库或对象存储 SDK。
- 工作区存在用户未提交的 Server/MinIO 修改，以及在计划生成期间出现的其他 Server 文件。本计划不回滚、不重排、不覆盖它们。
- `docs/superpowers` 在仓库中被忽略；本计划文档和设计文档都必须使用精确路径强制纳入提交，不能暂存其他文件。

## 3. 实施原则

- 先建立最小可运行 Astro 基座，再增加业务模块边界。
- 公开首页保持静态预渲染；需要 Cookie 或动态数据的页面使用 Node adapter 和按请求渲染。
- 故事业务页面只加载 Vue；短剧业务页面只加载 React；不在同一工作台混用两套客户端状态。
- 共享代码只包含稳定的框架无关请求适配、传输类型和设计变量，先留在 `apps/web`。
- Astro 页面壳不复制 Server 授权规则；页面守卫只调用 Server 会话接口或响应 Server 的 401/403。
- 每个切片完成后运行与其风险匹配的验证，并形成聚焦提交；所有提交只包含本切片明确的文件。

## 4. 目标目录

```text
apps/web/
├── src/
│   ├── components/astro/
│   ├── features/
│   │   ├── story/                 # Vue
│   │   └── drama/                 # React
│   ├── layouts/
│   ├── lib/
│   │   ├── server-api/
│   │   ├── session/
│   │   └── shared/
│   ├── pages/
│   ├── styles/
│   ├── env.d.ts
│   └── middleware.ts
├── public/
├── astro.config.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## 5. 通用验证命令

Web 切片至少运行：

```bash
pnpm --filter @duoduo/web test
pnpm --filter @duoduo/web typecheck
pnpm --filter @duoduo/web build
```

最终验证运行：

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm lint
pnpm format:check
git diff --check
git status --short
```

用户可见页面还要在浏览器中检查桌面宽度和窄屏宽度，并确认首页初始 HTML 的 SEO 内容和业务入口资源加载边界。

## 6. 切片 W01：替换 Nuxt 基座为 Astro

### 目标

删除 Nuxt 应用壳，建立 Astro + Node adapter + Vue integration + React integration 的最小可运行 workspace，并保留包名、端口和根级脚本语义。

### 文件

- 修改 `apps/web/package.json`。
- 删除 `apps/web/nuxt.config.ts`。
- 替换 `apps/web/tsconfig.json` 为 Astro 严格 TypeScript 配置。
- 新增 `apps/web/astro.config.ts`。
- 新增 `apps/web/src/pages/index.astro`。
- 新增 `apps/web/src/layouts/BaseLayout.astro`。
- 新增 `apps/web/src/env.d.ts`。
- 根据仓库忽略规则更新 `.gitignore`，确保 Astro 生成目录不入库。
- 更新 `apps/web/AGENTS.md` 的框架、目录和命令说明。
- 更新 README 中 Web 框架和主要目录描述。
- 更新 pnpm lockfile。

### 实施步骤

1. 确认当前 Node/pnpm 版本和工作区依赖状态；不删除用户生成的 `.nuxt` 或 `.output`，仅确保它们被忽略。
2. 替换 Web package scripts 为 Astro 的 `dev`、`build`、`preview`、`typecheck` 和 `test` 语义。
3. 加入 Astro、Node adapter、Vue、React、两套官方 renderer 和已有 Vitest/TypeScript 依赖。
4. 建立默认静态输出和按需渲染接缝，端口固定为 3000。
5. 用 Astro 首页替换原 Nuxt 占位页，先保持最小内容和可访问结构。
6. 运行 Web 构建与类型检查，修复配置和生成类型问题。

### 验收

- `pnpm --filter @duoduo/web dev` 可启动 Astro 3000。
- 首页返回完整 HTML，且不依赖 Vue/React hydration 才能显示基础内容。
- `pnpm --filter @duoduo/web typecheck`、`build`、`test` 通过。
- `apps/web` 不再直接依赖 Nuxt 或 `vue-router`。

### 提交

`refactor(web): replace nuxt shell with astro`

## 7. 切片 W02：SEO 首屏和公开页面壳

### 目标

建立真正可抓取的公开首屏，包含基础 SEO、语义结构、CTA 和不依赖客户端 JavaScript 的页面入口。

### 文件

- 修改 `apps/web/src/pages/index.astro`。
- 修改 `apps/web/src/layouts/BaseLayout.astro`。
- 新增 `apps/web/src/components/astro/SeoHead.astro`。
- 新增 `apps/web/src/components/astro/SiteHeader.astro`。
- 新增 `apps/web/src/components/astro/SiteFooter.astro`。
- 新增 `apps/web/public/robots.txt`。
- 新增 `apps/web/public/favicon.svg` 或等价的静态品牌资源。
- 按需要新增公开页样式和首页测试。

### 实施步骤

1. 定义首页唯一标题、description、canonical 和语言属性。
2. 建立语义化首屏：品牌说明、产品价值、故事创作和短剧制作入口、登录/开始创作 CTA。
3. 添加 Open Graph 基础字段和未来可扩展的 JSON-LD 接缝，不生成与可见内容不一致的结构化数据。
4. 让所有 CTA 使用普通链接，确保无 JavaScript 也能进入登录和工作台路由。
5. 控制首屏 CSS、图片尺寸和字体加载，避免引入任何工作台客户端包。
6. 为 `robots.txt` 排除 `/login` 和 `/app/`，为未来 sitemap 保留明确位置。

### 验收

- `curl` 或 Astro preview 返回的首页 HTML 直接包含核心文案、`h1`、CTA 和 SEO metadata。
- 首页静态资源中没有故事 Vue 或短剧 React 工作台 bundle。
- 键盘操作、焦点可见性、图片替代文本和窄屏布局通过浏览器检查。

### 提交

`feat(web): add seo landing page shell`

## 8. 切片 W03：同源 API 与会话接缝

### 目标

建立框架无关的 Server API 适配器和同源 `/api/*` 开发接缝，为 Vue 故事与 React 短剧共同使用；不新增业务授权逻辑。

### 文件

- 新增 `apps/web/src/lib/server-api/http-client.ts`。
- 新增 `apps/web/src/lib/server-api/api-error.ts`。
- 新增 `apps/web/src/lib/server-api/session-api.ts`。
- 新增 `apps/web/src/lib/session/session-types.ts`。
- 新增 `apps/web/src/lib/session/session-navigation.ts`。
- 新增 Astro API forwarding 或开发代理配置。
- 新增相关单元测试。
- 按需要修改 `apps/web/astro.config.ts` 和环境类型。

### 实施步骤

1. 统一 API base path 为 `/api`；开发环境代理到 `http://localhost:3001`。
2. 保留 Cookie credentials、请求取消、超时、request ID 和 JSON 错误转换。
3. 将 Server 的 401、403、404、409、422 和 5xx 映射为 Web 层稳定错误类别。
4. 实现 `GET /api/me` 或等价会话查询的最小客户端适配；不在 Web 解析 Cookie token。
5. 对需要认证的 Astro 路由提供登录跳转接缝；业务权限仍由 Server 返回结果决定。
6. 为 API client、错误映射和未登录跳转补充测试。

### 验收

- 浏览器只以当前 Web origin 请求 `/api/*`。
- 未登录、会话过期和网络失败有明确状态。
- API client 不导入 Server 源码、Prisma 类型、Agent 代码或数据库 SDK。
- Server 现有 CORS/trusted origin 规则不被 Web 绕过或复制。

### 提交

`feat(web): add server api and session boundary`

## 9. 切片 W04：Vue 故事项目入口

### 目标

建立故事项目的 Vue 路由模块和最小工作台壳，使其可以承载故事项目、对话和成果 API；不在本切片实现完整故事 MVP。

### 文件

- 新增 `apps/web/src/pages/app/stories/index.astro`。
- 新增 `apps/web/src/pages/app/stories/[projectId].astro`。
- 新增 `apps/web/src/features/story/StoryApp.vue`。
- 新增 `apps/web/src/features/story/api/story-api.ts`。
- 新增 `apps/web/src/features/story/state/` 下的最小 Vue 状态模块。
- 新增 `apps/web/src/features/story/components/StoryWorkspaceShell.vue`。
- 新增故事入口和加载/错误状态测试。

### 实施步骤

1. 在 Astro 页面中只挂载 Vue 故事应用；故事路由不引入 React 组件。
2. 建立项目列表、项目空状态、当前项目和对话区域的最小布局。
3. 通过共享 Server API 适配器获取会话和项目数据；不把权限规则写进 Vue。
4. 为加载、空项目、401、403、404、网络失败和重试设计明确状态。
5. 预留故事消息、生成请求、成果草稿和版本历史的组件边界，等 Server API 完成后接入。

### 验收

- `/app/stories` 和 `/app/stories/[projectId]` 加载 Vue 入口。
- 页面不加载短剧 React 工作台资源。
- 刷新和未登录访问可以进入统一会话处理流程。
- Vue 文件通过 Astro 类型检查，测试覆盖入口和关键状态。

### 提交

`feat(web): add vue story workspace boundary`

## 10. 切片 W05：React 短剧项目入口

### 目标

建立短剧项目的 React 路由模块和最小工作台壳，使未来剧集、场景、镜头、素材和视频流程有独立的客户端边界。

### 文件

- 新增 `apps/web/src/pages/app/dramas/index.astro`。
- 新增 `apps/web/src/pages/app/dramas/[projectId].astro`。
- 新增 `apps/web/src/features/drama/DramaApp.tsx`。
- 新增 `apps/web/src/features/drama/api/drama-api.ts`。
- 新增 `apps/web/src/features/drama/state/` 下的最小 React 状态模块。
- 新增 `apps/web/src/features/drama/components/DramaWorkspaceShell.tsx`。
- 新增短剧入口和加载/错误状态测试。

### 实施步骤

1. 在 Astro 页面中只挂载 React 短剧应用；短剧路由不引入 Vue 业务组件。
2. 建立短剧项目空状态、项目导航和后续制作流程的布局占位。
3. 通过共享 Server API 适配器接入会话和未来短剧 API；不在 React 中复制授权。
4. 为加载、空项目、未实现能力、401、403、404 和网络失败提供可理解反馈。
5. 确认短剧入口只发送 React 资源，不影响公开首页和故事页面。

### 验收

- `/app/dramas` 和 `/app/dramas/[projectId]` 加载 React 入口。
- 页面不加载故事 Vue 工作台资源。
- React 文件通过 Astro 类型检查，测试覆盖入口和关键状态。

### 提交

`feat(web): add react drama workspace boundary`

## 11. 切片 W06：工作台加载、路由和浏览器验收

### 目标

把公开页、登录入口、故事入口和短剧入口串成可验证的页面流程，并完成最终质量检查。

### 实施步骤

1. 为 `/app` 增加会话后默认入口跳转；未登录进入 `/login`。
2. 为保护路由统一接入 Astro 页面壳、加载态、错误边界和 Server 401/403 映射。
3. 检查页面分包，确认首页不包含 Vue/React 工作台 bundle，故事页不包含 React 工作台 bundle，短剧页不包含 Vue 工作台 bundle。
4. 在桌面和窄屏浏览器中检查首页、登录、故事入口和短剧入口。
5. 运行 Web 级和根级验证命令。
6. 检查 Git 状态、差异和忽略文件，确保未提交 Server/MinIO 修改没有被混入。

### 验收

- 页面路由、会话跳转和失败状态可重复验证。
- 首页 SEO HTML、资源分包和布局稳定性符合设计规范。
- Vue/React 业务域边界可从目录、路由和构建产物中确认。
- 全部适用检查通过。

### 提交

`test(web): verify astro app boundaries`

## 12. 风险与处理

- Astro 版本、Node adapter 或 renderer 的 peer dependency 不匹配：以仓库 Node 22 和 pnpm 10 为基线，先完成单 workspace 安装与构建，再进入页面切片。
- Vue 与 React 同项目类型检查配置冲突：按目录隔离 renderer 配置，保持 `.astro/types.d.ts`、Vue 和 React 类型包含完整。
- 生产环境反向代理未准备：先让开发环境 `/api` 代理可用，并在 Web 文档中明确生产需要的同源 forwarding 和 trusted origin 配置。
- C 端业务 API 尚未完整：先交付稳定入口、加载态和错误态，不伪造服务端数据，不让 Web 绕过 Server。
- 多框架依赖造成公开页面体积变大：用路由级导入验证 bundle，公开页面不导入业务入口。
- 工作区存在用户修改：每个切片开始和结束都检查 `git status --short`，只暂存本切片文件。

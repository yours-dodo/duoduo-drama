# Astro C 端 Web 设计

**日期：** 2026-08-10

**状态：** 设计方向已确认，等待文档审阅

## 1. 决策摘要

将 `apps/web` 从当前最小 Nuxt 4 应用切换为 Astro 应用。Astro 作为统一的页面宿主、SEO 层和路由壳；登录后的业务工作台按业务领域使用不同的 UI 框架：故事创作用 Vue，短剧项目用 React。

```text
Astro Web 宿主
├── 公开首页和公开内容页       Astro 静态 HTML / 按需 SSR
├── 登录和会话入口              Astro 页面
├── 故事项目                    Vue 应用模块
└── 短剧项目                    React 应用模块
```

Astro 支持 Vue 3 和 React 集成，也支持在一个项目内使用多个 UI 框架；本方案利用这种能力做业务域隔离，不把一个交互页面拆成两套框架。[Astro Islands 与多框架支持](https://docs.astro.build/en/concepts/islands/)

本阶段不建设真正的运行时微前端。故事项目和短剧项目在代码边界上保持可独立抽取，但暂时共享 `apps/web` 的构建产物、部署单元和页面宿主。未来只有在需要独立团队、独立发布或独立扩缩容时，才评估 Module Federation、iframe 或独立子应用部署。

`@duoduo/web` 包名、开发端口 3000 和 `apps/web` workspace 保持不变。Server、Agent、数据库、认证策略和业务领域模型不因前端框架切换而改变。

## 2. 目标

- 让公开首屏以完整、语义化的 HTML 交付，支持 SEO、分享预览和快速首屏加载。
- 让公开页面不加载故事创作和短剧制作工作台的客户端 JavaScript。
- 在同一个 Web 应用中承载 Vue 故事项目和 React 短剧项目。
- 保持两类 C 端功能通过现有 NestJS Server API 访问业务能力。
- 保持 Server 作为认证、授权、业务规则和持久化的唯一权威。
- 为未来拆分故事或短剧子应用保留明确的模块和路由边界。
- 在当前 `apps/web` 只有 Nuxt 占位页面的前提下完成低成本基座切换，不引入无关重构。

## 3. 非目标

本阶段不包含：

- 立即把故事项目或短剧项目拆成独立 workspace、独立部署或运行时微前端。
- 在 Astro 中重复实现 Server 的身份认证、租户权限、项目权限或业务规则。
- Web 直接调用 Agent 服务、模型 Provider、数据库或对象存储 SDK。
- 完成短剧项目的领域模型、剧集、场景、镜头、视频生成和导出功能。
- 完成完整故事创作产品流程；故事工作台页面只建立能承载现有故事系统 API 的前端边界。
- 为公开页面引入不必要的 React/Vue 客户端运行时。
- 因为框架切换抽取新的共享 package；共享代码先留在 `apps/web`，等存在稳定的跨项目消费者后再评估提取。

## 4. 总体架构

```text
浏览器
  │
  ├── GET /                         ──→ Astro 预渲染 SEO 页面
  ├── GET /login                    ──→ Astro 会话入口
  ├── GET /app/stories/...          ──→ Astro 路由壳 + Vue 故事应用
  ├── GET /app/dramas/...           ──→ Astro 路由壳 + React 短剧应用
  └── /api/...                      ──→ Web API 适配层 ──→ NestJS Server
                                                         └─→ 数据库/Agent/对象存储
```

### 4.1 Astro 渲染策略

采用 Astro 的默认静态预渲染作为公开页面的基础，并安装 Node SSR adapter，以便需要 Cookie、实时数据或访问控制的路由按请求渲染。需要按请求渲染的页面显式设置 `prerender = false`；其余页面仍然保留静态 HTML 输出。Astro 官方文档明确支持这种“默认静态、按路由退出预渲染”的方式。[Astro 按需渲染](https://docs.astro.build/en/guides/on-demand-rendering/)

初始路由策略如下：

- `/`、公开介绍页和未来公开内容详情页默认静态预渲染。
- `/login`、`/app/*` 使用按请求渲染的 Astro 页面壳，避免把认证相关内容写入静态产物。
- 故事和短剧业务应用作为各自路由下的完整 Vue/React 应用模块运行，不在公开页面加载。
- 页面壳只负责布局、标题、加载占位和错误边界；业务交互由对应框架模块负责。

### 4.2 框架边界

Astro 页面可以引入 Vue 和 React，但框架边界必须按业务域保持清晰：

- `src/features/story/` 只放 Vue 故事创作代码。
- `src/features/drama/` 只放 React 短剧制作代码。
- 一个业务页面只选择一种客户端 UI 框架，不在同一工作台内部混用 Vue 和 React。
- Astro 布局、SEO 组件和静态内容不得持有故事或短剧的客户端业务状态。
- 故事和短剧模块之间不得互相 import 组件、store、composable、hook 或路由。
- 需要共享的内容仅限于框架无关的请求封装、传输类型、会话状态表示、设计变量和通用工具。

这种边界使“故事用 Vue、短剧用 React”成为业务架构决策，而不是局部技术偏好；未来可以在不修改业务页面内部状态模型的前提下独立抽取任一模块。

## 5. 应用结构

目标目录结构如下：

```text
apps/web/
├── src/
│   ├── components/
│   │   ├── astro/                 # 页面布局、SEO、导航、错误和加载壳
│   │   ├── vue/                   # 可跨页面复用但不属于单一业务的 Vue UI
│   │   └── react/                 # 可跨页面复用但不属于单一业务的 React UI
│   ├── features/
│   │   ├── story/                 # Vue 故事项目及其状态、视图和适配器
│   │   └── drama/                 # React 短剧项目及其状态、视图和适配器
│   ├── layouts/                   # Astro 页面布局
│   ├── lib/
│   │   ├── server-api/            # 面向 Server 的框架无关请求适配
│   │   ├── session/               # 会话状态表示和登录跳转辅助
│   │   └── shared/                # 仅限稳定、框架无关的工具
│   ├── pages/                     # Astro 文件路由
│   ├── styles/                    # 全局 token、基础样式和公开页面样式
│   ├── env.d.ts
│   └── middleware.ts              # 仅做请求级页面接缝，不复制权限规则
├── public/                        # 不需要构建处理的静态资源
├── astro.config.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

目录只在真实功能需要时创建。故事和短剧模块内部可以继续按页面、组件、状态、查询和服务划分，但业务代码必须留在自己的 feature 目录中。

## 6. 路由设计

第一阶段建立以下宿主路由：

```text
/
├── /login
├── /app
│   ├── /stories
│   ├── /stories/[projectId]
│   ├── /dramas
│   └── /dramas/[projectId]
├── /404
└── /500
```

路由职责：

- `/` 是 SEO 首屏和进入 C 端功能的入口，使用 Astro 页面，不挂载完整业务应用。
- `/login` 展示登录入口和会话失败反馈；登录动作通过 Server API 完成。
- `/app/stories` 与 `/app/stories/[projectId]` 挂载 Vue 故事创作模块。
- `/app/dramas` 与 `/app/dramas/[projectId]` 挂载 React 短剧制作模块。
- `/app` 根据当前会话跳转到默认工作台；无会话时跳转 `/login`。
- 受保护页面统一提供加载、空数据、无权限、过期会话、网络失败和重试状态。

故事项目和短剧项目未来可以拥有各自的内部子路由，但内部导航不得跨越 Astro 宿主边界直接修改另一个业务模块的状态。

## 7. SEO 与首屏设计

公开首屏的 SEO 责任由 Astro 页面和布局承担：

- 使用唯一且准确的 `<title>`、`description`、canonical URL 和语言声明。
- 使用清晰的 `h1`、`h2` 层级和语义化 HTML，不把首屏核心文案放在客户端渲染组件中。
- 为首页和公开内容页提供 Open Graph、Twitter Card 和适当的分享图片信息。
- 在适合的公开内容页提供 JSON-LD；结构化数据必须与页面真实可见内容一致。
- 提供 `robots.txt` 和 `sitemap.xml`，排除登录页、工作台和需要会话的路由。
- 图片使用明确尺寸、可访问的替代文本和 Astro 可处理的构建路径；首屏关键图片避免无尺寸导致布局偏移。
- 公开页面的 CSS 和脚本按页面需要加载，不能因为注册 Vue/React 集成而自动发送完整工作台运行时。
- 公开页面首屏的主要内容、导航和进入 C 端的 CTA 在无 JavaScript 时仍可阅读和导航。

SEO 不以“使用 SSR”作为唯一验收条件。构建后的 HTML 必须包含核心首屏文案、标题和关键链接；性能验证同时检查首屏资源体积、布局稳定性和窄屏可用性。

## 8. C 端功能衔接与数据流

### 8.1 API 边界

Vue 故事模块和 React 短剧模块都通过 `src/lib/server-api/` 访问 NestJS Server：

```text
Vue Story UI ─┐
              ├─→ server-api adapter ─→ /api/* ─→ apps/server
React Drama UI┘
```

开发环境中 `/api/*` 通过 Web dev server 代理到 `http://localhost:3001`；生产环境使用同源反向代理或等价的 Web API forwarding，使浏览器以当前 Web origin 访问 API。前端不依赖跨域 Cookie 才能完成正常业务流程；如果部署环境必须跨域，则显式配置 Server 的 trusted origins 和 credentials。

API 适配层负责：

- URL 和 HTTP 方法映射。
- Cookie credentials 传播。
- JSON 请求和响应解析。
- Server 错误响应转换为 Web 层可显示的错误类型。
- 请求取消、超时和基础 request ID 传播。

API 适配层不负责业务授权、租户推断、Agent 编排或数据库访问。传输类型靠近适配器维护，只有在多个稳定消费者真实复用时才考虑提取共享 contracts package。

### 8.2 会话和授权

- Server 继续签发和撤销 `HttpOnly`、`SameSite=Lax` 的会话 Cookie。
- Astro 的页面级会话判断只能调用 Server 的会话接口或读取 Server 返回结果，不能自行解析或验证会话 token。
- Web 可以在未登录时做路由跳转和展示登录入口，但最终身份和权限判断始终由 Server 完成。
- 故事项目和短剧项目的租户、项目、协作者和资源权限不在 Vue/React 中复制。
- Cookie-authenticated 写操作继续遵循 Server 的 exact-Origin 和 CSRF 防护边界。

### 8.3 业务模块状态

- Vue 故事模块管理故事项目、对话、消息、成果草稿和版本视图状态。
- React 短剧模块管理短剧项目、剧集、场景、镜头、素材和制作流程视图状态。
- Server 返回的数据是权威状态；客户端状态只保存当前页面交互、缓存和乐观 UI 所需的数据。
- 故事与短剧的跨领域衔接通过 Server 提供的“已确认故事成果版本快照”完成，不通过两个前端模块直接共享运行时状态。

## 9. 公开页面与业务模块的加载边界

公开页面必须避免无意加载完整业务运行时：

- 首页只导入 Astro 组件和必要的轻量脚本。
- 故事 Vue 模块仅在 `/app/stories/*` 路由加载。
- 短剧 React 模块仅在 `/app/dramas/*` 路由加载。
- 同一业务路由只挂载一个完整客户端应用，避免 Vue 和 React 在同一工作台重复初始化。
- 登录页面可以使用普通 HTML 表单增强或单一框架组件，不要求同时加载 Vue 和 React。

## 10. 迁移范围

从当前 Nuxt 占位应用迁移到 Astro 时包含：

- 删除 Nuxt 配置、Nuxt 专用 TypeScript 继承和 Nuxt/Vue Router 运行依赖。
- 新增 Astro 配置、Node SSR adapter、Vue integration 和 React integration。
- 保持 `@duoduo/web`、3000 端口和根 workspace 启动命令语义不变。
- 将当前占位首页迁移为 Astro 页面，并补齐首屏 SEO 基础元数据。
- 建立公开页面、登录页、故事路由和短剧路由的页面壳与加载/错误状态。
- 建立 Vue 故事模块和 React 短剧模块的入口边界；业务功能按各自领域后续接入。
- 建立同源 `/api/*` 开发代理和生产部署约定。
- 更新 `apps/web/AGENTS.md`、README 中的 Web 框架、目录和命令说明。
- 更新 pnpm lockfile，并确保生成的 `.astro/`、`dist/` 和 SSR 构建产物不进入版本库。

不修改当前与 Web 无关的 Server/MinIO 未提交变更。

## 11. 测试与验证

### 构建和静态检查

- `pnpm --filter @duoduo/web dev` 能在 3000 启动 Astro。
- `pnpm --filter @duoduo/web build` 成功，并生成静态公开页面和可运行的按需渲染产物。
- `pnpm --filter @duoduo/web typecheck` 成功覆盖 `.astro`、Vue 和 React 文件。
- `pnpm --filter @duoduo/web test` 能运行 Web 测试；没有测试时也必须保持现有 `--passWithNoTests` 语义。
- 根目录 `pnpm lint` 和 `pnpm format:check` 通过。
- `git diff --check` 通过，且 `.nuxt/`、`.output/`、`.astro/`、`dist/` 和浏览器产物未被提交。

### 页面和路由验证

- 首页响应 HTML 直接包含核心标题、首屏文案、主要 CTA 和 SEO metadata。
- 首页不会加载故事 Vue 工作台或短剧 React 工作台的完整客户端包。
- `/app/stories` 加载 Vue 应用入口；`/app/dramas` 加载 React 应用入口。
- 未登录访问受保护路由时进入登录流程；登录状态失效时能够回到登录页并显示可理解的反馈。
- API 成功、401、403、404、409、422、5xx 和网络失败能够映射为明确的页面状态。
- 故事和短剧模块不会直接请求 Agent 服务或访问数据库。

### 浏览器验证

按照 Web 项目约定，对首页、登录页和两个业务入口分别在正常桌面宽度与窄屏移动宽度检查：

- 首屏布局、标题层级、导航和 CTA。
- 加载、空数据、错误、无权限和禁用状态。
- Vue 故事入口和 React 短剧入口是否各自加载正确的客户端资源。
- 登录 Cookie 传播、刷新页面后的会话恢复和退出登录。
- 无障碍基础行为，包括键盘焦点、表单标签、可见错误和图片替代文本。

## 12. 验收标准

设计落地后，以下条件必须同时满足：

1. `apps/web` 不再依赖 Nuxt，Astro 成为 Web workspace 的构建和运行时。
2. 公开首屏的核心内容在无 JavaScript 的初始 HTML 中可见，并具备完整 SEO 基础信息。
3. 故事项目路由只加载 Vue 业务模块，短剧项目路由只加载 React 业务模块。
4. 两个业务模块都通过 Server API 工作，Web 不直接连接 Agent、数据库或对象存储。
5. 登录态、授权和租户边界继续由 Server 负责。
6. 根目录的开发、构建、类型检查、测试、lint 和格式检查命令保持可用。
7. 现有与 Server/MinIO 相关的未提交修改没有被覆盖、重置或混入本次迁移提交。

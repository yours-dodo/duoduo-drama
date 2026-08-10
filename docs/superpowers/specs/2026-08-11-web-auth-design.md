# 官网验证码与密码登录设计

日期：2026-08-11

## 背景与目标

`apps/web` 已迁移到 Astro，并有 SEO 优先的官网首页。当前 Server 已具备用户、Session、团队租户和租户权限基础，但 Web 登录只完成了邮箱登录请求，尚未形成可使用的登录闭环。

本阶段只交付官网和登录能力，暂不实现故事创作或短剧工作台业务。登录支持邮箱验证码和邮箱密码两种方式；首次验证码登录自动创建账号，用户随后可设置密码。

## 用户流程

1. 访问官网首页，点击“开始创作”进入 `/login`。
2. 验证码登录：输入邮箱，申请 6 位验证码，进入验证码输入状态，验证成功后创建 Session。
3. 首次登录或尚未设置密码的用户进入设置密码页面；已设置密码的用户直接进入 `/app`。
4. 密码登录：输入邮箱和密码，验证成功后创建 Session。
5. 忘记密码：申请邮箱验证码，验证成功后设置新密码。
6. `/app` 首次读取当前 Session；未登录跳回 `/login`，没有团队的用户进入创建团队入口。

验证码通过 Server 的邮件投递端口发送。当前实现使用开发环境控制台适配器，打印收件邮箱、验证码和过期时间；该适配器禁止在 production 环境启动。未来接入真实邮件服务时只替换适配器，不改变应用层和 Web API。

## Server 设计

保留现有 Session Cookie 机制和租户边界。新增或调整以下能力：

- 邮箱验证码申请与验证；验证码仅保存不可逆摘要，10 分钟过期，最多 5 次尝试，并沿用邮箱/IP 限流。
- 用户可选密码摘要与设置密码流程。密码使用 Node 内置 `scrypt` 异步派生，不引入明文或可逆凭证。
- 密码登录与密码重置；重置必须先消费一次邮箱验证码。
- 所有认证失败返回稳定、不过度暴露账号是否存在的信息；成功响应通过 HttpOnly、SameSite=Lax Cookie 建立 Session。
- 生产环境拒绝启动控制台邮件适配器；验证码、密码和 Session token 不进入日志。

HTTP 接口使用明确的业务动作边界：

- `POST /v1/auth/email-code-requests`
- `POST /v1/auth/email-code-verifications`
- `POST /v1/auth/password-logins`
- `POST /v1/auth/passwords`（登录后首次设置或修改）
- `POST /v1/auth/password-reset-requests`
- `POST /v1/auth/password-reset-verifications`
- 复用现有 `GET /v1/me` 与 `DELETE /v1/auth/session`

旧的魔法链接实现可以保留为内部兼容代码，但不再作为官网入口；新的 Web 流程只使用验证码和密码。

## Web 设计

官网继续使用 Astro 静态页面和现有 SEO 元数据。`/login` 改为可访问的双模式表单，验证码申请后在同页切换到验证码输入，密码设置和重置使用独立的轻量 Astro 页面。浏览器只调用同源 `/api/v1/*` 代理，不读取或解析 Cookie。

登录状态由 Server 的 `/v1/me` 判断。Astro 页面负责首次导航，客户端脚本只处理表单提交、加载状态和错误反馈；故事 Vue 与短剧 React 工作台不进入本阶段验收。

## 安全与错误处理

- 邮箱验证码只在控制台开发适配器中可见；生产配置启动时 fail closed。
- 申请验证码接口使用统一成功文案，避免枚举账号。
- 验证码、密码均限制长度和尝试次数；验证码消费在数据库事务/行锁边界内完成。
- Cookie-authenticated 写操作继续通过现有可信 Origin 保护。
- 未登录访问 `/app/*` 时跳转 `/login`；无权限资源继续由 Server 返回统一错误。

## 验收与测试

- Server 单元测试覆盖验证码生命周期、密码派生/校验、首次注册、重复验证码、过期/锁定、密码重置和失败响应。
- Server HTTP 测试覆盖验证码登录、密码登录、设置密码、重置密码、Session Cookie 和未登录保护。
- Web 测试覆盖官网关键 SEO 标记、登录模式切换、成功/失败反馈和 `/app` 导航。
- 运行 Web typecheck/test/build，以及 Server 定向测试；再运行根 lint、typecheck、build 和可运行的全仓测试。

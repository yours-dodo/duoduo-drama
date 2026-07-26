# @duoduo/ai 实施状态

> 只有在对应命令通过后才记录证据。当前实现已完成 S01–S22，并于 2026 年 7 月 24 日完成一轮运行时逻辑硬化；八项门禁均已通过。候选发布版本已在不依赖 `vendor/pi` 的情况下完成验证，默认采用离线、确定性行为，并通过显式许可机制保护在线执行。
>
> 表格中的 `passed` 表示“通过”。该英文状态值由 `manifest:check` 作为机器可读标记使用，因此予以保留。

## 当前产品基线

2026 年 7 月 22 日按 YAGNI 原则移除了未被产品使用的 Radius Provider、Radius OAuth 和 PI Messages 私有协议；2026 年 7 月 27 日继续完整移除了无产品消费者的 GitHub Copilot Provider、专用 OAuth/token 交换和 endpoint 推导。当前发布面包含 38 个内建 Provider、59 个 manifest binding、75 个公共导出，以及 20 个公共协议子路径中的 51 个运行时协议符号；目录与 manifest 覆盖率仍为 100%，包测试为 69 个文件、413 项用例。下方 S01–S22 表格保留最初实施时的历史证据，因此其中 S09、S10、S21 和 S22 的原始能力与计数不代表当前发布面。

## 2026-07-24 运行时逻辑硬化

- Ambient 会话身份同时绑定授权作用域与凭证身份，阻止相同 ambient 凭证下的跨租户 session affinity 复用。
- Image/Video 鉴权改为使用当前协议 binding；纯媒体 Provider 不再绕过宿主凭证覆盖策略。
- 可恢复媒体任务使用独立的 10 秒 best-effort cancellation signal，确保本地 abort 后仍可尝试远端取消。
- SessionManager 在资源创建完成与 acquisition abort 竞态中可靠释放无人认领的资源。
- 显式请求级 `protocolOptions` 会先归一化为通用 tool/reasoning 选项；请求级通用选项仍拥有最高优先级。
- 已移除无消费者的 `RuntimeResourcePolicyInput.catalog`；旧配置在运行时显式报错，不再静默成为 no-op。
- 当前证据：70 个测试文件/412 项测试通过；`typecheck`、`build`、`api:check`、`manifest:check`、`catalog:update -- --check --offline`、`lint`、`format:check`、`release:check`、`release:no-vendor` 和 `git diff --check` 均通过。

## 实施切片

| 切片                                       | 状态   | 证据                                                                                                                                                                                                                                      |
| ------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S01 Faux 聊天追踪器                        | passed | `test -- --run core stream testing`、`typecheck`、`build`、`api:check`、`lint`、`format:check` 和 `git diff --check` 已于 2026 年 7 月 19 日通过。                                                                                        |
| S02 确定性的终结事件/工具失败路径          | passed | 23 项聚焦测试以及 `typecheck`、`build`、`api:check`、`lint`、`format:check`、`manifest:check` 和 `git diff --check` 已于 2026 年 7 月 19 日通过。                                                                                         |
| S03 OpenAI Responses 夹具传输              | passed | 共 41 项测试，包括 `test -- --run transport openai-responses openai`，以及 `typecheck`、`build`、`api:check`、`lint`、`format:check`、`manifest:check` 和 `git diff --check`，均已于 2026 年 7 月 19 日通过。                             |
| S04 作用域认证与目录持久化                 | passed | 共 59 项测试，包括 `test -- --run auth catalog runtime`，以及 `typecheck`、`build`、`api:check`、`lint`、`format:check`、`manifest:check` 和 `git diff --check`，均已于 2026 年 7 月 19 日通过。                                          |
| S05 可靠传输、会话与 Azure Responses       | passed | 共 94 项测试，包括 `test -- --run transport session azure-openai-responses`，以及 `typecheck`、`build`、`api:check`、`lint`、`format:check`、`manifest:check` 和 `git diff --check`，均已于 2026 年 7 月 19 日通过。                      |
| S06 Anthropic Messages 与 Anthropic OAuth  | passed | 共 119 项测试，其中包括 25 项聚焦的 Anthropic Messages、OAuth、运行时刷新/撤销和缓存成本测试；另有 `typecheck`、`build`、`api:check`、`lint`、`format:check`、`manifest:check` 和 `git diff --check`，均已于 2026 年 7 月 19 日通过。     |
| S07 Google、Vertex 与 Bedrock 环境认证路径 | passed | 共 142 项测试，包括 Google Developer API、Vertex API Key/ADC、Bedrock Bearer/AWS 签名、二进制事件流 CRC、环境策略/标识以及逐次重试授权覆盖；所有包级验证门禁均已于 2026 年 7 月 19 日通过。                                               |
| S08 OpenAI Chat 与兼容 Provider 批次       | passed | 共 174 项测试，包括 OpenAI Chat 协议兼容性矩阵，以及全部 17 个兼容 Provider 的认证/端点/请求/流/错误清单行；所有包级验证门禁均已于 2026 年 7 月 20 日通过。                                                                               |
| S09 多协议网关与 GitHub OAuth              | passed | 共 182 项测试，包括全部 19 个“网关 Provider × 协议”夹具、GitHub 设备/令牌交换，以及从凭证派生的端点隔离；所有包级验证门禁均已于 2026 年 7 月 20 日通过。                                                                                  |
| S10 Codex、Mistral、Radius 与 PI 对齐      | passed | 共 200 项测试，包括确定性的 36 Provider/10 协议对齐台账、Codex/Mistral/PI 流协议、五种 OAuth 刷新时间偏移、轮询/撤销和 Radius 发现隔离；所有包级验证门禁均已于 2026 年 7 月 20 日通过。                                                   |
| S11 Qwen 文本协议与原生 DashScope          | passed | 共 208 项测试，包括六区域共享/工作空间端点校验、四种确定性 Qwen 协议绑定、经过整理的原生 DashScope 文本/多模态路由，以及思考/工具/用量/重放归一化；所有包级验证门禁均已于 2026 年 7 月 20 日通过。                                        |
| S12 Doubao Responses 与 Ark 文本协议       | passed | 共 214 项测试，包括显式北京 Ark 端点解析、仅请求体模型 ID/端点 ID 绑定、Responses/Chat 兼容性选择，以及 Ark 思考/工具/重放归一化；所有包级验证门禁均已于 2026 年 7 月 20 日通过。                                                         |
| S13 OpenRouter 直接图像生成                | passed | 共 228 项测试，包括有序文本/引用输入、文本加多图输出、令牌/缓存成本、部分失败、中止、超时、存储认证隔离、注册表校验和仅公共入口的消费者编译；所有包级验证门禁均已于 2026 年 7 月 20 日通过。                                              |
| S14 可恢复生成与 Qwen 图像                 | passed | 共 241 项测试，包括操作信封策略、凭证证明、分离/序列化/解析/恢复、竞态仲裁、描述符一致性、Qwen Wan 直接/任务请求、轮询、输出、用量、任务 ID、中止和公共消费者覆盖；所有包级验证门禁均已于 2026 年 7 月 20 日通过。                        |
| S15 Doubao Seedream 直接图像               | passed | 共 245 项测试，包括显式模型 ID/端点 ID 请求体绑定、仅直接生成的 Ark 路由、URL/base64 输出、用量/错误归一化、Provider 标识隔离和公共消费者覆盖；所有包级验证门禁均已于 2026 年 7 月 20 日通过。                                            |
| S16 Grok Imagine 图像与视频                | passed | 共 272 项测试，包括官方图像生成/编辑，以及视频生成/编辑/扩展/轮询路由、请求 ID 校验、严格的可恢复声明、跨领域拒绝、用量/成本、临时制品和公共消费者覆盖；所有包级验证门禁均已于 2026 年 7 月 20 日通过。                                   |
| S17 Doubao Seedance 2.0 视频               | passed | 共 284 项测试，包括官方 Ark 任务创建/轮询、文本/图像/视频/音频引用、生命周期归一化、任务 ID 校验、临时制品、失败/过期处理和公共消费者覆盖；所有包级验证门禁均已于 2026 年 7 月 20 日通过。                                                |
| S18 Kling VIDEO 3.0 Omni 视频              | passed | 共 295 项测试，包括官方 Bearer 认证、Omni 文本/图像创建和任务查询路由、首帧/尾帧/参考图像角色、已提交/处理中/成功生命周期归一化、任务 ID 校验、30 天制品保留、本地取消和公共消费者覆盖；所有包级验证门禁均已于 2026 年 7 月 20 日通过。   |
| S19 第三方聚合器扩展协议                   | passed | 共 317 项测试，包括聊天/图像/视频能力组合、直接通道与聚合器通道标识、远程目录字段隔离、透明任务协议和聚合器自有任务协议、Provider 本地回退校验及公共消费者覆盖；所有包级验证门禁均已于 2026 年 7 月 20 日通过。                           |
| S20 自托管生成网关边界                     | passed | 共 334 项测试，包括动态图像/视频目录、可恢复的创建/轮询/取消生命周期、分离/恢复、计算用量、临时制品、网关适配器替换，以及通过故障关闭方式丢弃 GPU/容器/主机/IP 扩展字段；所有包级验证门禁均已于 2026 年 7 月 20 日通过。                  |
| S21 CLI、目录生成器与在线测试框架          | passed | 共 353 项测试，包括 40 Provider 清单/可用性、强化的非敏感配置/默认账号处理、加密凭证登录/退出、JSON 脱敏、密钥不可用隔离、确定性安全目录生成、公共消费者、导入图隔离和付费在线运行显式许可预算；包级验证门禁已于 2026 年 7 月 20 日通过。 |
| S22 候选发布版本验证                       | passed | 71 个文件中的 353 项测试全部通过；40/40 Provider 和 63/63 清单绑定达到 100% 覆盖；21 个协议子路径和 54 个运行时符号与设计清单匹配；包级与仓库级门禁、发布隔离、在线安全用例以及无 vendor 离线重装均已于 2026 年 7 月 20 日通过。          |

## 验证门禁

| 门禁          | 状态   | 证据                                                                                                                                                       |
| ------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 基础能力      | passed | S01 和 S02 已通过，并覆盖包测试、API、类型、构建、Lint 和格式门禁。                                                                                        |
| 运行时        | passed | S03–S05 已通过，并覆盖认证、目录、传输、会话和隔离。                                                                                                       |
| 协议          | passed | S03 和 S05–S12 已通过，并包含所有必需的协议适配器和 Provider 绑定。                                                                                        |
| 基线 Provider | passed | PI 文本基线已在 S10 通过，OpenRouter 直接图像已在 S13 通过。                                                                                               |
| 扩展 Provider | passed | S15 已完成内置 Qwen 和 Doubao 的直接/可恢复图像 Provider 路径。                                                                                            |
| 生成能力      | passed | S14–S16 已通过，并覆盖可恢复核心、Qwen/Doubao/xAI 图像路径，以及 Grok Imagine 视频生成/编辑/扩展/恢复。                                                    |
| 生成生态      | passed | S17–S20 已通过，并覆盖 Seedance、Kling、聚合器隔离和项目自有的自托管生成网关边界。                                                                         |
| 产品化        | passed | S21 和 S22 已通过，并覆盖 CLI、确定性目录生成、公共消费者、完整的 Provider/绑定/API 报告、导入图和密钥隔离、受保护的在线执行，以及无 vendor 离线重装验证。 |

## 候选发布版本证据

- CLI 强化后续工作之前已验证的源码基线：`9470635`（`feat(ai): finalize release candidate verification`）。
- 使用 Node.js `v22.16.0` 和 pnpm `10.28.1` 的验证重跑开始于 `2026-07-20T08:18:42Z`。
- 包级门禁均以退出码 `0` 结束：`format:check`、`lint`、`typecheck`、`test`、`build`、`api:check`、`manifest:check` 和 `release:check`。
- 包级报告：71 个测试文件/353 项测试通过；21 个协议子路径/54 个运行时符号与设计清单匹配；40/40 Provider、63/63 绑定、80 个公共导出通过清单覆盖检查。
- 仓库级门禁均以退出码 `0` 结束：`lint`、`format:check`、`typecheck`、`test` 和 `build`；`git diff --check` 也已通过。
- 在线测试框架证据仍保持离线：默认关闭时返回 `LIVE_DISABLED`/退出码 `3`；提供全部显式许可但未提供执行器时返回 `LIVE_EXECUTOR_NOT_CONFIGURED`/退出码 `69`；注入夹具执行器时返回退出码 `0`。未发送付费请求或网络请求。
- `release:check` 已通过生产导入图隔离、密钥金丝雀脱敏、夹具净化和默认关闭在线执行检查。
- `release:no-vendor` 已复制不含 `vendor` 的干净临时检出，执行 `pnpm install --offline --frozen-lockfile`，并通过包级 `typecheck`、`test` 和 `build`。

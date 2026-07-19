# Duoduo AI 可执行实施计划

> 对应设计：[`Duoduo AI 单包模块化设计`](../specs/2026-07-19-duoduo-ai-design.md)
>
> 当前事实：`packages/ai` 尚不存在，八个 gate 均未开始。本计划只安排 `@duoduo/ai`，不修改 Agent loop，不实现真实云 GPU 调度器。

## 1. 实施目标

交付一个单 workspace package `@duoduo/ai`，完成：

- PI AI 基线的 36 个文本 Provider、12 个文本 protocol、5 个 OAuth flow。
- Qwen、豆包的扩展文本协议。
- OpenRouter、Qwen、豆包与 xAI Grok Imagine 图片能力。
- xAI Grok Imagine、Seedance 2.0、Kling 与自建网关视频能力。
- 官方直连、第三方综合平台和自建 Generation Gateway 的统一扩展机制。
- 图片与视频共享的 operation/progress/artifact 深模块。
- 严格的认证、目录、transport、安全、Telemetry、CLI、fixture 与发布验证。

## 2. 第一性原理约束

实现过程中不得牺牲以下不变量：

1. **调用方只描述意图。** Agent 选择 Provider/model 并提交聊天、图片或视频输入，不认识 SDK、wire、GPU 实例或调度器。
2. **Provider 是访问渠道。** 官方直连、综合平台和自建网关是不同 Provider；`publisher/family` 不能替代 `providerInstanceId`。
3. **Protocol 只转换 wire。** Adapter 不选择 Provider、不读取凭据、不创建公共终态、不执行工具。
4. **领域类型保持独立。** 图片和视频共享任务状态机，不共享一个任意字段的 media request。
5. **恢复必须 fail closed。** operation ref 绑定 scope、credential、Provider config、model、profile 与兼容版本；任何不一致都在 poll 前失败。
6. **远端目录不可信。** discovery 只能提供模型事实，不能提供可执行 endpoint、auth、protocol 或 compatibility。
7. **第一版不隐式跨渠道选路。** 同模型的不同渠道返回不同 handle；价格路由和故障转移以后作为显式上层模块实现。
8. **云 GPU 位于网关后。** 本包交付自建网关 Provider 与 fake contract，不交付租赁、扩缩容、容器部署或 Worker 调度。
9. **每个切片都可观察。** 禁止先完成全部类型、再完成全部实现；每个切片必须从公共 export 走到确定性终态并有 fixture。
10. **证据先于状态。** 未运行切片验收命令，不得把 `IMPLEMENTATION-STATUS.md` 中的 gate 标为 `passed`。

## 3. 执行规则

- Node.js 22+，pnpm 使用根 `packageManager` 声明版本。
- 测试使用 Vitest，源码测试与实现就近放置为 `*.test.ts`。
- 每个切片遵循 Red → Green → Refactor：先提交失败测试，再写最小实现，再整理内部结构。
- 每个 Provider/protocol 必须通过公共 contract suite；不得只测私有函数。
- fixture 默认离线、确定、无真实 secret；真实 Provider 只允许显式 live runner。
- 每完成一个切片提交一次聚焦 commit。不得顺带提交工作树中与本计划无关的文件。
- 每个 gate 除专项命令外，都运行：

```bash
pnpm --filter @duoduo/ai format:check
pnpm --filter @duoduo/ai lint
pnpm --filter @duoduo/ai typecheck
pnpm --filter @duoduo/ai test
pnpm --filter @duoduo/ai build
pnpm --filter @duoduo/ai api:check
pnpm --filter @duoduo/ai manifest:check
git diff --check
```

## 4. 切片依赖图

```text
S01 → S02 → S03 → S04 → S05
                    ├── S06
                    ├── S07
                    └── S08
S05 + S06 + S07 + S08 + S09 → S10
S06 + S08 → S09
S08 → S11
S03 + S08 → S12
S09 → S13
S11 + S13 → S14
S12 + S14 → S15
S14 → S16
S16 → S17
S16 → S18
S16 → S19
S16 → S20
S10 + S11 + S15 + S17 + S18 + S19 + S20 → S21 → S22
```

可并行关系：S06/S07/S08 可并行；S17/S18/S19/S20 在 S16 后可并行。其他依赖以图为准。

## 5. 纵向实施切片

### S01：Faux 聊天 tracer `risk:high` `depends:[]`

> 完成后：一个只使用公共 export 的程序可以注册 Faux Provider、解析模型、流出文本并得到唯一 completed 终态。

**新增/修改文件**

- `pnpm-workspace.yaml`
- `packages/ai/package.json`
- `packages/ai/tsconfig.json`
- `packages/ai/AGENTS.md`
- `packages/ai/src/core/{models,content,messages,events,errors,usage}.ts`
- `packages/ai/src/stream/{event-stream,response-stream}.ts`
- `packages/ai/src/runtime/{create-ai,registry}.ts`
- `packages/ai/src/testing/faux.ts`
- `packages/ai/src/{index,testing}.ts`
- `packages/ai/src/**/*.test.ts`
- `packages/ai/test/consumer/faux-chat.ts`
- `packages/ai/IMPLEMENTATION-STATUS.md`

**Red**

- 写测试证明根入口无自动注册，空 Runtime 无模型。
- 写 Faux FIFO、惰性启动、单 iterator、`result()` 聚合、唯一 start/end 测试。
- 写公共 consumer fixture；未配置 export map 时编译必须失败。

**Green**

- 建立 ESM/NodeNext/declaration/export map。
- 实现最小 Provider registry、branded model handle、stream 状态机和 Faux controller。
- 让 consumer fixture 仅从 `@duoduo/ai` 与 `@duoduo/ai/testing` 导入。

**验收**

```bash
pnpm --filter @duoduo/ai test -- --run core stream testing
pnpm --filter @duoduo/ai typecheck
pnpm --filter @duoduo/ai build
```

建议提交：`feat(ai): add faux chat tracer`

### S02：确定性终态、工具与流失败路径 `risk:high` `depends:[S01]`

> 完成后：Faux 可以确定性演示文本、reasoning、完整/不完整 tool call、失败、取消、partial output 与背压。

**文件**

- `packages/ai/src/core/{tools,context,finish-reason}.ts`
- `packages/ai/src/stream/{attempt-sink,bounded-queue}.ts`
- `packages/ai/src/testing/{faux,assertions}.ts`
- 相邻 `*.test.ts`

**Red**

- 覆盖 tool JSON 修复后仍需 schema 校验、incomplete tool 不可执行、reasoning/text 交错。
- 覆盖 result-first drain、observer 溢出、提前 iterator return、abort 与 late event。
- 覆盖失败/取消只有一个终态且 partial 标记准确。

**Green**

- 完成 core 判别联合、纯工具 helper、attempt-local sink、有界 observer queue。
- Faux 只脚本化 protocol event，不直接构造 Runtime 公共终态。

**验收**

```bash
pnpm --filter @duoduo/ai test -- --run core stream testing
pnpm --filter @duoduo/ai api:check
```

通过后标记 Foundation gate；建议提交：`feat(ai): harden stream terminal semantics`

### S03：OpenAI Responses 外部调用 tracer `risk:high` `depends:[S02]`

> 完成后：fixture transport 上可以用 request credential override 调用 OpenAI Responses，得到文本/tool/reasoning/usage/cost 或规范化错误。

**文件**

- `packages/ai/src/transport/{types,request-transport,fixture-driver,network-policy}.ts`
- `packages/ai/src/auth/{secret-value,override-policy,api-key}.ts`
- `packages/ai/src/catalog/{model-source,resolver}.ts`
- `packages/ai/src/protocols/openai-responses/*`
- `packages/ai/src/providers/openai/*`
- `packages/ai/test/fixtures/openai-responses/*`

**Red**

- 请求 fixture 锁定 method、URL、protected Authorization、body 和流事件。
- 错误 fixture 覆盖 401、429、5xx、畸形 SSE、上下文溢出与 abort。
- secret canary 证明日志、异常、fixture record 和 model handle 不含 key。

**Green**

- 实现受保护 target、NetworkPolicy、SSE parser、OpenAI Responses contract/adapter/provider。
- catalog 返回 scope-bound handle；adapter 只收到已绑定 `RequestTransport`。
- 实现 usage/cost 与 response/replay ID。

**验收**

```bash
pnpm --filter @duoduo/ai test -- --run transport openai-responses openai
pnpm --filter @duoduo/ai manifest:check
```

建议提交：`feat(ai): add openai responses vertical path`

### S04：持久认证、scope 与目录缓存 `risk:high` `depends:[S03]`

> 完成后：OpenAI API-key login 后可在新 Runtime 中读取同一密封凭据和目录缓存，同时跨租户、换账号和 process-local 环境身份不会串用。

**文件**

- `packages/ai/src/auth/{credential-store,record-sealer,scope-authority,lease,login,ambient}.ts`
- `packages/ai/src/auth/node/{file-store,key-source,local-scope}.ts`
- `packages/ai/src/catalog/{cache-key,catalog-store,refresh-ticket,manifest}.ts`
- `packages/ai/src/runtime/{auth-coordinator,catalog-coordinator}.ts`
- `packages/ai/src/testing/{memory-stores,fake-clock}.ts`

**Red**

- 覆盖 API-key login/replace/logout、完整 record AEAD、CAS conflict、refresh lease takeover。
- 覆盖 tenant/subject/slot、credential instance、auth binding 和 Provider config 的 cache 隔离。
- 覆盖环境 key 变化、process-local identity 禁止持久 cache、旧 scope fingerprint key 验证。

**Green**

- 实现 store/codec/authority 端口及内存和 Node 安全实现。
- 实现 inventory 与 auth-aware model lookup 分离、ticket/TTL/stale-if-error。
- 所有密钥 materialize 仅发生在窄 trusted wrapper。

**验收**

```bash
pnpm --filter @duoduo/ai test -- --run auth catalog runtime
```

建议提交：`feat(ai): add scoped auth and catalog persistence`

### S05：可靠 transport、session 与 Azure Responses `risk:high` `depends:[S04]`

> 完成后：OpenAI/Azure Responses 在重定向、重试、超时、proxy、session affinity 和 dispose 竞态中仍保持受保护认证与唯一终态。

**文件**

- `packages/ai/src/transport/{dispatcher,retry,sse,websocket,resource-loader}.ts`
- `packages/ai/src/transport/node/{proxy-fetch,websocket}.ts`
- `packages/ai/src/session/{manager,lease}.ts`
- `packages/ai/src/protocols/azure-openai-responses/*`
- `packages/ai/src/providers/azure-openai-responses/*`
- 对应 fixture/tests

**Red**

- 覆盖 pre-dispatch/post-dispatch、幂等性、Retry-After、redirect 重新授权和 protected header 冲突。
- 覆盖 session ref-count、credential replacement、不完整 dispose 与 Runtime dispose。
- 覆盖 Azure resource/base URL/deployment/API version 每个 resolver 叶子。

**Green**

- 实现统一 dispatcher、retry safety、resource policy、session lifecycle。
- 复用 Responses 深模块实现 Azure binding，不复制 parser。

**验收**

```bash
pnpm --filter @duoduo/ai test -- --run transport session azure-openai-responses
```

通过后标记 Runtime gate；建议提交：`feat(ai): harden transport and azure responses`

### S06：Anthropic Messages 与 Anthropic OAuth `risk:high` `depends:[S04]`

> 完成后：Anthropic API key/OAuth 均可流式返回文本、thinking、tool、cache usage 和 replay signature，并能安全刷新/撤销凭据。

**文件**

- `packages/ai/src/protocols/anthropic-messages/*`
- `packages/ai/src/providers/anthropic/*`
- `packages/ai/src/auth/oauth/anthropic/*`
- `packages/ai/test/fixtures/anthropic/*`

**Red / Green**

- 先覆盖 system/multimodal/tool use/result、adaptive/budget thinking、redacted signature、1h cache、错误和 abort fixture。
- 再实现 adapter/profile/replay codec 与 OAuth create/refresh/revoke；SDK 延迟加载。
- 用 contract suite 证明 adapter 不接触 raw credential 或公共终态。

**验收**

```bash
pnpm --filter @duoduo/ai test -- --run anthropic-messages anthropic oauth
```

建议提交：`feat(ai): add anthropic messages and oauth`

### S07：Google、Vertex 与 Bedrock ambient 路径 `risk:high` `depends:[S04]`

> 完成后：Gemini Developer、Vertex API-key/ADC 和 Bedrock bearer/AWS ambient 均通过统一 Runtime，并保持不同认证与区域身份。

**文件**

- `packages/ai/src/protocols/{google-generative-ai,google-vertex,bedrock-converse-stream}/*`
- `packages/ai/src/providers/{google,google-vertex,amazon-bedrock}/*`
- `packages/ai/src/auth/ambient/{google-adc,aws}.ts`
- 对应 fixture/tests

**Red / Green**

- 锁定 Google SDK client config、thought signature、function calls、usage 与最终 URL。
- 锁定 Vertex project/location/API-key/ADC 分支和 Bedrock region/profile/bearer/SigV4 分支。
- 实现 typed ambient capability，不把 Google/AWS 伪装成 OAuth。

**验收**

```bash
pnpm --filter @duoduo/ai test -- --run google vertex bedrock ambient
```

建议提交：`feat(ai): add google vertex and bedrock paths`

### S08：OpenAI Chat 协议与兼容 Provider 波次 `risk:high` `depends:[S04]`

> 完成后：OpenAI Chat 深模块承载不同 thinking/tool/cache/session 方言，并接通 17 个单协议 Provider。

**文件**

- `packages/ai/src/protocols/openai-chat-completions/*`
- `packages/ai/src/providers/{ant-ling,cerebras,cloudflare-workers-ai,deepseek,groq,huggingface,moonshotai,moonshotai-cn,nvidia,together,xai,xiaomi,xiaomi-token-plan-ams,xiaomi-token-plan-cn,xiaomi-token-plan-sgp,zai,zai-coding-cn}/*`
- `packages/ai/test/fixtures/openai-chat-completions/*`

**Red / Green**

- 先用 profile 参数化测试覆盖十种 thinking format、tool result 差异、usage、cache、strict mode 和错误。
- 实现一个 protocol adapter 与逐模型 profile，不建立巨型 Provider switch。
- 每个 Provider 行必须有 auth、endpoint、request、stream、error fixture 和 manifest source。

**验收**

```bash
pnpm --filter @duoduo/ai test -- --run openai-chat-completions providers-compatible
pnpm --filter @duoduo/ai manifest:check
```

建议提交：`feat(ai): add openai chat provider wave`

### S09：多协议网关、GitHub 与 MiniMax/Kimi `risk:high` `depends:[S06,S08]`

> 完成后：Cloudflare Gateway、Fireworks、GitHub Copilot、Kimi、MiniMax 双区、OpenCode、OpenRouter 与 Vercel 可按模型绑定正确协议，互不泄漏凭据和 endpoint。

**文件**

- `packages/ai/src/providers/{cloudflare-ai-gateway,fireworks,github-copilot,kimi-coding,minimax,minimax-cn,opencode,opencode-go,openrouter,vercel-ai-gateway}/*`
- `packages/ai/src/auth/oauth/github-copilot/*`
- 对应 fixture/tests

**Red / Green**

- 参数化覆盖每个 Provider × protocol、endpoint resolver 和 auth 分支。
- GitHub token exchange、enterprise/proxy endpoint hint、动态 origin policy 必须先有失败 fixture。
- MiniMax 国际/中国区使用独立 kind、环境变量、目录和 credential slot。
- OpenRouter/Vercel routing 仅由 typed profile 控制，调用方不能传任意 wire JSON。

**验收**

```bash
pnpm --filter @duoduo/ai test -- --run gateways github-copilot minimax kimi openrouter
```

建议提交：`feat(ai): add multi-protocol provider wave`

### S10：Codex、Mistral、Radius 与 PI 基线闭环 `risk:high` `depends:[S05,S06,S07,S08,S09]`

> 完成后：PI 基线 10 个文本 protocol 和 36 个 Provider 全部通过 parity ledger，五个 OAuth flow 与 Radius 动态目录可验收；新增 DashScope/Ark protocol 在 S11–S12 完成。

**文件**

- `packages/ai/src/protocols/{openai-codex-responses,mistral-conversations,pi-messages}/*`
- `packages/ai/src/providers/{openai-codex,mistral,radius}/*`
- `packages/ai/src/auth/oauth/{openai-codex,xai,radius}/*`
- `packages/ai/scripts/parity/extract-pi.ts`
- `packages/ai/src/providers/_generated/pi-parity.generated.json`
- 对应 fixture/tests

**Red / Green**

- 先固定 Codex SSE/WS/cache、Mistral tool ID/reasoning、PI message signature 与 Radius config/OAuth discovery fixture。
- 实现五个 OAuth flow 的并发 refresh、backoff、logout/revoke 和 abort contract。
- 运行 parity extractor 两次，要求 digest 相同；在临时排除 `vendor/pi` 的环境中仍能 build/test，不能删除用户的 vendor 目录。

**验收**

```bash
pnpm --filter @duoduo/ai test -- --run protocols providers baseline-parity oauth radius
pnpm --filter @duoduo/ai parity:check -- --pi-root vendor/pi
pnpm --filter @duoduo/ai manifest:check
```

通过后标记 Baseline Provider 的文本部分；Protocol gate 等 S11–S12 补齐新增协议后通过。建议提交：`feat(ai): complete pi text provider parity`

### S11：Qwen 文本与原生 DashScope `risk:medium` `depends:[S08]`

> 完成后：同一个 Qwen Provider 可按确定模型 profile 使用 OpenAI Chat、Responses、Anthropic 或 DashScope 原生 wire，区域/workspace route 可验证。

**文件**

- `packages/ai/src/protocols/dashscope/*`
- `packages/ai/src/providers/qwen/{provider,catalog,endpoints,profiles,manifest}.ts`
- `packages/ai/test/fixtures/qwen/{text,multimodal,errors}/*`

**Red / Green**

- 覆盖六个区域、shared/workspace、不可用组合、四类 protocol preference。
- 原生 route 只从 curated route ID 映射；远端目录和 per-call option 都不能提供 path。
- 覆盖 text/multimodal/tool/thinking/usage/error/abort。

**验收**

```bash
pnpm --filter @duoduo/ai test -- --run dashscope qwen
```

建议提交：`feat(ai): add qwen text protocols`

### S12：豆包 Responses/Ark 文本 `risk:medium` `depends:[S03,S08]`

> 完成后：豆包可通过 Responses、兼容 Chat 或 Ark 原生协议调用显式 Model ID/Endpoint ID，并保持 route 与模型身份稳定。

**文件**

- `packages/ai/src/protocols/ark-responses/*`
- `packages/ai/src/providers/doubao/{provider,catalog,endpoints,profiles,manifest}.ts`
- `packages/ai/test/fixtures/doubao/text/*`

**Red / Green**

- 覆盖默认北京 endpoint、显式 base URL、Model ID/Endpoint ID、thinking/tool/previous response。
- Ark 特有事件无法由 Responses profile 表达时才进入 `ark-responses`。
- 禁止把 endpoint ID 塞进 URL/header 或把 Ark 内置工具放入任意 passthrough。

**验收**

```bash
pnpm --filter @duoduo/ai test -- --run ark-responses doubao
```

建议提交：`feat(ai): add doubao text protocols`

### S13：OpenRouter direct 图片 tracer `risk:high` `depends:[S09]`

> 完成后：公共 `ai.images` 可以用 OpenRouter 处理有序文本/参考图输入，返回文本+多图片、usage、cost 和确定终态。

**文件**

- `packages/ai/src/images/{models,input,output,cost,stream,runtime,contracts}.ts`
- `packages/ai/src/protocols/openrouter-images/*`
- `packages/ai/src/providers/openrouter/images.ts`
- `packages/ai/test/fixtures/openrouter/images/*`
- `packages/ai/test/consumer/images.ts`

**Red / Green**

- 先覆盖 model handle、能力拒绝、有序交错输入、URL/base64 resource limits、text+image outputs。
- 覆盖 response ID、token/cache cost、partial failure、abort 与 direct model 无 operation。
- consumer 只能从 `@duoduo/ai/images` 和 Provider subpath 导入。

**验收**

```bash
pnpm --filter @duoduo/ai test -- --run images openrouter-images
pnpm --filter @duoduo/ai typecheck
```

建议提交：`feat(ai): add direct image generation`

### S14：Generation 内核与 Qwen 异步图片 `risk:high` `depends:[S11,S13]`

> 完成后：Qwen 图片任务可 create/poll/cancel/detach/serialize/parse/resume，且所有安全和竞态由共享 generation 内核处理。

**文件**

- `packages/ai/src/generation/{operation-machine,operation-codec,progress,artifact,credential-proof}.ts`
- `packages/ai/src/images/{operation-claims,operation-projector}.ts`
- `packages/ai/src/protocols/{dashscope-images,dashscope-image-tasks}/*`
- `packages/ai/src/providers/qwen/images.ts`
- 对应 fixture/tests

**Red / Green**

- 先覆盖 operation domain envelope、TTL/skew、tamper、未知 version/key、scope/auth/config/model/profile mismatch。
- 覆盖 create 成功但未 set operation、重复 set、poll-before-set、detach/abort/cancel/terminal 竞态。
- 实现 domain-neutral machine；图片仅提供 claims codec、event projector 和 typed ref facade。
- 固定 Wan direct/task 两个 public ID、同一 upstream model、不同 route/mode。

**验收**

```bash
pnpm --filter @duoduo/ai test -- --run generation images dashscope-image-tasks
```

通过后标记 Generation gate 的 operation 部分；建议提交：`feat(ai): add resumable generation kernel`

### S15：豆包 Seedream 图片与图片 gate `risk:medium` `depends:[S12,S14]`

> 完成后：豆包显式 Model/Endpoint ID 可 direct 生图，OpenRouter/Qwen/豆包图片 Provider 通过统一图片 contract；xAI 图片在 S16 加入。

**文件**

- `packages/ai/src/protocols/ark-images/*`
- `packages/ai/src/providers/doubao/images.ts`
- `packages/ai/test/fixtures/doubao/images/*`

**Red / Green**

- 覆盖 prompt/reference/count/size/seed、URL/base64、usage/error/abort。
- 官方没有异步契约时禁止创建 operation 或 remote cancel。
- 回归 OpenRouter、Qwen direct/task 的公共图片 contract。

**验收**

```bash
pnpm --filter @duoduo/ai test -- --run images providers extended
```

通过后标记 Extended Provider gate；建议提交：`feat(ai): complete builtin image providers`

### S16：Grok Imagine 图片与视频 tracer `risk:high` `depends:[S14]`

> 完成后：xAI Provider 同时支持 Grok Imagine 图片生成/编辑与异步视频 generate/edit/extend，返回严格领域结果、临时产物、usage/cost，并支持视频任务安全恢复。

**文件**

- `packages/ai/src/videos/{models,input,output,cost,stream,runtime,operation-claims,contracts}.ts`
- `packages/ai/src/protocols/{xai-images,xai-videos}/*`
- `packages/ai/src/providers/xai/{images,videos}.ts`
- `packages/ai/test/fixtures/xai/{images,videos}/*`
- `packages/ai/test/consumer/videos.ts`

**Red**

- 从 pinned xAI 官方 contract 固定图片生成/编辑/参考图，以及视频 generate/edit/extend、request ID、poll 状态、expired/failed、临时 URL 与按秒费用 fixture。
- 覆盖 text/image/reference/video source 输入组合和不支持参数的 preflight 拒绝。
- 覆盖图片 ref 不能传给 video resume、未知 domain envelope fail closed。

**Green**

- 实现 xAI 图片 direct contract，以及严格 `VideoModel/Input/Output/Event/Result` 与 resumable video contract。
- 视频复用 generation machine，但提供自己的 claims codec、event projector 和 branded ref。
- xAI provider 同时暴露 chat/images/videos，认证只装配一次。

**验收**

```bash
pnpm --filter @duoduo/ai test -- --run generation images videos xai-imagine
pnpm --filter @duoduo/ai typecheck
```

通过后标记 Generation gate；建议提交：`feat(ai): add grok imagine media paths`

### S17：Seedance 2.0 视频 `risk:high` `depends:[S16]`

> 完成后：Seedance 2.0 的文本、图片、音频和视频输入通过豆包 Provider 的视频 binding 调用，能力差异全部由 profile 验证。

**文件**

- `packages/ai/src/protocols/ark-video-tasks/*`
- `packages/ai/src/providers/doubao/videos.ts`
- `packages/ai/test/fixtures/doubao/seedance-2/*`

**Red / Green**

- 在写 adapter 前记录官方 schema locator、验证日期和脱敏 create/poll/error fixture。
- 覆盖多模态输入角色、duration/resolution/aspect/FPS/audio、任务状态和产物 URL。
- 未被官方 contract 证明的参数、cancel 或 route 必须拒绝，不能猜测。

**验收**

```bash
pnpm --filter @duoduo/ai test -- --run ark-video-tasks seedance videos
```

建议提交：`feat(ai): add seedance video provider`

### S18：Kling/可灵视频 `risk:high` `depends:[S16]`

> 完成后：Kling 官方直连可文生视频、图生视频并恢复任务，认证、模型版本和 route 均来自 pinned contract。

**文件**

- `packages/ai/src/protocols/kling-video-tasks/*`
- `packages/ai/src/providers/kling/{provider,auth,catalog,endpoints,profiles,manifest}.ts`
- `packages/ai/test/fixtures/kling/videos/*`

**Red / Green**

- 先冻结实现时官方认证方式、create/query route、任务状态、模型 profile 和产物保留期。
- 覆盖文生/图生、first/last/reference roles、失败/过期/本地取消；remote cancel 仅在官方存在时实现。
- Provider factory 不读取环境，不在导入时联网。

**验收**

```bash
pnpm --filter @duoduo/ai test -- --run kling-video-tasks kling videos
```

建议提交：`feat(ai): add kling video provider`

### S19：第三方综合平台扩展 contract `risk:high` `depends:[S16]`

> 完成后：测试扩展可以在一个 Provider 中暴露 chat/images/videos；同一 publisher/family 的直连与综合平台模型仍有不同身份、价格、目录和 operation。

**文件**

- `packages/ai/src/testing/aggregator-provider.ts`
- `packages/ai/src/testing/contracts/{capability-map,channel-isolation}.ts`
- `packages/ai/src/catalog/channel-identity.test.ts`
- `packages/ai/test/consumer/custom-aggregator.ts`

**Red / Green**

- 构造两个同 `publisher/family`、不同 Provider 的模型，先证明错误实现会合并 cache/handle/operation。
- contract 拒绝远端目录注入 endpoint/auth/protocol/operation mode/profile。
- 验证平台统一 task protocol 与透明转发 protocol 两种装配方式。
- 验证 Provider 内可见 fallback profile 与禁止跨 Provider 隐式 fallback。

**验收**

```bash
pnpm --filter @duoduo/ai test -- --run channel-isolation aggregator catalog
pnpm --filter @duoduo/ai typecheck
```

建议提交：`test(ai): prove aggregator channel extensibility`

### S20：Self-hosted Generation Gateway seam `risk:high` `depends:[S16]`

> 完成后：fake owned gateway 可动态发布图片/视频模型，演示排队、准备、运行、收尾、取消、恢复和 compute usage；替换 fake adapter 不改调用方。

**文件**

- `packages/ai/src/protocols/duoduo-generation-v1/*`
- `packages/ai/src/providers/self-hosted-generation/*`
- `packages/ai/src/testing/fake-generation-gateway.ts`
- `packages/ai/test/fixtures/self-hosted-generation/*`
- `packages/ai/test/consumer/self-hosted-generation.ts`

**Red**

- 覆盖动态目录、模型上下线、图片/视频任务、四阶段进度、临时产物、compute usage、detach/resume/cancel。
- 覆盖远端返回 GPU instance/container/IP 时 schema 丢弃并诊断，不进入公共事件或 operation token。
- 用两个 gateway adapter 跑同一公共 consumer contract。

**Green**

- 实现 owned gateway Provider/protocol 和 fake adapter。
- 只暴露生成任务；不得添加 `CloudGpuDriver`、云 SDK、scheduler 或业务 ArtifactStore 到公共 interface。

**验收**

```bash
pnpm --filter @duoduo/ai test -- --run self-hosted-generation generation channels
pnpm --filter @duoduo/ai build
```

通过 S17–S20 后标记 Generation Ecosystem gate；建议提交：`feat(ai): add self hosted generation gateway seam`

### S21：CLI、目录生成器与 live harness `risk:medium` `depends:[S10,S11,S15,S17,S18,S19,S20]`

> 完成后：CLI 可列出 40 个内建 Provider kind 和三类模型、标出缺少必需非秘密配置的 self-hosted 实例、管理密封凭据、刷新目录并运行显式预算保护的 live test。

**文件**

- `packages/ai/src/cli/*`
- `packages/ai/scripts/catalog/*`
- `packages/ai/scripts/manifest/*`
- `packages/ai/test/live/*`
- `packages/ai/test/consumer/{chat,images,videos,custom-aggregator,self-hosted-generation}.ts`
- `packages/ai/README.md`
- 根 `README.md`、根 `AGENTS.md`

**Red / Green**

- CLI 测试覆盖 inventory/available、login/logout、非交互 JSON、secret 脱敏、key unavailable。
- catalog generator 同输入运行两次 digest 一致，远端安全字段变化失败。
- live harness 同时要求总 USD、Provider allowlist、`--allow-paid`；图片/视频另有数量/秒数上限。
- tree-shaking 测试证明单 Provider import 不加载其他 Provider、OAuth、Node store 或云 SDK。

**验收**

```bash
pnpm --filter @duoduo/ai test -- --run cli catalog-generator consumer exports
pnpm --filter @duoduo/ai catalog:update -- --check --offline
pnpm --filter @duoduo/ai manifest:check
```

建议提交：`feat(ai): add cli catalogs and live harness`

### S22：全量验收与发布候选 `risk:high` `depends:[S21]`

> 完成后：八个 gate 都有当前 commit 的证据，移除 vendor 参考仓库后仍可安装、测试和构建，公共 consumer 完成聊天、图片、视频和自建网关四条路径。

**文件**

- `packages/ai/IMPLEMENTATION-STATUS.md`
- `packages/ai/src/providers/_generated/*`
- `packages/ai/test/consumer/*`
- 设计/计划/README 的最终状态链接

**步骤**

1. 运行 40 个 Provider × 全部 binding 的 manifest coverage 报告，要求 100%。
2. 运行 API report，逐项对照设计的公共 symbol inventory。
3. 在临时环境中排除 `vendor/pi`，重新安装 workspace 所需依赖并运行 package build/test。
4. 运行全仓 lint/format/typecheck/test/build。
5. 检查 bundle/import graph、secret canary、fixture 脱敏和 live runner 默认禁用。
6. 只有证据属于当前 commit 时，才把八个 gate 标为 `passed`。

**最终验收**

```bash
pnpm --filter @duoduo/ai format:check
pnpm --filter @duoduo/ai lint
pnpm --filter @duoduo/ai typecheck
pnpm --filter @duoduo/ai test
pnpm --filter @duoduo/ai build
pnpm --filter @duoduo/ai api:check
pnpm --filter @duoduo/ai manifest:check
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

建议提交：`feat(ai): complete duoduo ai runtime`

## 6. Gate 与切片映射

| Gate                 | 完成切片     | 通过条件                                                  |
| -------------------- | ------------ | --------------------------------------------------------- |
| Foundation           | S01–S02      | Faux 全路径、公共 consumer、stream/core/testing 专项通过  |
| Runtime              | S03–S05      | auth/catalog/transport/session 安全与并发专项通过         |
| Protocol             | S03、S05–S12 | 12 个文本 adapter 及 replay/profile contract 通过         |
| Baseline Provider    | S06–S10、S13 | PI 36 Provider、5 OAuth、Radius、OpenRouter Images 通过   |
| Extended Provider    | S11–S15      | Qwen/豆包文本图片与 MiniMax 双区通过                      |
| Generation           | S14、S16     | 共享 operation 内核与 Grok Imagine 图片/视频 tracer 通过  |
| Generation Ecosystem | S17–S20      | Seedance、Kling、综合平台隔离、自建网关通过               |
| Productization       | S21–S22      | CLI/catalog/live/public consumer/全仓与无 vendor 验证通过 |

## 7. 关键风险与最早证明点

| 风险                                       | 最早切片 | 证明方式                                             |
| ------------------------------------------ | -------- | ---------------------------------------------------- |
| 公共流状态机无法统一 SDK/SSE/任务式调用    | S01–S03  | Faux 与 OpenAI Responses 共用终态 contract           |
| 多租户凭据或目录串用                       | S04      | 跨 scope/account/config 的失败 fixture               |
| 重试导致重复付费请求                       | S05      | dispatch phase + idempotency 参数化测试              |
| 36 Provider 造成 compatibility 巨型 switch | S08–S10  | protocol profile registry 与 manifest coverage       |
| 图片/视频复制 operation 安全逻辑           | S14、S16 | 两个领域跑同一 generation contract suite             |
| 综合平台把同源模型错误合并                 | S19      | channel identity 反例测试                            |
| 云 GPU 细节污染 AI interface               | S20      | 两个 gateway adapter + 公共 consumer 零改动测试      |
| 文档完成但 package 仍不可消费              | 每个切片 | public-only consumer compile；S22 无 vendor 全量验证 |

## 8. 明确后置事项

以下不阻塞 `@duoduo/ai` 第一版，也不能偷偷塞进上述切片：

- 根据价格、可用性或优先级自动跨 Provider 选路。
- 真实云 GPU 厂商 adapter、容量租赁、自动扩缩容和调度器。
- 业务任务队列、通知、素材库、产物持久化和版权授权。
- Agent loop、工具执行、业务工作流和模型选择策略。
- 音频生成、3D、embedding 等新 capability。

这些能力以后只能消费本计划交付的稳定 interface；若必须修改 chat/images/videos 的现有调用语义，视为当前设计缺陷而不是“正常扩展”。

## 9. 完成定义

本计划只有同时满足以下条件才算完成：

- S01–S22 均有聚焦 commit 和可复现验收输出。
- 八个 gate 在 `IMPLEMENTATION-STATUS.md` 中为 `passed`，证据 commit 与 HEAD 一致。
- 40 个内建 Provider factory 可以独立导入；提供 self-hosted gateway base URL 等必需非秘密配置后，`providers/all` 可以显式构造完整集合。
- 默认测试全离线、无付费请求、无真实凭据。
- chat/images/videos/custom aggregator/self-hosted gateway consumer 只依赖公共 export map。
- 同一上游模型的不同渠道身份、缓存、价格和 operation 不会合并。
- 根入口不导入 Provider 集合、OAuth、Node-only store、云 GPU SDK 或 CLI。
- 没有 `TODO`、`TBD`、空 fixture、未解释的 `any/unknown` 逃生口或未覆盖 manifest 分支。
- package 和全仓 format/lint/typecheck/test/build 以及 `git diff --check` 全部通过。

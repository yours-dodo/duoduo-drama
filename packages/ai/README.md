# `@duoduo/ai`

`@duoduo/ai` 是多多短剧使用的供应商中立 AI 运行时。它在模块导入期间不引入供应商 SDK，也不读取凭证，并明确划分了聊天、图像、视频、认证、目录、会话、传输、可恢复操作、CLI 和测试边界。

如果要维护或扩展本包，请先阅读[目录结构与模块职责](./docs/directory-structure.md)。如果要判断当前 Runtime 距离生产完成还差什么、一个需求应落入 Runtime、Agent 还是未来 Gateway Host，请阅读 [AI Gateway Runtime 差距基线](./docs/reviews/2026-07-28-ai-gateway-runtime-gap-analysis.md)。如果要评估何时值得拆出独立 Gateway Host、它能解决什么问题以及会引入哪些成本，请阅读 [AI Gateway Host 拆分收益与启用判据](./docs/ai-gateway-host-rationale.md)。

## 快速开始

只导入应用实际需要的 Provider 子路径：

```ts
import { createAi } from '@duoduo/ai';
import { createOpenAiProvider } from '@duoduo/ai/providers/openai';

const ai = createAi();
ai.providers.register(createOpenAiProvider());
```

如果需要启用完整的内置 Provider 清单，请导入专用的全 Provider 入口。该入口是异步的，因为自托管生成 Provider 会在构建期间发现注入的网关目录。

```ts
import { createAi } from '@duoduo/ai';
import { builtinProviders } from '@duoduo/ai/providers/all';

const ai = createAi();
const result = await builtinProviders({
  qwen: { region: 'us' },
});
ai.providers.registerAll(result.providers);
console.log(result.unconfigured);
```

根入口 `@duoduo/ai` 永远不会发现或注册 Provider。`@duoduo/ai/providers/all` 是唯一会静态导入全部内置 Provider 的入口。

## 优雅关闭

`dispose()` 会先让 Runtime 进入 draining：Provider 注册、模型查询、认证以及新的聊天、图片和视频调用会在进入 Provider 前被拒绝；已经启动的调用会继续执行，全部进入本地终态后才释放 session、凭证指纹密钥和 transport。

```ts
await ai.dispose();
```

宿主需要关闭时限时，可以设置 drain 超时。默认在超时后中止活跃调用，并对支持取消的远端媒体任务执行尽力取消：

```ts
await ai.dispose({ timeoutMs: 30_000 });
```

如果超时后不能释放资源，使用 `onTimeout: 'error'`。此时 `dispose()` 返回 `RUNTIME_DISPOSE_TIMEOUT`，Runtime 保持 draining，调用方可以等待在途任务结束后再次调用 `dispose()`：

```ts
await ai.dispose({ timeoutMs: 30_000, onTimeout: 'error' });
```

## 内置 Provider 清单

生成的目录和包导出映射必须包含相同的 38 种 Provider。空白配置表示该 Provider 具备安全的包级默认值；凭证仍须通过显式凭证存储、环境能力、OAuth 流程或请求级覆盖提供。

| Provider 类型            | `builtinProviders()` 注册前要求的非敏感配置                      |
| ------------------------ | ---------------------------------------------------------------- |
| `amazon-bedrock`         | 无                                                               |
| `ant-ling`               | 无                                                               |
| `anthropic`              | 无                                                               |
| `azure-openai-responses` | `baseUrl` 或 `resourceName`；`deploymentName` 或 `deploymentMap` |
| `cerebras`               | 无                                                               |
| `cloudflare-ai-gateway`  | `accountId`、`gatewayId`                                         |
| `cloudflare-workers-ai`  | `accountId`                                                      |
| `deepseek`               | 无                                                               |
| `doubao`                 | 无                                                               |
| `fireworks`              | 无                                                               |
| `google`                 | 无                                                               |
| `google-vertex`          | 无                                                               |
| `groq`                   | 无                                                               |
| `huggingface`            | 无                                                               |
| `kimi-coding`            | 无                                                               |
| `kling`                  | 无                                                               |
| `minimax`                | 无                                                               |
| `minimax-cn`             | 无                                                               |
| `mistral`                | 无                                                               |
| `moonshotai`             | 无                                                               |
| `moonshotai-cn`          | 无                                                               |
| `nvidia`                 | 无                                                               |
| `openai`                 | 无                                                               |
| `openai-codex`           | 无                                                               |
| `opencode`               | 无                                                               |
| `opencode-go`            | 无                                                               |
| `openrouter`             | 无                                                               |
| `qwen`                   | `region`                                                         |
| `self-hosted-generation` | `gateway`、`gatewayBaseUrl`                                      |
| `together`               | 无                                                               |
| `vercel-ai-gateway`      | 无                                                               |
| `xai`                    | 无                                                               |
| `xiaomi`                 | 无                                                               |
| `xiaomi-token-plan-ams`  | 无                                                               |
| `xiaomi-token-plan-cn`   | 无                                                               |
| `xiaomi-token-plan-sgp`  | 无                                                               |
| `zai`                    | 无                                                               |
| `zai-coding-cn`          | 无                                                               |

`self-hosted-generation` 始终要求注入 `DuoduoGenerationGateway`。`gatewayBaseUrl` 只提供公开的任务绑定标识，CLI 不能据此虚构网关适配器。缺失的非敏感选项会出现在 `result.unconfigured` 中；运行时绝不会猜测区域、账号、部署或网关实现。

## 认证与本地 CLI

构建完成后，可以通过 `duoduo-ai` 命令或公开的 `@duoduo/ai/cli` API 使用 Node CLI。

```bash
pnpm --filter @duoduo/ai build
pnpm --filter @duoduo/ai exec duoduo-ai providers
pnpm --filter @duoduo/ai exec duoduo-ai models openai --configured
pnpm --filter @duoduo/ai exec duoduo-ai auth status openai --json
```

支持的命令包括 `providers`、`models`、`models --configured`、`auth status`、`auth login`、`auth logout` 和 `diagnose`。`models` 返回静态已知模型；`models --configured` 返回当前凭证作用域能够完成认证绑定的模型，但不会访问远端或宣称模型实际可用。Runtime 目前不支持远程模型目录刷新。使用 `--json` 输出机器可读结果时，还会经过第二层脱敏处理。

凭证持久化采用故障关闭策略。将 `DUODUO_AI_MASTER_KEY` 设置为经过 base64url 编码的 32 字节密钥，才能启用加密文件存储。如果没有可用密钥，修改凭证的命令会返回 `CREDENTIAL_CODEC_KEY_UNAVAILABLE`，退出码为 69。默认状态目录是工作区根目录下的 `.duoduo-drama/`，包含 `config.json`、加密的 `credentials/` 和按需创建的公开模型元数据 `catalogs/`；`DUODUO_AI_HOME` 可以显式覆盖该目录。`config.json` 只能包含非敏感的 Provider 选项；疑似敏感字段会被拒绝，而不是持久化。

## 图像、视频与可恢复生成

通过 `@duoduo/ai/images` 和 `@duoduo/ai/videos` 使用对应通道的模型句柄和生成调用。支持恢复的 Provider 会返回由运行时严格拥有的操作引用；这些引用可以分离，通过注入的操作编解码器进行序列化、解析、恢复和取消。操作令牌和凭证证明绝不会投射到公共目录元数据或 CLI 日志中。

自托管图像/视频生成使用：

- `@duoduo/ai/protocols/duoduo-generation-v1`：项目自有的目录/任务协议；
- `@duoduo/ai/providers/self-hosted-generation`：Provider 绑定；
- 由应用注入的 `DuoduoGenerationGateway` 实现：对接真实基础设施。

公共边界不会暴露云 GPU 驱动、调度器、云 SDK 或业务制品存储。

## 聚合器与扩展

第三方聚合器在单个 Provider 实例后组合聊天、图像和视频能力。受信任代码负责端点、认证、协议选择、操作模式、兼容性配置和回退目标。远程目录分片只能添加安全的模型事实；包含端点、认证、协议、路由、操作、配置、URL、令牌或密钥的字段会被拒绝。

添加 Provider 时：

1. 创建 `src/providers/<kind>/index.ts`，提供显式工厂，并且导入时不得读取环境变量。
2. 在 `package.json` 中添加 `./providers/<kind>`。
3. 将工厂添加到 `src/providers/all/index.ts`；声明必需的非敏感选项，不要猜测默认值。
4. 运行 `pnpm --filter @duoduo/ai catalog:update`、测试、API 检查和清单检查。

添加协议时：

1. 将线协议类型、校验、映射和流式归一化保留在 `src/protocols/<protocol>/` 中。
2. 通过声明合并扩展协议选项和兼容性映射。
3. 从 Provider 绑定协议；适配器只接收请求级传输，不得选择最终 URL 或受保护的认证请求头。
4. 为正常、边界、失败、中止、重放和脱敏行为添加离线夹具。

## 目录生成

```bash
pnpm --filter @duoduo/ai catalog:update
pnpm --filter @duoduo/ai catalog:update -- --check --offline
pnpm --filter @duoduo/ai manifest:check
```

语义目录摘要不包含时间戳，并且不受输入顺序影响。经过审查的远程分片只能包含模型的 `id`、`name`、`capabilities`、`limits`、`pricing`、`region` 和 `deprecated` 字段。清单检查器会约束 38 个 Provider 导出、生成目录、公共入口、构建目标、CLI 二进制文件和实现状态。

## 在线测试安全机制

常规测试、构建、安装和目录生成绝不会导入在线测试运行器。唯一入口必须显式调用：

```bash
DUODUO_AI_LIVE=1 \
DUODUO_AI_LIVE_PROVIDERS=openai \
DUODUO_AI_LIVE_MAX_USD=0.25 \
pnpm --filter @duoduo/ai test:live -- \
  --provider openai \
  --model "$OPENAI_MODEL" \
  --estimated-max-usd 0.05 \
  --allow-paid
```

运行器要求四项相互独立的显式许可全部满足：`DUODUO_AI_LIVE=1`、Provider 位于允许列表、美元预算为正数，以及传入 `--allow-paid`。它绝不会猜测 Provider 或模型。图像运行还要求 `DUODUO_AI_LIVE_MAX_IMAGES` 和 `--images`；视频运行要求 `DUODUO_AI_LIVE_MAX_VIDEO_SECONDS` 和 `--video-seconds`。成本未知或超过预算时，会跳过执行并返回专用的非成功代码。

本仓库有意不提供默认网络执行器。即使通过全部安全门槛，在应用注入经过审计的 Provider 专用执行器之前，仍会返回 `LIVE_EXECUTOR_NOT_CONFIGURED`。该执行器必须限制来源、截止时间和并发，使用合成输入，并对输出进行脱敏。OAuth 在线流程不属于自动测试套件，必须使用专用测试账号和交互式命令。

## 验证

```bash
pnpm --filter @duoduo/ai format:check
pnpm --filter @duoduo/ai lint
pnpm --filter @duoduo/ai typecheck
pnpm --filter @duoduo/ai test
pnpm --filter @duoduo/ai build
pnpm --filter @duoduo/ai api:check
pnpm --filter @duoduo/ai manifest:check
pnpm --filter @duoduo/ai release:check
pnpm --filter @duoduo/ai release:no-vendor
```

`api:check` 会编译公共消费者，并核对当前协议子路径和运行时符号清单。`manifest:check` 会动态构建全部 38 个内置 Provider，并要求所有声明的绑定字段、运行时绑定、包导出以及 S01–S22 状态证据均被覆盖。

`release:check` 会约束生产导入图、运行密钥脱敏金丝雀测试、扫描夹具中的疑似密钥值和未脱敏签名 URL，并证明在线测试运行器默认关闭。`release:no-vendor` 会复制一份不含 `vendor` 的干净临时检出，从 pnpm 存储中使用 `--offline --frozen-lockfile` 重新安装，并运行包的类型检查、测试和构建。所有默认验证都离线且确定性执行，不会发送任何付费在线请求。

当前发布范围和逐切片证据记录在[实施状态](./IMPLEMENTATION-STATUS.md)中。

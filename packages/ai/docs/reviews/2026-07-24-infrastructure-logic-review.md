# `packages/ai` 基建完成度与逻辑审查

- 审查日期：2026-07-24
- 审查范围：`packages/ai` 当前工作树、公共 API、Provider/协议、认证与会话隔离、媒体生成、Runtime 生命周期、CLI 和发布门禁
- 审查方式：完整源码审阅、离线门禁验证、针对关键竞态和授权边界的独立运行时复现
- 后续修复：已完成；本文保留原始问题证据，并记录 2026-07-24 的修复与重新验证结果

## 结论

`packages/ai` 的五个已确认逻辑问题均已修复，当前可以作为内部 RC 进入 Agent 集成验证。它仍不是完整产品：真实宿主接入和付费 Provider 在线验收尚未完成。

| 维度                     | 完成度 | 判断                                           |
| ------------------------ | -----: | ---------------------------------------------- |
| Provider、协议、生成能力 |    90% | 39 个 Provider、62 个 binding、20 个协议子路径 |
| 公共 API 与发布工程      |    85% | API、manifest、离线发布检查完整                |
| 逻辑正确性与隔离         |    90% | 3 个 HIGH、2 个 MEDIUM 均已修复并覆盖回归测试  |
| Agent 应用接入           |    10% | `agent/src` 尚未实际使用 `@duoduo/ai`          |
| 综合生产完成度           | 约 80% | Runtime RC 可用；仍需 Agent 接入与在线验收     |

本轮修复没有执行真实 Provider 请求，也没有引入外部网络依赖。

## 修复结果

| 原问题                              | 状态   | 修复                                                                    |
| ----------------------------------- | ------ | ----------------------------------------------------------------------- |
| Ambient session 跨租户复用          | 已修复 | session scope fingerprint 绑定授权作用域；无 authority 时绑定本地作用域 |
| 媒体-only Provider 绕过凭证覆盖策略 | 已修复 | Image/Video auth 使用当前协议 binding                                   |
| DashScope 远端取消未发送            | 已修复 | 远端取消使用独立的 10 秒 best-effort signal                             |
| SessionManager 创建/中止竞态泄漏    | 已修复 | 零引用失败路径调用 `disposeEntry()`                                     |
| 显式协议参数被默认值覆盖            | 已修复 | 请求级 legacy 协议选项先归一化，显式 common option 优先                 |

## Findings

### [已修复][HIGH] Security：Ambient session 跨租户复用

**位置**：`packages/ai/src/runtime/create-ai.ts:1409-1421`

**问题**：ambient auth 路径虽然调用了 scope authority，但丢弃了 scope fingerprint，只返回 `ambient:${credentialInstanceId}`。

**复现结果**：两个不同 tenant scope 使用相同 ambient role 和相同 `sessionId` 时，第二个 tenant 读取到了第一个 tenant 的 session affinity：

```json
{ "seen": [null, "tenant-a"], "crossTenantLeak": true }
```

**影响**：可能跨租户共享会话连接、响应亲和性和其他 Provider session 状态，违反“会话身份必须独立包含已授权作用域标识”的项目边界。

**建议**：session key 同时绑定授权 scope fingerprint 和 ambient credential identity；没有 scope authority 时也应加入 runtime-local scope fingerprint。

### [已修复][HIGH] Security：媒体-only Provider 绕过凭证覆盖策略

**位置**：`packages/ai/src/runtime/create-ai.ts:1345`

**问题**：`resolveModelAuth()` 根据 `provider.chat.transport.credential` 判断是否需要认证。Kling、自托管生成等只有图片/视频绑定、没有 chat 的 Provider 会提前返回 `{}`，跳过 `credentialOverridePolicy.allow()`。

**复现结果**：设置 `credentialOverridePolicy.allow()` 永远返回 `false`，Kling video model 仍成功接受凭证并创建 handle：

```json
{ "accepted": true }
```

**影响**：

- 宿主的租户权限、Provider 使用范围或凭证准入策略可被绕过。
- media-only Provider 的 stored/ambient credential 无法沿正确绑定解析。
- 认证行为错误地依赖 Provider 是否同时拥有 chat capability。

**建议**：认证解析接收当前 image/video protocol binding 的 credential 描述，不要借用 chat transport。

### [已修复][HIGH] Bug：关闭超时没有真正发送 DashScope 远端取消

**位置**：

- `packages/ai/src/images/runtime.ts:323-365`
- `packages/ai/src/videos/runtime.ts:324-366`
- `packages/ai/src/protocols/dashscope-image-tasks/adapter.ts:148-156`

**问题**：abort 处理发生后，取消 adapter 收到的仍是已经 aborted 的 generation signal。network policy 会在请求发送前拒绝该 signal。

**复现结果**：本地结果为 `cancelled`，请求记录只有 create 和 poll，没有 `/cancel`：

```json
{
  "status": "cancelled",
  "paths": [
    "/api/v1/services/aigc/image-generation/generation",
    "/api/v1/tasks/task-1"
  ],
  "cancelAttempted": false
}
```

**影响**：Runtime 看起来已经取消，但远端付费任务仍可能运行并产生费用。

**建议**：远端收口操作使用独立、短时限的 cancellation signal，不能复用触发本地 abort 的 signal。

### [已修复][MEDIUM] Bug：资源创建期间中止会泄漏已创建资源

**位置**：`packages/ai/src/session/manager.ts:187-220`

**问题**：resource 创建完成后，如果 signal 已中止，catch 路径会减少引用并从 map 删除 entry，但不会调用 `resource.dispose()`。

**复现结果**：中止 acquisition、随后完成 resource 创建并调用 manager dispose，资源仍未释放：

```json
{ "disposed": 0, "leaked": true }
```

**建议**：失败路径在 `entry.creating` 已成功完成且 refs 归零时调用 `disposeEntry()`，并增加 creation/abort 竞态测试。

### [已修复][MEDIUM] Bug：显式协议参数被公共默认值静默覆盖

**位置**：

- `packages/ai/src/runtime/create-ai.ts:1085-1109`
- `packages/ai/src/protocols/dashscope/adapter.ts:343-352`
- `packages/ai/src/protocols/google-generative-ai/google-shared.ts:251-262`
- `packages/ai/src/protocols/bedrock-converse-stream/adapter.ts:263-313`

**问题**：Runtime 总是填入 `toolChoice: 'auto'`、`reasoning: 'none'`。部分 adapter 又优先读取公共字段，因此用户显式设置的 `protocolOptions.toolChoice`、`thinkingEnabled` 等没有机会生效。

**复现结果**：Qwen DashScope 请求指定 `protocolOptions.toolChoice: 'none'`，wire body 没有 `tool_choice`：

```json
{ "requested": "none", "wire": null }
```

**影响**：调用方可能明确禁止工具调用或启用 reasoning，但实际请求使用 Provider 默认行为。

**建议**：保留“未显式设置”的状态，或正式移除旧协议字段；不能继续公开接受参数后静默忽略。

## 完成度上的额外缺口

1. 包版本仍为 `0.0.0` 且 `"private": true`，适合作为 monorepo 内部包，不属于外部发布状态。
2. `agent/src` 尚未消费 `@duoduo/ai`，缺少真实宿主关闭、认证、模型选择和工作流集成验证。
3. 未运行需要真实 Provider/可能产生费用的 `test:live`；当前结论基于完全离线的协议夹具和逻辑复现。

## 验证证据

以下检查于 2026-07-24 在当前工作树运行：

| 检查                                         | 结果                                             |
| -------------------------------------------- | ------------------------------------------------ |
| `pnpm --filter @duoduo/ai test`              | 70 个文件、412 项测试通过                        |
| `pnpm --filter @duoduo/ai typecheck`         | 通过                                             |
| `pnpm --filter @duoduo/ai build`             | 通过                                             |
| `pnpm --filter @duoduo/ai api:check`         | 20 个协议子路径、51 个 runtime symbol 通过       |
| `pnpm --filter @duoduo/ai manifest:check`    | 39/39 Provider、62/62 binding、77 个公共导出通过 |
| `pnpm --filter @duoduo/ai lint`              | 通过                                             |
| `pnpm --filter @duoduo/ai format:check`      | 通过                                             |
| `git diff --check -- packages/ai`            | 通过                                             |
| `pnpm --filter @duoduo/ai release:check`     | 通过                                             |
| `pnpm --filter @duoduo/ai release:no-vendor` | 离线重装后 typecheck、test、build 通过           |

新增回归测试覆盖了授权隔离、媒体凭证策略、远端取消、资源创建竞态和协议选项优先级。

## 建议修复顺序

1. 已完成：修复 ambient session 的 scope 隔离，并增加双租户回归测试。
2. 已完成：重构媒体认证解析，使 media-only Provider 经过相同 credential policy、stored auth 和 ambient auth 边界。
3. 已完成：为远端 cancel 创建独立信号，并增加 Runtime 级取消测试。
4. 已完成：修复 SessionManager 创建/中止竞态的资源释放。
5. 已完成：明确 common options 与 protocol options 的优先级和兼容策略。
6. 已完成：更新 `IMPLEMENTATION-STATUS.md` 与本审查报告。
7. 待产品集成：在 `agent/` 增加最小真实消费路径，覆盖 Runtime 组装、宿主关闭和一个聊天/媒体工作流。

## 汇总

| Severity | Count |
| -------- | ----: |
| CRITICAL |     0 |
| HIGH     |     0 |
| MEDIUM   |     0 |
| LOW      |     0 |

当前建议：**把 `packages/ai` 作为内部 Runtime RC 进入 Agent 集成验收；在真实宿主接入和受控在线测试完成前，不标记为完整产品生产完成。**

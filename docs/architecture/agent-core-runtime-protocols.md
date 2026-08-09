# Agent Core Runtime 协议

## 1. 边界

Agent Core 采用分层轻内核：执行器只处理模型流、工具循环和 transcript；
Harness 负责 Task/Run/Turn 生命周期、检查点、事件、重放和基础设施端口；
PostgreSQL、搜索、沙箱等具体产品位于 Harness 的 infrastructure adapter。

本层不拥有模型 Provider 协议、业务权限、项目主数据或 Artifact 主数据：

- Provider 和传输由 `packages/ai` 提供；
- Tenant/Project 权限在业务服务进入 Agent 前完成；
- Harness 只携带并严格匹配 `tenantId + projectId` 作用域；
- Session 当前是来源引用，Task/Run/Turn 是 Agent Runtime 聚合。

## 2. 标识与隔离

运行时使用独立的 Task、Run、Turn、ToolExecution、Approval、ReconciliationCase、Attempt、
Event 和 Commit ID。持久记录始终包含 Tenant、Project、Task 和 Run 的复合作用域，不能只凭
全局 ID 读取。

- Task：一次可追踪的 Agent 工作；
- Run：Task 的一次执行尝试；
- Turn：一次模型响应及其后续工具执行；
- ToolExecution：一个模型 Tool Call 的稳定执行身份；
- Approval：Agent 逻辑要求人工确认时，对一个 ToolExecution 创建的稳定审批身份；
- ReconciliationCase：不确定的 reversible 或 external Attempt 的独立、可审计处置身份；
- Attempt：ToolExecution 的一次真实调用；A3 不自动创建重试 Attempt；
- Event：Run 内严格递增的公开观察记录；
- Commit：一次原子状态变更的幂等键。

Session 不与 Task 混合持久化。它只作为 Task 的来源引用，为后续 Session
消息与上下文装配层保留清晰边界。

## 3. 原子提交、审批决策与幂等

`AgentRuntimeStore.commitTask()` 是运行生命周期批量写入的原子通道。一次事务可以同时：

1. 校验预期 Task 版本；
2. 更新 Task、Run、Turn 投影；
3. 追加一个检查点；
4. 追加连续的 Run 事件；
5. 为每个事件创建 Outbox 行；
6. 保存 Commit 回执；
7. 更新 ToolExecution、Attempt 与追加式 transition；
8. 更新 Approval 投影与追加式 transition；
9. 创建或消费 ReconciliationCase，并追加其生命周期 transition；
10. 仅将 Task 版本增加一次。

同一作用域内重复提交相同 `commitId` 和相同命令哈希时，Store 返回第一次
的回执，不重复写入。相同 `commitId` 携带不同内容时返回
`AGENT_COMMIT_MISMATCH`。两个不同 Commit 从同一预期版本竞争时仅一个成功，
另一个返回 `AGENT_STATE_CONFLICT`。

Harness 在提交结果不确定时只用原 `commitId` 协调一次。若第一次其实已经
提交，第二次读取首次回执；若仍不可用，则返回 `AGENT_DURABILITY_FAILED`。

`decideApproval()` 使用独立事务锁定同一作用域内的 Task 与 Approval。首次决定
写入不可变终态、审计 transition、Task 版本和决定回执，但不追加 Run 事件；
Run 事件由仍在执行的 Harness 在消费决定时写入。同一 `decisionId` 与相同内容
返回原回执，不同内容返回 `AGENT_APPROVAL_DECISION_MISMATCH`。决定结果不确定时，
Harness 只用完全相同的 `decisionId + commitId + now` 协调一次。

## 4. 检查点

检查点是追加历史，不是可变快照。Agent Core 在以下边界写入：

- `input_accepted`：输入已被 Task 接受，下一位置为模型；
- `model_completed`：助手消息已写入 transcript；
- `approval_waiting`：Run 已耐久等待决定，下一位置为审批；
- `approval_resolved`：已批准决定被耐久消费，下一位置为工具；
- `tool_result_appended`：每个工具结果已写入 transcript；
- `reconciliation_waiting`：外部副作用结果不确定，等待业务对账；
- `recovery_blocked`：恢复状态不兼容或自相矛盾，停止自动认领；
- `run_terminal`：最终结果已经形成。

每个检查点包含 transcript、当前/下一 Turn、下一执行位置、Harness 协议版本、
检查点 Schema 版本和配置指纹。配置指纹覆盖模型解析身份、system prompt 和
工具定义，但不持久化凭据或原始配置秘密。

检查点与 ToolExecutionLedger 共同记录“最后成功计算边界”和“外部调用事实”。
checkpoint v3 使用显式 model、tool、approval、finalize 或 reconciliation
恢复游标。恢复时，已完成 Turn 的 transcript 直接复用，事件从最后持久 sequence
继续；只有中断中的模型 Turn 可以在同一 Turn 下创建新的 model Attempt。工具和
审批分别从 Ledger 与 Approval 投影恢复。`running` 工具必须先按副作用策略关闭
孤儿 Attempt；`unknown` 外部效果不得仅凭 checkpoint 重放。

## 5. 工具执行账本

每个 `AgentTool` 必须显式声明 `sideEffect`、`idempotency` 与 1 到
86,400,000ms 的 `timeoutMs`。Harness 不从名称、描述或参数推断风险。

ToolExecution 状态为：

```text
proposed -> awaiting_approval -> prepared -> running
    |                              `-------> succeeded|failed|cancelled|timed_out|unknown
    `-> failed + not_applied
```

未知工具、非法 JSON 和 Schema 失败从 `proposed` 直接进入
`failed + not_applied`，Attempt 数为 0。真实调用前必须先原子提交 `running`、
Attempt、start event 和 Outbox。终态、Attempt、transition、end event、Outbox
与 `tool_result_appended` checkpoint 在一个 commit 内完成。

未配置审批策略等同于 `allow`。策略立即拒绝时从 `proposed` 进入
`failed + not_applied`，不创建 Approval 或 Attempt。要求审批时进入
`awaiting_approval`，只有被批准并消费后才进入 `prepared`。

普通外部副作用异常只能记为 `unknown + unknown`；纯工具普通异常记为
`failed + not_applied`。`AgentToolExecutionError` 可显式证明 effect outcome，
但公开结果只保留受控错误码与通用消息。A3 不自动重试任何 ToolExecution。

`readToolExecutions()` 使用绑定 Tenant/Project/Task/Run 的 opaque cursor。
工具事件包含 ToolExecution/Attempt 关联信息，但不包含原始参数、参数增量或
幂等键。

## 6. 持久审批

审批策略由 Agent 逻辑显式提供，Harness 不根据工具名称、参数或副作用声明推断。
策略在参数解析与 Schema 校验之后、ToolExecution 准备之前返回 `allow`、`deny`
或 `require_approval`。策略 ID 和版本进入配置指纹；原始参数只可在策略求值期间
存在于内存，不能进入 Approval、事件或展示字段。

要求审批的一次原子提交会同时写入：

- `pending` Approval 与第一条 transition；
- `awaiting_approval` ToolExecution，Attempt 数为 0；
- `waiting_for_approval` Task 与 Run；
- `approval_waiting` checkpoint；
- `approval_requested` 事件、Outbox 行与 Commit 回执。

决定接口始终携带完整 Tenant、Project、Task、Run、Approval 作用域。首个有效决定
获胜；相同决定 ID 和内容幂等返回；竞争决定失败；`now >= expiresAt` 时由 Store
原子写入 `expired`。外部 Harness 可以写决定，但不能写执行 Harness 所有的 Run
事件。

活跃执行 Harness 默认每秒通过 Store 轮询。批准决定的消费提交原子恢复 Task/Run、
写入 `approval_resolved` checkpoint、把 ToolExecution 变为 `prepared`、记录稳定
consume ID，并追加 `approval_decided` 事件与 Outbox。只有该提交成功后，A3 才能
创建 running Attempt 并调用工具。拒绝或过期会消费 Approval、写入通用 ToolResult，
保持 Attempt 数为 0，并让模型继续下一 Turn。取消会关闭等待且不调用工具。

Approval 的展示内容上限为 32 KiB，只允许 Agent 逻辑生成的安全投影。公开快照和
事件不包含原始参数、凭据、幂等键或原始异常。存活 Harness 和恢复 Worker 均可在
当前 fence 下继续审批流程。

## 7. 外部副作用对账

当 reversible 或 external Attempt 在失去所有权时结果不确定，Harness 保留原始
ToolExecution 和 Attempt 的 `unknown + unknown` 账本，并在同一个 fenced Commit
中写入 `waiting` ReconciliationCase、`reconciliation_waiting` checkpoint、受控事件
和 Outbox。Case 的 Observation 只能由业务服务显式触发的只读适配器追加，且只保存
标准分类、受控 reason code 与最多 32 KiB 的安全展示投影。

已授权的业务服务以稳定 `resolutionId` 写入首次有效的 Resolution。相同内容重放
幂等，竞争或不匹配内容被拒绝；Observation 本身不会改变 Case。`waiting` Case 继续
排除在 Worker 认领之外，只有 `resolved` Case 所在 Run 能由兼容 Worker 在当前 fence
下认领。消费与恢复 Task/Run、受控 ToolResult、事件、Outbox 和 checkpoint 属于同一
Commit，且不会重写原有 unknown 账本。取消会保留 Case 和 Observation 审计，但永久
阻止消费。

## 8. Run 租约、fencing 与恢复

租约能力由 Store 显式声明。新建耐久 Task 时，初始 Run、checkpoint、fencing=1
的所有权和 `initial_claim` 审计在同一事务创建。所有执行者写入都必须携带
`leaseToken + fencingToken`；令牌、owner、fence 或数据库过期时间任一不匹配，
整个事务返回 `AGENT_RUN_LEASE_LOST`，不得留下 projection、Ledger、checkpoint、
event、Outbox、audit 或 Commit receipt 的部分写入。

PostgreSQL 0007/0008 以数据库时间判定过期与可领取时间。`claimRecoverableRuns()`
使用有界批次和 `FOR UPDATE SKIP LOCKED`，严格匹配配置指纹，排除终态、
`recovery_blocked` 与仍为 `waiting` 的 reconciliation Run；仅存在 `resolved` Case
的 reconciliation Run 可以被认领。认领在同一事务递增 fence、安装新令牌和追加
`recovery_claim`。claim、renew、release 的操作 ID 与命令哈希持久化，相同内容可
安全重放，不同内容返回 `AGENT_COMMIT_MISMATCH`。

Worker 在 repeatable-read 事务读取 Task、最新 checkpoint、有序 ToolExecution /
Attempt / Approval / ReconciliationCase 投影、模型 Attempt 和最后事件 sequence。
无副作用的孤儿 Attempt 先原子关闭为 `unknown + not_applied`，再回到 `prepared`；
reversible 或 external 孤儿 Attempt 变为 `unknown + unknown` 并进入对账等待，禁止
自动重试。已裁决 Case 只能消费一次，随后模型依靠通用 ToolResult 继续。恢复审计
只保存受控标识、动作、reason code 和 fence，不保存原始参数、结果或租约令牌。

## 9. 事件、微批与重放

Run 事件按 sequence 追加。普通生命周期事件和检查点边界立即刷新；
`text_delta`、`reasoning_delta`、`tool_call_delta` 默认最多 32 条一批，并在
首条等待 25ms 前刷新。Provider 消费在批次容量处受到背压。

模型生命周期事件可携带 Harness 生成的 `modelAttemptId` 和单 Turn 单调递增的
`modelAttempt`。进程退出前已经持久化的部分事件保持不可变；恢复同一 Turn 时
追加 Attempt N+1，不覆盖 Attempt N，也不重复 `run_start` 或 `turn_start`。

事件只有在 Store 返回 Commit 回执后才进入实时观察者。客户端断线后通过
`readEvents()` 和 opaque cursor 继续读取：cursor 只对原 Tenant、Project、
Task、Run 有效，`after` 为排他位置。

持久 Store 的实时观察者溢出只返回 `AGENT_OBSERVER_OVERFLOW` 并断开直播，
不会取消 Task；客户端随后用 cursor 补读。默认进程内 Store 没有跨进程可靠
来源，因此保留 A1 的“溢出即取消 Task”兼容语义。

## 10. Outbox 租约

Outbox 与事件在同一事务创建，供未来 Worker 做至少一次投递：

- `claimOutbox` 使用有界批次和租约所有者领取可用记录；
- PostgreSQL 使用 `FOR UPDATE SKIP LOCKED` 支持竞争 Worker；
- `acknowledgeOutbox` 由租约所有者幂等标记 delivered；
- `releaseOutbox` 清除租约并设置下一次可用时间；
- delivering 记录在租约过期后可被其他 Worker 重领；
- 每次重领增加 attempt，下游以 Event ID 去重。

Agent Core 不内置 Kafka、Redis、Dispatcher 或产品 Worker。

## 11. 失败语义

- `AGENT_STATE_CONFLICT`：聚合版本已变化；
- `AGENT_COMMIT_MISMATCH`：Commit ID 被不同内容复用；
- `AGENT_CURSOR_INVALID`：cursor 无法解析或与 Run 不匹配；
- `AGENT_RUN_NOT_FOUND`：作用域内不存在可见 Run；
- `AGENT_OBSERVER_OVERFLOW`：持久直播观察者已断开，可补读；
- `AGENT_DURABILITY_FAILED`：持久读写及协调均不可用；
- `AGENT_APPROVAL_NOT_FOUND`：当前完整作用域内不存在审批；
- `AGENT_APPROVAL_ALREADY_DECIDED`：不同决定已先完成；
- `AGENT_APPROVAL_DECISION_MISMATCH`：决定 ID 被不同内容复用；
- `AGENT_APPROVAL_EXPIRED`：决定时审批已到期；
- `AGENT_APPROVAL_POLICY_FAILED`：审批策略失败或返回非法结果；
- `AGENT_APPROVAL_PRESENTATION_INVALID`：展示投影结构或大小非法；
- `AGENT_RUN_LEASE_LOST`：当前执行者不再拥有未过期的 Run fence；
- `AGENT_RECOVERY_STATE_INVALID`：恢复所需持久投影不完整；
- `AGENT_MIGRATION_FAILED`：迁移连接、锁、校验和或 SQL 失败。

初始持久化失败时 `startTask()` 拒绝，表示 Task 从未被接受。执行中持久化失败
时，Harness 中止本地执行，`result()` 拒绝，并停留在最后成功检查点；它不会
伪造一个未提交的失败终态。公开错误只包含稳定 code 和脱敏 message，原始
基础设施异常仅作为内部 cause。

## 11. 迁移运维

SQL 迁移按文件名版本顺序执行；当前 0001–0007 覆盖 Task/Run、事件与 Outbox、
追加检查点、流式批次、ToolExecutionLedger、持久审批、Run 租约、恢复审计和
checkpoint v3 resume state。Runner 使用 PostgreSQL
advisory lock、事务和 SHA-256 校验和。已应用文件不可修改或删除，只能增加下一
编号的前向迁移。

```bash
pnpm --filter @duoduo/agent db:migrate
pnpm --filter @duoduo/agent db:migrate:status
pnpm --filter @duoduo/agent test:postgres
```

上线时先备份，再执行 `db:migrate:status`。出现 `checksum_mismatch` 或
`missing_file` 必须停止；只在全为 `applied` 后部署依赖新 Schema 的进程。迁移无
自动 down 版本，应用回退必须确认旧进程与已应用 Schema 兼容，否则使用经过审核的
数据库恢复流程。

只有 CLI/配置组合读取 `AGENT_RUNTIME_DATABASE_URL`；Core 和 Store factory
必须接收显式的 connection string 或 Pool。

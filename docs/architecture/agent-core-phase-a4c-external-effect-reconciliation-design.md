# Agent Core Phase A4c 外部副作用对账与人工处置设计

## 目标

完成 Agent Core 阶段 A4c：当 A4b 因可逆或外部工具的孤儿 Attempt
进入 `waiting_for_reconciliation` 时，业务服务可以在授权后查证外部效果，
记录人工处置，并安全恢复同一 Run。

该阶段把“不确定”变成可审计、可处置的状态；它不把外部调用伪装成
exactly-once，也不允许运行时猜测或自动重复副作用。

## 范围

### 包含

- 以 Tenant / Project / Task / Run / ToolExecution / Attempt 为完整作用域的
  `ReconciliationCase`；
- 受 Agent 逻辑显式注册、由业务服务明确触发的只读查证适配器；
- 脱敏查证记录、首写获胜的人工处置与 exactly-once 消费；
- 对账决定后的 lease-fenced Run 恢复、受控 ToolResult、事件、Outbox 与
  checkpoint；
- 内存与 PostgreSQL 的相同行为、PostgreSQL migration `0008`、跨实例与
  进程恢复测试。

### 不包含

- 自动补偿、自动重试、自动发布或任何自动外部写入；
- 业务 HTTP 路由、审批 UI、身份认证或项目权限实现；
- 从原始工具参数、凭据或任意外部响应中提取新的对账依据；
- Provider 重试、预算、队列、上下文、记忆或沙箱功能。

业务服务负责认证、项目权限、操作者身份与何时发起查证。Harness 只验证
运行时作用域、状态机、幂等性和审计一致性。

## 核心模型

一个进入 reconciliation wait 的 ToolExecution 恰有一个 Case。原始
ToolExecution 与 Attempt 保持终态 `unknown + unknown`，永不被 A4c 改写。
Case 补充“后来如何确认和处置”的事实，而不是重写历史。

```text
unknown ToolExecution / Attempt
             │
             ▼
  ReconciliationCase (waiting)
     ├── ReconciliationObservation[]
     └── ReconciliationResolution
             │
             ▼
    consumed once by fenced owner
             │
             ▼
  sanitized ToolResult → model continuation
```

### Case 状态

- `waiting`：A4b 已创建；尚无可消费的人工决定。
- `resolved`：查证和人工决定已耐久写入，等待兼容 Worker 领取并消费。
- `consumed`：当前 fence 下已经把决定转换为受控 ToolResult 并恢复 Run。
- `cancelled`：Run 在等待期间被取消；Case 与查证记录保留审计价值，但不能再
  恢复该 Run。

### Observation

一次显式查证创建一条 append-only Observation。它只包含：递增序号、
适配器标识和版本、`applied` / `not_applied` / `inconclusive` / `failed`
分类、受控原因码、时间，以及最大 32 KiB 的安全展示投影。

Observation 不会自动改变 Case 状态；即使适配器报告 `applied`，仍需由经过
授权的操作者提交决定。

### Resolution

操作者以稳定 `resolutionId` 提交以下一种不可变决定：

- `confirmed_applied`
- `confirmed_not_applied`
- `confirmed_compensated`
- `abandoned`

首个有效决定获胜。相同 `resolutionId` 和相同内容可重放；不同内容或竞争
决定返回稳定冲突错误。决定只记录 `actorId`、受控理由码和安全展示投影，
不接受自由格式的原始外部响应。

## 适配器边界

Agent 逻辑可为工具声明可选的 `AgentReconciliationAdapter`。适配器通过
显式 `inspectReconciliation()` 调用，永不由 Worker 自动调用。它只能执行
外部只读查证，并返回标准化 Observation。

适配器获得完整作用域、工具/Attempt 标识、工具声明的安全名称，以及私有的
reconciliation correlation reference。对于 keyed 工具，该 reference 可以是
由 Harness 私下提供的稳定幂等关联值；它不出现在公开快照、事件、Outbox 或
Observation。原始工具参数、凭据和原始外部响应不会被持久化或交给 UI。

没有适配器、适配器返回 `inconclusive` 或适配器失败，都保持 Case 为
`waiting`。操作者仍可按业务证据提交决定。

## 持久化与原子边界

Migration `0008_external_effect_reconciliation.sql` 新增：

- `reconciliation_cases`：一条 scoped Case、状态、Resolution、消费标记和
  row version；
- `reconciliation_observations`：按 Case 顺序追加的脱敏查证记录；
- `reconciliation_transitions`：Case 的 append-only 生命周期审计；
- 对 `ToolExecution` 的 scoped 外键和“每个 ToolExecution 最多一个 Case”的
  唯一约束。

A4b 写入 `waiting_for_reconciliation` 时，在同一个 fenced Commit 中创建
Case、reconciliation checkpoint、事件和 Outbox。旧 0001–0007 迁移不改动。

查证记录和人工 Resolution 不依赖执行 lease，因为它们来自经授权的业务服务，
与 A4a 的 Approval decision 相同；但它们必须使用 Case row version 和操作 ID
进行幂等保护。Case 被 `resolved` 后，Worker 可领取对应 Run；其他仍为
`waiting` 的 reconciliation Run 继续被排除。

Worker 读取冻结的 recovery snapshot 后生成 `consume_reconciliation` 计划。该
计划使用当前 lease/fence 在一个 Commit 中：

1. 验证未被消费的 Resolution；
2. 标记 Case 为 `consumed`；
3. 从 `waiting_for_reconciliation` 恢复 Task / Run；
4. 追加通用、脱敏的 ToolResult、事件、Outbox 和 checkpoint；
5. 继续既有模型循环。

任何事务失败或未知 Commit 结果都重放同一 Commit ID；不得重复消费 Resolution、
追加 ToolResult 或调用原外部工具。

## 模型继续语义

消费时不伪造原外部系统的业务结果。模型只收到受控结果：

| Resolution              | ToolResult                           |
| ----------------------- | ------------------------------------ |
| `confirmed_applied`     | 成功：外部动作已确认生效。           |
| `confirmed_not_applied` | 错误：外部动作已确认未生效。         |
| `confirmed_compensated` | 错误：外部动作已完成补偿。           |
| `abandoned`             | 错误：外部动作无法确认，已终止处理。 |

模型若再次提出工具调用，必须走普通 ToolExecution 生命周期和当前 Approval
Policy。A4c 不会重复旧 Attempt，也不会因为工具声明为 keyed 就绕过审批。

## 取消、冲突与恢复

- Run 在 Case `waiting` 或 `resolved` 时被取消，Case 进入 `cancelled`；历史
  Observation/Resolution 保留，后续消费和模型继续被拒绝。
- 异常旧 fence、范围不匹配、已消费 Case、缺少适配器或与 checkpoint 矛盾的状态
  均使用稳定错误码并不改变外部效果。
- 一个 resolved Case 在进程失效后由兼容 Worker 重新领取，Resolution 仍只会被
  消费一次。
- 适配器错误不得阻塞取消，也不得改变 Task / Run / ToolExecution 状态。

## 公开接口与保密规则

Harness 增加 scope-bound Case 查询、显式查证、提交 Resolution 和分页读取
Observation 的接口。公开 Case、事件和 Outbox 只暴露工具名称、Attempt 标识、
标准分类、受控理由码和展示投影。

以下内容永远不进入公开接口、Case、Observation、事件、Outbox、日志或错误正文：

- 原始工具参数和参数摘要之外的内容；
- 幂等键、correlation reference、凭据和租约令牌；
- 原始外部响应、堆栈和内部适配器错误。

## 验收标准

1. 可逆或外部 orphan Attempt 原子创建一个 waiting Case，且不重复外部调用。
2. foreign scope 无法读取、查证或处置 Case。
3. 只读适配器的 applied/not-applied/inconclusive/failed 结果正确持久化并脱敏。
4. Resolution 首写获胜；重放稳定，竞争和不匹配重放被拒绝。
5. resolved Case 被 Worker 在当前 fence 下恰好消费一次，原 Ledger 历史仍为
   `unknown + unknown`。
6. 模型继续时收到正确的通用 ToolResult；任何再次调用仍经过 Approval Policy。
7. 内存和 PostgreSQL 都证明原子回滚、跨实例查证/决定、进程失效后的消费恢复，
   以及 PostgreSQL 0008 的可重复迁移和校验和稳定性。
8. 全仓 test、typecheck、build、lint、format check 和 diff check 通过。

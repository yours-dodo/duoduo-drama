# Agent Core Phase A3 ToolExecutionLedger Design

Status: Approved design pending written-spec review
Date: 2026-08-02

## 1. Purpose

Phase A3 adds a durable ToolExecutionLedger to the Agent Harness. Its purpose
is to make every model-proposed tool call auditable and to establish the facts
required for later approval and restart recovery without automatically
repeating external side effects.

A3 extends the Phase A2 atomic commit protocol. Task projection, checkpoint,
Run event, Outbox row, Commit receipt, ToolExecution state, Attempt, and
transition history remain one transaction through `AgentRuntimeStore`.

After A3:

1. every proposed tool call has a stable scoped ToolExecution identity;
2. side-effect, idempotency, and timeout declarations are fixed before work;
3. a real tool is never invoked before its `running` state is durable;
4. uncertain external effects are recorded as `unknown`, not guessed;
5. another Harness instance can read the complete scoped execution record;
6. Commit reconciliation cannot duplicate a ToolExecution, Attempt, Event, or
   Outbox row.

## 2. Scope and non-goals

### 2.1 In scope

- mandatory execution metadata on every registered `AgentTool`;
- ToolExecution and Attempt identifiers;
- proposed, prepared, running, and terminal lifecycle states;
- side-effect and effect-outcome semantics;
- stable idempotency-key generation and delivery to keyed tools;
- per-tool timeout and existing cancellation propagation;
- structured tool execution errors;
- atomic Ledger mutations in both Runtime Store adapters;
- scoped Ledger reads through the Harness;
- deterministic in-memory and real PostgreSQL contract tests.

### 2.2 Out of scope

A3 does not implement:

- approval requests, decisions, expiry, or approval UI;
- automatic retry, restart recovery, or orphan scanning;
- reconciliation adapters for external systems;
- dynamic authorization or business-policy evaluation;
- ArtifactStore extraction of large tool results;
- sandbox, credential broker, quota, or cost accounting;
- parallel tool scheduling changes;
- Session persistence, ContextAssembler, Memory, RAG, or Wiki.

These omissions are deliberate. A3 records reliable facts; later phases use
those facts to approve, reconcile, and recover safely.

## 3. Architectural decision

ToolExecutionLedger is part of the deep `AgentRuntimeStore` module. It is not a
separate Store and is not reconstructed only from public events.

```text
Stateless executor
  -> internal tool lifecycle frames
  -> Harness commit coordinator
  -> AgentRuntimeStore.commitTask()
       -> Task / Run / Turn projection
       -> ToolExecution current state
       -> ToolExecution Attempt
       -> append-only transition
       -> checkpoint
       -> Run event
       -> Outbox
       -> Commit receipt
```

This seam keeps atomicity and idempotency inside one module. Callers do not
coordinate multiple Stores or implement compensating transactions.

The executor remains provider-neutral and persistence-neutral. It validates
arguments and performs the tool call, but delegates durable lifecycle decisions
to internal hooks supplied by the Harness. `createAgent()` supplies an
ephemeral coordinator using the same executor.

## 4. Tool declaration contract

Every registered tool must include execution metadata:

```ts
interface AgentToolExecutionDeclaration {
  readonly sideEffect: 'none' | 'reversible' | 'external';
  readonly idempotency: 'none' | 'keyed';
  readonly timeoutMs: number;
}

interface AgentTool {
  readonly definition: ToolDefinition;
  readonly execution: AgentToolExecutionDeclaration;
  execute(
    arguments_: JsonValue,
    context: AgentToolExecutionContext,
  ): Promise<AgentToolResult>;
}
```

The declaration is mandatory. Harness code must never infer it from tool name,
description, arguments, or model output. A later policy layer may raise the
risk or prohibit execution, but it must not weaken the tool declaration.

Validation rules:

- `timeoutMs` is a positive bounded integer;
- duplicate and empty tool names remain invalid;
- `keyed` means the downstream integration is designed to honor the supplied
  key; it is not a claim that every transport is automatically idempotent;
- an unavailable model-proposed tool has internal side-effect classification
  `unknown` and is never invoked.

## 5. Identity and isolation

The runtime identity hierarchy becomes:

```text
Tenant / Project
  -> Task
     -> Run
        -> Turn
           -> ToolExecution
              -> Attempt
```

Harness ID generation adds `tool_execution` and `tool_attempt` kinds. A
ToolExecution is stable for one model Tool Call. Retries in later phases create
new Attempts under the same ToolExecution.

All records and reads use the full Tenant, Project, Task, and Run scope. Reads
must not reveal whether a ToolExecution exists in a different scope.

The model's `toolCallId` remains a protocol correlation value. It is not used
as the durable primary identity because Provider-generated IDs are not assumed
globally unique.

## 6. Lifecycle and invariants

### 6.1 States

```text
proposed
   -> prepared
      -> running
         -> succeeded
         -> failed
         -> cancelled
         -> timed_out
         -> unknown
```

Terminal states do not transition in A3.

### 6.2 State meanings

| State | Meaning |
| --- | --- |
| `proposed` | The model produced a Tool Call and its immutable input digest was recorded. |
| `prepared` | Tool declaration, validated arguments, timeout, and optional idempotency key were fixed. No invocation has begun. |
| `running` | An Attempt and start event are durable. The executor may now call the tool. |
| `succeeded` | A valid result was returned and appended to the transcript. |
| `failed` | Execution failed with a known effect outcome. |
| `cancelled` | Cancellation completed with a known effect outcome. |
| `timed_out` | The deadline expired with a known effect outcome. |
| `unknown` | The external effect cannot be determined safely. Automatic retry is forbidden. |

Unknown tools and invalid arguments transition from `proposed` directly to
`failed` with Attempt count zero. All real invocations require
`prepared -> running` and exactly one new Attempt.

### 6.3 Effect outcome

Terminal records also contain:

```ts
type AgentToolEffectOutcome = 'not_applied' | 'applied' | 'unknown';
```

`unknown` ToolExecution status always carries effect outcome `unknown`.
`succeeded` carries `not_applied` for side-effect-free tools and `applied` for
side-effecting tools. Other terminal states may carry `not_applied` or
`applied` when the Adapter can prove the result.

## 7. Durable execution flow

### 7.1 Proposal

After an assistant response is appended, the executor supplies an internal
model-completed frame containing its Tool Calls. The Harness creates stable
ToolExecution IDs and commits all `proposed` records with the
`model_completed` checkpoint.

Raw valid arguments are canonicalized only in memory and represented in the
Ledger by SHA-256 digest. Invalid raw JSON is hashed as the original string.

### 7.2 Validation and preparation

The executor resolves the registered tool, parses JSON, and validates its
schema.

- unavailable tool, invalid JSON, or schema mismatch: commit `failed` with no
  Attempt, then append the existing generic error ToolResult;
- valid call: fix declaration fields, deadline, and idempotency key, then commit
  `prepared`.

The idempotency key is an opaque Harness-generated value stored once on the
ToolExecution. Every later Attempt for a keyed tool receives the same key.
Non-keyed tools receive no key.

### 7.3 Invocation

Before calling `tool.execute`, the Harness atomically commits:

- ToolExecution `running`;
- a new Attempt with number and Attempt ID;
- append-only `running` transition;
- public `tool_execution_start` event and matching Outbox row.

Only after the Commit receipt returns may the executor invoke the tool.

The execution context is extended with:

```ts
interface AgentToolExecutionContext {
  readonly toolExecutionId: string;
  readonly attempt: number;
  readonly idempotencyKey?: string;
  readonly deadline: string;
  readonly signal: AbortSignal;
  readonly toolCallId: string;
  readonly transcript: readonly Message[];
  update(update: AgentToolUpdate): void;
}
```

The tool-specific signal combines Task cancellation, Harness disposal, and the
declared timeout.

### 7.4 Completion

After the tool result is appended to the transcript, the Harness atomically
commits:

- ToolExecution and Attempt terminal state;
- terminal transition;
- public `tool_execution_end` event and Outbox row;
- `tool_result_appended` checkpoint;
- any associated Task/Run/Turn projection mutation.

The terminal event becomes observable only after this commit succeeds.

If the commit result is uncertain, Phase A2 reconciliation retries the same
Commit ID. This returns the original receipt when the transaction committed and
does not create another Attempt or terminal event.

## 8. Error and uncertainty contract

Tools may throw a structured error:

```ts
class AgentToolExecutionError extends Error {
  readonly code: string;
  readonly kind: 'failed' | 'cancelled' | 'timed_out';
  readonly effectOutcome: 'not_applied' | 'applied' | 'unknown';
  readonly retryable: boolean;
}
```

The public message is Harness-controlled and sanitized. Raw causes are internal
only.

Mapping rules:

| Condition | Ledger result |
| --- | --- |
| Tool unavailable or invalid arguments | `failed + not_applied`, Attempt 0 |
| Side-effect-free tool throws an ordinary error | `failed + not_applied` |
| Side-effecting tool throws an ordinary error | `unknown + unknown` |
| Structured error proves no effect | Declared kind + `not_applied` |
| Structured error proves an effect occurred | `failed + applied` |
| Timeout or cancellation before invocation | `timed_out` or `cancelled` + `not_applied` |
| Timeout or cancellation during a side-effecting invocation | `unknown + unknown` unless the Adapter proves otherwise |

The executor still appends a generic error ToolResult so the current Run can
terminate or continue according to existing semantics. Ledger detail is not
copied into model-visible content.

An A3 process crash can leave a ToolExecution `running`. A3 exposes that fact
but does not mutate or retry it during startup. A later recovery scanner decides
whether a running record becomes retryable or `unknown`.

## 9. Persistence model

Migration `0005_tool_execution_ledger.sql` introduces three tables.

### 9.1 `tool_executions`

One mutable projection per logical Tool Call:

- full Tenant/Project/Task/Run scope;
- Turn ID and index;
- ToolExecution ID and model Tool Call ID;
- tool name and argument digest;
- declared side-effect, idempotency mode, timeout;
- opaque idempotency key when keyed;
- current status, effect outcome, retryable flag;
- current Attempt count;
- latest checkpoint/event references;
- proposed, prepared, started, and finished timestamps;
- optimistic row version.

Uniqueness covers both scoped ToolExecution ID and scoped Run/model Tool Call ID.

### 9.2 `tool_execution_attempts`

One row per actual invocation:

- full scope and ToolExecution ID;
- Attempt ID and positive Attempt number;
- status and effect outcome;
- start, deadline, finish timestamps;
- sanitized error code;
- result digest or later Artifact reference.

Attempt number and Attempt ID are unique inside one ToolExecution.

### 9.3 `tool_execution_transitions`

Append-only audit rows containing:

- full scope and ToolExecution ID;
- monotonic transition sequence;
- previous and next state;
- Attempt ID when relevant;
- causing Commit ID;
- timestamp and sanitized reason code.

Transitions are inserted in the same transaction as the projection update.

No table stores raw credentials, raw infrastructure errors, complete tool
arguments, or complete tool output.

## 10. Store and Harness interfaces

`CommitAgentRuntimeTaskCommand` gains optional Ledger mutations. Their exact
union is public because both official Store adapters implement the same
contract, but callers normally use them only through the Harness coordinator.

The Store validates:

- legal state transitions;
- active Run and Turn ownership;
- immutable declaration and argument digest after proposal;
- Attempt monotonicity;
- idempotency-key stability;
- terminal immutability;
- scoped uniqueness;
- Commit ID reconciliation before optimistic-version validation.

The Harness exposes one scoped read:

```ts
interface ReadAgentToolExecutionsQuery extends ScopedRunQuery {
  readonly after?: string;
  readonly limit?: number;
}

interface AgentToolExecutionPage {
  readonly executions: readonly AgentToolExecutionSnapshot[];
  readonly nextCursor?: string;
  readonly hasMore: boolean;
}
```

Pagination is ordered by proposal sequence and uses a versioned opaque cursor.
Malformed or mismatched cursors return a stable ToolExecution cursor error.
Foreign scope and missing Run remain indistinguishable.

## 11. Public event changes

Tool events retain their existing type names and add correlation metadata:

- `tool_execution_start`: ToolExecution ID, Attempt ID, Attempt number, tool
  name, and Tool Call ID;
- `tool_execution_update`: ToolExecution ID and Attempt number;
- `tool_execution_end`: ToolExecution ID, Attempt number, terminal status,
  effect outcome, and the existing sanitized ToolResult.

Events never include raw arguments, idempotency keys, credentials, or raw
exceptions.

## 12. `createAgent()` compatibility

`createAgent()` continues to use the same stateless executor with an ephemeral
ToolExecution coordinator.

- declarations remain mandatory;
- IDs and keyed idempotency values are stable for one in-process call;
- transcript order and ToolResult behavior remain compatible;
- no persistent read or recovery interface is offered;
- existing Provider and tool wire behaviour remains outside Agent Core.

## 13. Verification plan

The common in-memory and PostgreSQL Store contracts prove:

1. proposed, prepared, running, and succeeded transitions;
2. invalid and unavailable tools produce no Attempt;
3. Attempt and transition uniqueness under Commit retry;
4. stable idempotency keys;
5. optimistic conflict rollback across Ledger, checkpoint, event, and Outbox;
6. scope-safe paged reads;
7. terminal immutability and invalid transition rejection.

Harness tests prove:

1. a successful two-Turn tool loop is fully auditable;
2. raw side-effecting exceptions become `unknown`;
3. structured `not_applied` failures remain deterministic;
4. timeout, Task cancellation, and Harness disposal propagate correctly;
5. tool end events are published only after terminal Ledger commit;
6. durability failure leaves the last committed Ledger state without a
   fabricated terminal record;
7. `createAgent()` compatibility behaviour remains intact.

Real PostgreSQL tests prove:

1. Harness B reads Harness A's ToolExecutions after Harness A is disposed;
2. migration application is repeatable and checksummed;
3. a rejected transaction leaves no partial ToolExecution, Attempt,
   transition, event, Outbox, or Commit receipt;
4. concurrent workers and Commit reconciliation do not duplicate executions.

## 14. Completion criteria

A3 is complete only when:

- every registered tool has an explicit validated execution declaration;
- every model Tool Call produces a durable proposed record;
- no real invocation begins before running state is durable;
- every actual invocation has exactly one Attempt record;
- every terminal result has a matching checkpoint, event, Outbox row, and
  append-only transition in the same transaction;
- uncertain external effects are recorded as `unknown`;
- no A3 path automatically retries an external tool;
- cross-instance reads and all common Store contracts pass against PostgreSQL;
- the full repository test, typecheck, build, lint, and format checks pass.

# Agent Core Phase A4a Persistent Approval Design

Status: Approved design pending implementation
Date: 2026-08-02

## 1. Purpose

Phase A4a adds persistent human approval to the Agent Harness. It allows Agent
logic to stop a validated ToolExecution before preparation, expose a scoped
approval request, accept an idempotent decision from another Harness instance,
and resume the still-running executor without losing the A3 atomicity and
side-effect guarantees.

The intended reader is an Agent Core engineer implementing or reviewing A4a.
After reading this document, that engineer should be able to implement the
approval state machine, Store contract, Harness APIs, and tests without making
new product-policy decisions.

A4a is an execution mechanism. The Agent logic layer decides whether an action
is allowed, denied, or requires approval. The Harness persists and enforces
that decision. The business service authenticates and authorizes the human who
submits a decision.

## 2. Scope and non-goals

### 2.1 In scope

- an explicit versioned `ApprovalPolicy` supplied by Agent logic;
- `allow`, `deny`, and `require_approval` policy outcomes;
- one persistent Approval per ToolExecution;
- Task and Run waiting states;
- approve, deny, expire, cancel, and consume transitions;
- idempotent, scope-safe approval decisions;
- Store-driven polling so one instance can decide and another can resume;
- approval checkpoints, public events, Outbox rows, and cursor-paged reads;
- identical in-memory and PostgreSQL behavior;
- deterministic clock, timer, concurrency, rollback, and isolation tests.

### 2.2 Out of scope

A4a does not implement:

- business authorization or approver eligibility rules;
- approval UI, notifications, email, or mobile push;
- argument editing during approval;
- approval batches or parallel pending approvals;
- restart recovery when the original executor has exited;
- orphan claiming, recovery leases, or automatic retry;
- external-system reconciliation for `unknown` effects;
- sandboxing, credential brokerage, budget enforcement, or Artifact storage.

Restart recovery and orphan claiming belong to A4b. External effect
reconciliation belongs to A4c.

## 3. Architectural decision

Approval state is part of the deep `AgentRuntimeStore` module. It is not a
separate Store and is not delegated to a durable-workflow product.

```text
Agent logic
  -> ApprovalPolicy.evaluate(validated proposal)
  -> allow | deny | require_approval

Harness coordinator
  -> AgentRuntimeStore
       -> Task / Run projection
       -> ToolExecution projection and transition
       -> Approval projection and transition
       -> checkpoint
       -> Run event
       -> Outbox
       -> Commit receipt
```

This design preserves the A3 transaction boundary. A separate Approval Store
would require distributed coordination with ToolExecution, Task, checkpoint,
event, and Outbox state. A general durable-workflow engine would add an
unnecessary runtime dependency before the repository has demonstrated that the
current Harness facilities are insufficient.

## 4. Approval policy contract

The Agent logic layer supplies an optional policy when creating a Harness:

```ts
interface AgentApprovalPolicy {
  readonly policyId: string;
  readonly version: string;
  evaluate(
    context: AgentApprovalPolicyContext,
  ): AgentApprovalPolicyResult | Promise<AgentApprovalPolicyResult>;
}

interface AgentApprovalPolicyContext {
  readonly scope: AgentRequestScope;
  readonly taskId: string;
  readonly runId: string;
  readonly turnId: string;
  readonly turnIndex: number;
  readonly toolExecutionId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly arguments: JsonValue;
  readonly argumentsDigest: string;
  readonly execution: AgentToolExecutionDeclaration;
}

type AgentApprovalPolicyResult =
  | { readonly decision: 'allow' }
  | {
      readonly decision: 'deny';
      readonly reasonCode: string;
    }
  | {
      readonly decision: 'require_approval';
      readonly expiresAt: string;
      readonly presentation: AgentApprovalPresentation;
    };
```

The Harness invokes the policy only after tool lookup, JSON parsing, and Schema
validation, and before ToolExecution preparation. A missing policy means
`allow`; the Harness never infers approval from the tool name, arguments, or
side-effect declaration.

`policyId` and `version` are mandatory non-empty stable identifiers. They enter
the Harness configuration fingerprint. A later recovery worker must reject a
checkpoint when the policy identity is incompatible.

Policy evaluation may inspect validated arguments in memory. Raw arguments are
not copied into Approval persistence or public events.

## 5. Presentation contract

An approval request needs enough product-controlled information for a human to
understand the action without exposing the executor's raw input:

```ts
interface AgentApprovalPresentation {
  readonly title: string;
  readonly description?: string;
  readonly fields?: readonly {
    readonly label: string;
    readonly value: string;
  }[];
}
```

The policy owns this projection. The Harness validates that it is JSON-safe,
that the title is non-empty, and that its UTF-8 JSON representation is at most
32 KiB. It must not contain credentials, idempotency keys, raw causes, or raw
tool arguments. These content rules are part of the Agent logic contract;
structural validation and the size bound are enforced by the Harness.

Approval cannot modify arguments. If a human wants a different action, the
request is denied and the model may propose a new Tool Call, producing a new
ToolExecution and Approval.

## 6. Identity and isolation

The runtime hierarchy becomes:

```text
Tenant / Project
  -> Task
     -> Run
        -> Turn
           -> ToolExecution
              -> Approval
              -> Attempt
```

Harness ID generation adds an `approval` kind. One ToolExecution may create at
most one Approval in A4a. The existing sequential tool scheduler allows at
most one pending Approval in a Run.

Every persisted row and every read or decision command carries the complete
Tenant, Project, Task, Run, and Approval scope. A foreign-scope Approval is
indistinguishable from a missing Approval.

The model Tool Call ID remains only a correlation value. Approval identity is
the Harness-generated Approval ID.

## 7. State models

### 7.1 ToolExecution

A4a adds `awaiting_approval`:

```text
proposed
  |-- policy allow ------------------------------> prepared
  |-- policy deny -------------------------------> failed + not_applied
  `-- require_approval -> awaiting_approval
                            |-- approved/consumed -> prepared
                            |-- denied/consumed ---> failed + not_applied
                            |-- expired/consumed --> failed + not_applied
                            `-- cancelled ---------> failed + not_applied
```

No Attempt exists before `prepared -> running`. A pending, denied, expired, or
cancelled Approval therefore has Attempt count zero.

### 7.2 Approval

```text
pending
  |-- approved
  |-- denied
  |-- expired
  `-- cancelled
```

Approval terminal states are immutable. Consumption is recorded with
`consumedAt` and a stable consume ID rather than another public status. A
terminal unconsumed Approval means a decision exists but no executor has yet
continued the Run.

Consumption appends an audit self-transition, such as
`approved -> approved`, carrying the consume ID and controlled `CONSUMED`
reason. It does not reopen or replace the terminal decision.

### 7.3 Task and Run

Creating a pending Approval atomically changes the active Task and Run from
`running` to `waiting_for_approval`. A decision alone does not change those
states. The executor that consumes the decision atomically restores them to
`running` and advances ToolExecution state.

Keeping the Task waiting between decision and consumption makes a durable fact
explicit: the human decision exists, but continuation has not yet happened.

## 8. Persistent data model

Migration `0006_persistent_approval.sql` introduces two tables and extends the
ToolExecution status constraint.

### 8.1 `approval_requests`

One mutable projection per ToolExecution Approval:

- full Tenant/Project/Task/Run/Turn/ToolExecution scope;
- Approval ID and proposal sequence;
- policy ID and version;
- arguments digest and bounded presentation JSON;
- status and row version;
- requested and expiry timestamps;
- optional decision ID, decision, decided-by reference, reason code, and
  decision timestamp;
- optional consume ID and consume timestamp.

Uniqueness covers scoped Approval ID and scoped ToolExecution ID. A partial
unique constraint enforces at most one pending Approval per Run.

### 8.2 `approval_transitions`

Append-only rows contain:

- full scope and Approval ID;
- monotonic transition sequence;
- previous and next status;
- causing Commit ID;
- decision ID or consume ID when applicable;
- timestamp and controlled reason code.

No Approval table stores raw arguments, credentials, idempotency keys, or raw
Policy errors.

## 9. Durable request flow

After the model-completed proposal commit and argument validation, the Harness
evaluates `ApprovalPolicy`.

### 9.1 Allow

The current A3 flow continues directly to `prepared`. No Approval row is
created.

### 9.2 Immediate deny

The Harness commits ToolExecution `failed + not_applied` with reason
`POLICY_DENIED`, appends the generic error ToolResult and checkpoint, and lets
the model continue. No Approval or Attempt is created.

### 9.3 Require approval

One atomic `commitTask()` writes:

- ToolExecution `awaiting_approval`;
- Approval `pending` and its first transition;
- Task and Run `waiting_for_approval`;
- an `approval_waiting` checkpoint;
- an `approval_requested` Run event and matching Outbox row;
- the Commit receipt.

The `approval_waiting` checkpoint contains the transcript and resume location,
but not a second copy of raw arguments. The ToolExecution argument digest and
assistant Tool Call in the existing transcript establish correlation.

The Task handle's result promise and event stream stay open.

## 10. Decision contract and concurrency

The Harness exposes:

```ts
interface DecideAgentApprovalCommand extends ScopedRunQuery {
  readonly approvalId: string;
  readonly decisionId: string;
  readonly decision: 'approved' | 'denied';
  readonly decidedBy: string;
  readonly reasonCode?: string;
}

interface AgentHarness {
  decideApproval(
    command: DecideAgentApprovalCommand,
  ): Promise<AgentApprovalSnapshot>;
}
```

The Harness supplies trusted time from its `AgentClock`; callers cannot choose
the decision timestamp.

The Store locks the scoped Task and Approval before deciding:

- the first valid decision wins;
- the same decision ID and identical content returns the original receipt;
- reuse of a decision ID with different content returns
  `AGENT_APPROVAL_DECISION_MISMATCH`;
- a different decision after a terminal decision returns
  `AGENT_APPROVAL_ALREADY_DECIDED`;
- `now >= expiresAt` atomically changes a pending Approval to `expired`; the
  Harness then reports `AGENT_APPROVAL_EXPIRED`;
- a foreign-scope or absent request returns `AGENT_APPROVAL_NOT_FOUND`.

The decision transaction updates Approval state and transition history and
advances the Task aggregate version. It does not append a Run event or change
Task/Run from `waiting_for_approval`.

Successful approve or deny calls return the immutable terminal Approval
snapshot. If the call discovers expiry, the Store first commits the `expired`
transition; the Harness then rejects with `AGENT_APPROVAL_EXPIRED`.

## 11. Cross-instance waiting and consumption

The active executor uses an internal `ApprovalWaiter` over public Store reads
and the existing injectable timer. It performs bounded short polling; the
default interval is 1 second, and tests use a deterministic timer. Each wait is
also bounded by `expiresAt` and Task cancellation.

This supports the A4a cross-instance path:

```text
Harness A: request -> wait -> poll Store -> consume -> continue
Harness B:                 decide Approval
```

Harness B does not append a Run event. That preserves Harness A's local event
sequence. Harness A appends `approval_decided` only when it consumes the
decision.

Before consuming, Harness A refreshes the Task version changed by Harness B.
Consumption uses a stable consume ID. Identical consumption is idempotent; a
competing consume ID is rejected.

For an approved decision, one consumption commit writes:

- Approval `consumedAt` and consume transition metadata;
- ToolExecution `prepared`, including a newly generated idempotency key and a
  deadline calculated from consumption time;
- Task and Run `running`;
- an `approval_resolved` checkpoint;
- `approval_decided` event and Outbox row;
- Commit receipt.

Only after this receipt may A3 commit `running + Attempt + start event` and
invoke the tool.

For denied or expired decisions, consumption instead atomically writes:

- Approval consumption metadata;
- ToolExecution `failed + not_applied`, Attempt count zero;
- Task and Run `running`;
- generic error ToolResult and `tool_result_appended` checkpoint;
- `approval_decided` or `approval_expired` plus `tool_execution_end` events and
  matching Outbox rows.

The model then receives the generic result and continues to its next Turn.

## 12. Cancellation and process loss

Task cancellation while an Approval is pending aborts the waiter and commits:

- Approval `cancelled` and consumed;
- ToolExecution `failed + not_applied`, Attempt count zero;
- the existing Task/Run cancellation terminal state and events.

Normal Harness disposal keeps the current contract and cancels its active
Tasks. A process crash writes nothing; the durable Task remains
`waiting_for_approval`. A4b will claim and resume pending or terminal
unconsumed Approvals.

A4a never creates a recovery Attempt and never retries an external action.

## 13. Checkpoints and public events

Checkpoint kinds add:

- `approval_waiting`, with execution position `approval`;
- `approval_resolved`, with execution position `tool` for approved decisions.

Denied and expired consumption uses the existing `tool_result_appended`
checkpoint with execution position `model` because the generic ToolResult is
already part of the transcript.

Public event types add:

- `approval_requested`: Approval ID, ToolExecution ID, policy identity,
  expiry, and presentation;
- `approval_decided`: Approval ID, ToolExecution ID, decision, decided-by
  audit reference, and controlled reason code;
- `approval_expired`: Approval ID and ToolExecution ID.
- `approval_cancelled`: Approval ID and ToolExecution ID.

Approval events never include raw arguments, argument deltas, idempotency keys,
credentials, or raw exceptions.

## 14. Harness read API

```ts
interface ReadAgentApprovalsQuery extends ScopedRunQuery {
  readonly after?: string;
  readonly limit?: number;
}

interface AgentApprovalPage {
  readonly approvals: readonly AgentApprovalSnapshot[];
  readonly nextCursor?: string;
  readonly hasMore: boolean;
}

interface AgentHarness {
  readApprovals(query: ReadAgentApprovalsQuery): Promise<AgentApprovalPage>;
}
```

`AgentApprovalSnapshot` contains the complete scope, Approval and
ToolExecution IDs, proposal sequence, policy identity, arguments digest,
presentation, status, expiry, controlled decision audit fields, consumption
metadata, transition history, and timestamps. It never contains validated or
raw arguments, idempotency keys, credentials, or raw causes.

Paging is ordered by Approval proposal sequence and uses a versioned opaque
cursor bound to Tenant, Project, Task, and Run. Malformed or mismatched cursors
return `AGENT_CURSOR_INVALID`. Missing and foreign-scope Approvals remain
indistinguishable.

## 15. Error and validation contract

New stable errors include:

- `AGENT_APPROVAL_NOT_FOUND`;
- `AGENT_APPROVAL_ALREADY_DECIDED`;
- `AGENT_APPROVAL_DECISION_MISMATCH`;
- `AGENT_APPROVAL_EXPIRED`;
- `AGENT_APPROVAL_POLICY_FAILED`;
- `AGENT_APPROVAL_PRESENTATION_INVALID`.

Policy failure, an invalid policy result, or an invalid presentation fails
closed. The tool is not invoked. ToolExecution becomes
`failed + not_applied`, and the Task enters a stable failed terminal state. Raw
Policy exceptions remain internal causes.

Store unavailability while waiting or consuming uses
`AGENT_DURABILITY_FAILED`. The executor stops at the last committed state and
does not invent an Approval decision or ToolExecution terminal state.

Decision ID, decided-by reference, and reason code have non-empty bounded
formats. Exact limits are part of the implementation constants and tests:

- IDs and decided-by references: 1 through 256 UTF-8 bytes;
- reason codes: 1 through 128 ASCII characters matching
  `[A-Z][A-Z0-9_]*`;
- presentation: at most 32 KiB of UTF-8 JSON.

## 16. Verification plan and test seams

Tests use only three public seams agreed for Agent Core:

1. `createAgentHarness()` for waiting, deciding, resuming, denying, expiring,
   cancellation, and event behavior;
2. `AgentRuntimeStore` for state transitions, idempotency, concurrency,
   rollback, and scoped reads;
3. PostgreSQL Harness/Store integration for real migrations, transactions, and
   cross-instance decisions.

Required deterministic scenarios are:

1. policy allow preserves the A3 path and creates no Approval;
2. immediate policy deny invokes no tool and creates no Approval;
3. require approval atomically waits with Attempt count zero;
4. same-instance approval resumes exactly once;
5. Harness B approves and Harness A observes and resumes;
6. denied and expired requests append generic results and continue the model;
7. Task cancellation and Harness disposal invoke no tool;
8. decision replay, mismatch, competing decisions, and expiry races are stable;
9. duplicate consumption creates no second event, checkpoint, or Attempt;
10. a rejected Store transaction exposes no partial Approval, Ledger, event,
    Outbox, checkpoint, or receipt;
11. scope-bound paging rejects malformed and foreign cursors;
12. arguments, idempotency keys, credentials, and raw causes do not enter
    Approval persistence or public events;
13. Policy failure is fail-closed and sanitized;
14. the full A1-A3 regression suite remains compatible.

Implementation follows vertical TDD slices: one failing public-seam test, the
minimum implementation to pass, then the next behavior.

## 17. Completion criteria

A4a is complete only when:

- every policy outcome has a durable, tested behavior;
- no Approval path invokes a tool before approved consumption and A3 running
  commit;
- denied, expired, and cancelled requests have zero Attempts;
- cross-instance decisions wake a live executor without corrupting Run event
  sequence;
- decisions and consumption are idempotent under retries and concurrency;
- Approval, ToolExecution, Task, checkpoint, event, Outbox, and Commit receipt
  cannot become partially visible;
- migration application is repeatable and checksummed;
- in-memory, real PostgreSQL, and repository-wide verification pass;
- documentation continues to state that restart recovery and external effect
  reconciliation remain A4b and A4c work.

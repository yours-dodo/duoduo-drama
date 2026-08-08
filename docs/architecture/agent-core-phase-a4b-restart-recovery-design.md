# Agent Core Phase A4b Restart Recovery Design

Status: Approved design pending implementation
Date: 2026-08-08

## 1. Purpose

Phase A4b makes an active Agent Run recoverable after its executor process
exits, stalls, or deliberately hands work to another process. A compatible
Recovery Worker claims the Run through a fenced lease, reads the last durable
checkpoint and execution projections, builds a deterministic recovery plan,
and continues without replaying completed model Turns or duplicating unsafe
external effects.

The intended reader is an Agent Core engineer implementing or reviewing A4b.
After reading this document, that engineer should be able to implement Run
leases, fencing, checkpoint schema v3, recovery planning, the Recovery Worker,
safe resume paths, PostgreSQL migration 0007, and the required tests without
making new product-policy decisions.

A4b remains a Harness capability. Agent logic supplies the same model, prompt,
tools, and approval policy used by the original Run. The business service still
owns authentication, project authorization, and canonical business data.

## 2. Scope and non-goals

### 2.1 In scope

- one fenced execution lease per active durable Run;
- initial ownership, heartbeat renewal, lease expiry, claim, release, and
  explicit handoff;
- an independent `AgentRecoveryWorker` that can run in the Agent process or a
  dedicated Worker process;
- checkpoint schema v3 with an explicit resume cursor and terminal data;
- deterministic recovery from model, tool, approval, and finalization
  boundaries;
- retry of an orphaned running Attempt only when `sideEffect` is `none`;
- conservative quarantine of orphaned reversible or external work;
- PostgreSQL atomic claiming with database time and `SKIP LOCKED`;
- append-only recovery audit and stable operational failure codes;
- deterministic in-memory tests and real PostgreSQL process-exit tests.

### 2.2 Out of scope

A4b does not implement:

- external-system lookup, compensation, or reconciliation;
- automatic retry of reversible or external tools, including keyed tools;
- business authorization rules or approval UI;
- Provider fallback, model-error retry, budgets, or cost policy;
- Context, Memory, RAG, Wiki, Artifact Runtime, sandbox, or multi-Agent state;
- an external durable-workflow platform or queue product;
- a general persisted AgentDefinition registry.

External-effect reconciliation belongs to A4c. A later Agent-definition phase
may allow one Worker to load many persisted definitions. A4b uses explicitly
composed runtime configuration and its existing fingerprint.

## 3. Architectural decision

A4b extends the deep Harness module rather than introducing a second execution
runtime. The same stateless executor is driven by either a new Task or a
`RecoveryPlan`:

```text
Agent runtime configuration
  -> createAgentHarness() ---------> new Run owner
  -> createAgentRecoveryWorker() --> recovered Run owner

Both owners
  -> fenced Run lease
  -> shared active-Run driver
  -> AgentRuntimeStore
       -> Task / Run / Turn projection
       -> checkpoint history
       -> ToolExecution / Attempt ledger
       -> Approval lifecycle
       -> event log / Outbox / Commit receipt
       -> recovery coordination / audit
```

The Recovery Worker is explicit. Creating a normal Harness does not silently
start a whole-database scanner. One Worker instance handles one resolved runtime
configuration fingerprint in A4b. Deployments with multiple configurations
start multiple Workers; PostgreSQL claiming prevents duplicate ownership.

The Store remains the concurrency authority. Process-local maps and timers are
coordination aids, not ownership facts.

## 4. Run execution lease and fencing

### 4.1 Lease identity

Every active Run in a durable Store has one execution lease:

```ts
interface AgentRunExecutionLease {
  readonly ownerId: string;
  readonly leaseToken: string;
  readonly fencingToken: number;
  readonly claimedAt: string;
  readonly leaseExpiresAt: string;
}
```

- `ownerId` identifies one Harness or Recovery Worker instance.
- `leaseToken` is an unguessable value used only inside the Harness/Store
  protocol.
- `fencingToken` is a monotonically increasing value scoped to one Run.
- timestamps are Store-authoritative for PostgreSQL.

The initial Harness obtains fencing token 1 when it creates the durable Run.
Every later successful claim increments the fencing token. Token reuse is never
allowed.

### 4.2 Guarded writes

All execution-owned writes carry:

```ts
interface AgentRunLeaseGuard {
  readonly leaseToken: string;
  readonly fencingToken: number;
}
```

`commitTask()` and executor-owned Approval resolution validate the guard in the
same database transaction as the state change. A stale or missing guard returns
`AGENT_RUN_LEASE_LOST` before any projection, checkpoint, Ledger, Approval,
event, Outbox, or receipt write becomes visible.

`decideApproval()` does not require the execution lease. A separate Harness may
record the human decision. Consuming that decision, emitting its Run event, and
continuing the ToolExecution do require the current lease.

Optimistic Task version and fencing solve different problems and both remain:

- `expectedVersion` orders aggregate state changes;
- fencing rejects an executor whose ownership has expired even if its cached
  aggregate version would otherwise appear usable.

### 4.3 Heartbeat and expiry

Defaults are:

- lease duration: 30 seconds;
- heartbeat interval: 10 seconds;
- idle scan interval: 1 second;
- claim batch size: 10 Runs;
- active recovery concurrency: 4 Runs.

All are bounded and configurable. PostgreSQL compares expiry with database
time, not process wall-clock time. The in-memory Store uses the injected test
clock.

Renewal uses the same lease and fencing token and does not change Task version,
append a public event, or create an Outbox row. An ambiguous renewal may be
replayed idempotently. The executor stops starting new work when renewal is in
doubt. If ownership cannot be proven before expiry, it aborts local model and
tool signals and treats the lease as lost.

## 5. Public Harness and Worker contracts

### 5.1 Recovery Worker

```ts
interface AgentRecoveryWorker {
  start(): Promise<void>;
  recoverOnce(): Promise<AgentRecoveryBatchResult>;
  dispose(): Promise<void>;
}

interface AgentRecoveryBatchResult {
  readonly claimed: number;
  readonly resumed: number;
  readonly blocked: number;
  readonly waitingForReconciliation: number;
}
```

`createAgentRecoveryWorker()` accepts the same model, system prompt, tools,
stream configuration, credential composition, and ApprovalPolicy inputs needed
to execute the original Run. Model identity, prompt, tools, and ApprovalPolicy
produce the existing Harness configuration fingerprint. The Worker additionally
requires a durable `AgentRuntimeStore` and a stable non-empty `workerId`.

- `start()` begins a single idempotent scan loop.
- `recoverOnce()` claims and processes one bounded batch without starting a
  background loop.
- `dispose()` stops new claims, aborts local execution as ownership handoff,
  releases safe leases, and waits for local drivers to stop.

Recovery Worker construction rejects an ephemeral Store with
`AGENT_RECOVERY_UNAVAILABLE`.

### 5.2 Harness handoff

A4b adds:

```ts
interface AgentHarness {
  handoff(): Promise<void>;
}
```

`handoff()` stops acceptance of new Tasks, interrupts active local execution
without writing a cancelled or failed terminal result, and makes durable Runs
available for compatible Recovery Workers. It is idempotent.

Existing `dispose()` semantics do not change: it actively cancels Tasks and
disposes runtime resources. The first terminal lifecycle operation,
`handoff()` or `dispose()`, wins; later calls return the same completion promise.
An ephemeral Harness cannot hand work to another process and returns
`AGENT_RECOVERY_UNAVAILABLE`.

### 5.3 Lost ownership for a live handle

If a live Task handle loses its lease:

- local model/tool signals are aborted;
- no fabricated Task terminal state is committed;
- `result()` and the live observer reject with
  `AGENT_EXECUTION_OWNERSHIP_LOST`;
- clients continue through `readEvents()` using the durable cursor;
- a later compatible owner continues the same Task and Run.

## 6. AgentRuntimeStore recovery port

A4b extends the Store with deep recovery operations. Exact transport details
remain adapter-internal, but the semantic commands are:

```ts
interface AgentRuntimeStore {
  claimRecoverableRuns(
    command: ClaimRecoverableAgentRunsCommand,
  ): Promise<AgentRunClaimBatch>;
  renewRunLease(
    command: RenewAgentRunLeaseCommand,
  ): Promise<AgentRunExecutionLease>;
  releaseRunLease(command: ReleaseAgentRunLeaseCommand): Promise<void>;
  readRecoverySnapshot(
    command: ReadAgentRunRecoveryCommand,
  ): Promise<AgentRunRecoverySnapshot>;
}
```

Claim filtering includes:

- non-terminal Task and Run;
- absent, released, or expired execution lease;
- `availableAt` not in the future;
- latest checkpoint configuration fingerprint equal to the Worker fingerprint;
- status not already `waiting_for_reconciliation` or `recovery_blocked`.

Claiming locks candidates with `FOR UPDATE SKIP LOCKED`, installs a new lease,
increments fencing, and appends a recovery-claim audit record in one
transaction. It does not change Task version or append a public Run event.

The returned claim contains complete Tenant/Project/Task/Run scope and lease
guard. The Worker then reads one repeatable recovery snapshot containing the
Task projection, latest checkpoint, ordered Ledger records, Approvals, and last
durable event position.

## 7. PostgreSQL migration 0007

Migration `0007_run_recovery.sql` is additive and forward-only. It does not edit
0001 through 0006.

### 7.1 `run_execution_leases`

One coordination projection per durable Run:

- full Tenant/Project/Task/Run scope;
- current owner and lease token, both nullable when released;
- monotonic fencing token;
- claimed, renewed, and expiry timestamps;
- next recovery availability timestamp;
- bounded consecutive recovery failure count and controlled last failure code;
- current configuration fingerprint.

The table is retained after release so fencing never resets. Lease tokens are
not copied to Tasks, checkpoints, events, Outbox rows, logs, or public
snapshots.

### 7.2 `run_recovery_audit`

Append-only records contain:

- full scope and monotonic recovery sequence;
- recovery ID, owner ID, fencing token, and action;
- `initial_claim`, `recovery_claim`, `handoff`, `lease_lost`, `released`,
  `resumed`, `blocked`, or `terminal` action;
- controlled reason code and timestamp.

Heartbeat renewal is deliberately excluded from append-only audit to avoid
unbounded noise. Current renewal time remains visible in the lease projection
and operational metrics.

### 7.3 State and checkpoint constraints

Task and Run status constraints add:

- `waiting_for_reconciliation` for an unresolved external effect;
- `recovery_blocked` for an incompatible or structurally invalid recovery
  state.

Checkpoint constraints add schema-v3 resume data and execution positions for
`reconciliation` and `recovery`. The Store validates status, checkpoint,
Ledger, and lease transitions atomically.

## 8. Checkpoint schema v3

Schema v3 stores an explicit resume cursor rather than asking the recovery code
to infer the next action from transcript shape alone:

```ts
type AgentRuntimeResumeState =
  | {
      readonly kind: 'model';
      readonly nextTurnIndex: number;
    }
  | {
      readonly kind: 'tool';
      readonly turnIndex: number;
      readonly nextProposalSequence: number;
    }
  | {
      readonly kind: 'approval';
      readonly turnIndex: number;
      readonly approvalId: string;
      readonly toolExecutionId: string;
    }
  | {
      readonly kind: 'finalize';
      readonly result: AgentRunResult;
    }
  | {
      readonly kind: 'reconciliation';
      readonly toolExecutionId: string;
      readonly attemptId: string;
    };
```

The checkpoint still stores the frozen transcript, input where applicable,
Harness protocol version, checkpoint schema version, and configuration
fingerprint. Resume data contains no credentials or lease tokens.

New Tasks write schema v3 from `input_accepted`. Existing schema-v2 checkpoints
are recovered only where the next action is unambiguous from the checkpoint,
Task, Ledger, and Approval projections. A v1/v2 terminal-position checkpoint
that lacks enough data to reconstruct the exact result becomes
`recovery_blocked`; it is never silently converted into a new model Turn.

Protocol-version incompatibility also blocks recovery. Schema and protocol
migrations must be explicit and deterministic.

## 9. Deterministic RecoveryPlan

Recovery planning is a pure function over one immutable recovery snapshot. It
does not query Providers, call tools, mutate Store state, or read environment
variables.

```ts
type AgentRecoveryPlan =
  | { readonly kind: 'continue_model'; readonly nextTurnIndex: number }
  | {
      readonly kind: 'continue_tools';
      readonly turnIndex: number;
      readonly nextProposalSequence: number;
    }
  | { readonly kind: 'wait_for_approval'; readonly approvalId: string }
  | { readonly kind: 'consume_approval'; readonly approvalId: string }
  | { readonly kind: 'reprepare_tool'; readonly toolExecutionId: string }
  | { readonly kind: 'retry_safe_tool'; readonly toolExecutionId: string }
  | {
      readonly kind: 'wait_for_reconciliation';
      readonly toolExecutionId: string;
      readonly attemptId: string;
    }
  | { readonly kind: 'finalize'; readonly result: AgentRunResult }
  | { readonly kind: 'blocked'; readonly reasonCode: string }
  | { readonly kind: 'ignore_terminal' };
```

The planner first validates complete scope, active Run identity, Task/Run
status, lease guard, checkpoint compatibility, configuration fingerprint,
Turn ordering, Ledger transitions, Approval state, and event position. Any
contradiction produces a controlled blocked plan rather than a best guess.

## 10. Model and event recovery

### 10.1 Completed model work

`input_accepted` and `tool_result_appended -> model` resume from the stored
transcript and `nextTurnIndex`. A completed model Turn is never requested again.

`model_completed -> tool` skips the Provider and continues with the ordered
ToolExecution proposals already committed with that checkpoint.

`finalize` writes only missing terminal lifecycle state and events. It does not
call the Provider.

### 10.2 Incomplete model work

Most Providers cannot resume an interrupted stream. If no `model_completed`
checkpoint exists for the current Turn, A4b may request that one incomplete
Turn again. This is the only automatic model re-execution in A4b.

Model lifecycle events add optional Harness-generated `modelAttemptId` and
monotonic `modelAttempt` correlation. Partial events from the abandoned attempt
remain immutable. The recovered attempt appends a new `model_start` and new
deltas under the same Turn with a new model attempt identity.

The shared active-Run driver accepts an initial event sequence and resume cursor
so it neither emits a second `run_start` nor creates a duplicate Turn row.
Durable Run event sequence always continues after the Store's last committed
sequence.

This design minimizes token use: prior completed Turns are not sampled again.
Tokens spent by an interrupted, uncheckpointed model request cannot generally
be recovered.

## 11. Tool recovery

### 11.1 Proposed and prepared

For `model_completed -> tool`, the Worker reconstructs call order from the
assistant message and validates each call against the scoped Ledger projection.
Completed ToolExecutions are skipped. The first unfinished proposal is resumed.

A `prepared` ToolExecution has no running Attempt and therefore no possible
tool side effect. Recovery retains its ToolExecution ID and idempotency key,
refreshes the execution deadline through a fenced commit, and then starts the
next Attempt.

### 11.2 Orphaned running Attempt with no side effect

If `sideEffect === 'none'`, one fenced atomic recovery commit:

- closes the old Attempt as `unknown + not_applied` with controlled reason
  `OWNER_LEASE_EXPIRED`;
- transitions the ToolExecution from `running` back to `prepared` with
  `SAFE_RECOVERY_RETRY`;
- preserves ToolExecution ID and existing idempotency key;
- refreshes the deadline;
- records the recovery audit fact.

The next invocation creates Attempt N+1. It never reuses the old Attempt ID.
Duplicate computation is permitted because the declaration proves no external
side effect. The old result, if any, is treated as unavailable.

### 11.3 Orphaned reversible or external Attempt

If `sideEffect` is `reversible` or `external`, a fenced atomic commit:

- closes the Attempt and ToolExecution as `unknown + unknown`;
- sets `retryable: false` for A4b;
- moves Task and Run to `waiting_for_reconciliation`;
- writes a `reconciliation_waiting` checkpoint;
- emits one sanitized `run_reconciliation_required` event and matching Outbox
  row;
- records the recovery audit fact.

`idempotency: keyed` does not weaken this rule. The declaration means the
integration is designed to honor a key, not that every transport or downstream
system has proven the first attempt's outcome. A4c decides how to query,
reconcile, compensate, approve, or retry it.

## 12. Approval recovery

For an `approval_waiting` checkpoint:

- pending Approval: restore Store polling and expiry timer without invoking the
  model or tool;
- approved terminal and unconsumed: consume once, prepare the ToolExecution,
  append the decision event, and continue;
- denied or expired and unconsumed: consume once, append the generic ToolResult,
  and continue the next model Turn;
- cancelled: preserve cancellation semantics and never invoke the tool;
- consumed: follow the later checkpoint and Ledger state rather than consuming
  again.

The Recovery Worker never recreates an Approval and never generates a new
decision ID. Store first-writer-wins and consume-ID idempotency remain the
authority.

An Approval may be decided by another Harness while a Run is unowned. That
decision changes Task version but not execution lease. The Worker refreshes the
recovery snapshot and expected version before its first consumption commit.

## 13. Handoff, shutdown, and ownership loss

### 13.1 Explicit handoff

`AgentHarness.handoff()` and `AgentRecoveryWorker.dispose()` use an internal
ownership-loss signal distinct from Task cancellation:

1. stop accepting or claiming work;
2. stop starting new Provider/tool operations;
3. abort active local signals;
4. flush any already-completed fenced commit;
5. release or immediately expire the lease;
6. append a handoff audit record;
7. dispose owned AI runtime resources.

No Task/Run `cancelled` state or model-visible cancellation ToolResult is
fabricated. A compatible Worker classifies the last durable state when it
claims the Run.

### 13.2 Crash or partition

A crash writes nothing. A stalled or partitioned owner may continue local
computation, but after lease expiry its fencing token cannot commit. The new
owner handles possible in-flight tool effects using the conservative rules in
section 11.

### 13.3 Dispose compatibility

`AgentHarness.dispose()` remains active cancellation and writes the same stable
terminal behavior already verified by A1–A4a. Callers must use `handoff()` for
rolling deployment or workload transfer.

## 14. Recovery failure and backoff

Stable A4b errors include:

- `AGENT_RECOVERY_UNAVAILABLE`;
- `AGENT_RUN_LEASE_LOST`;
- `AGENT_EXECUTION_OWNERSHIP_LOST`;
- `AGENT_RECOVERY_STATE_INVALID`;
- `AGENT_RECOVERY_CONFIG_MISMATCH`;
- `AGENT_RECOVERY_CHECKPOINT_INCOMPATIBLE`.

Raw Store, Provider, and tool causes stay internal. Recovery audit and public
events contain controlled reason codes only.

Transient recovery-driver failures release the lease with a bounded failure
count and exponential backoff with jitter. The default delay starts at one
second and caps at five minutes. A successful durable progress commit resets
the consecutive failure count.

Structural state contradictions, unsupported checkpoint/protocol versions, or
missing required tool definitions move the Task and Run to `recovery_blocked`
through one fenced atomic commit. They are excluded from automatic scans until
an explicit operator action or later compatible migration changes the state.

A configuration fingerprint mismatch is handled before claim: that Worker
ignores the Run. The lease projection and operations query expose expired Runs
for which no compatible Worker has claimed ownership, but A4b does not let an
incompatible Worker mark another configuration permanently blocked.

## 15. Isolation, security, and configuration

- Every claim, snapshot, lease, audit, commit, Ledger, Approval, checkpoint,
  event, and Outbox record carries complete Tenant/Project/Task/Run scope.
- Recovery scanning is an internal system capability. It is not exposed as a
  tenant-facing API and requires a database role limited to Agent Runtime
  tables.
- Lease tokens, idempotency keys, credentials, raw arguments, and raw causes do
  not enter public snapshots, events, Outbox payloads, or logs.
- The Worker resumes only an exact configuration fingerprint. It does not
  silently adopt a new model, prompt, toolset, or ApprovalPolicy.
- A4b preserves the authorization and configuration snapshot of the existing
  Run. It does not invent new business authority. Tool adapters remain
  responsible for using the scoped, short-lived authority supplied by later
  Server integration.
- A business cancellation committed before or during claim wins through Task
  version and terminal-state validation.

## 16. Operations

Recovery scanning is explicitly enabled in deployment composition. API-only
processes may create Harnesses without running a scanner. At least one
compatible Worker must exist for every recoverable runtime fingerprint.

Operational signals include:

- active, expired, and unowned lease counts;
- claim, resume, handoff, lease-loss, blocked, and terminal counts;
- claim latency and time from lease expiry to resumed progress;
- consecutive recovery failures and next availability;
- Tasks waiting for reconciliation;
- expired Runs with no compatible Worker.

Alerts should target sustained unowned Runs, repeated lease loss, recovery
backoff saturation, and reconciliation backlog. Heartbeat churn is a metric,
not an append-only event stream.

Rolling deployment sequence is:

1. deploy migration 0007;
2. start compatible Recovery Workers;
3. call `handoff()` on draining Harness owners;
4. wait for local ownership release;
5. stop old processes;
6. verify claims and durable event progress.

## 17. Verification plan

Tests use four seams:

1. pure `planAgentRunRecovery()` for state classification;
2. common `AgentRuntimeStore` contract for lease, fencing, audit, and atomicity;
3. `createAgentHarness()` and `createAgentRecoveryWorker()` for behavioral
   resume;
4. real PostgreSQL child-process tests for actual process exit.

Required deterministic scenarios are:

1. two Workers race and only one receives the Run lease;
2. heartbeat prevents takeover and ambiguous renewal is idempotent;
3. stale lease and fencing tokens cannot write any partial state;
4. `SIGKILL` of the original process is recovered after database-time expiry;
5. a completed model Turn is not called again;
6. only an interrupted, uncheckpointed model Turn is sampled again;
7. event sequence continues without duplicate `run_start` or Turn rows;
8. pending Approval resumes waiting and expiry;
9. terminal unconsumed Approval is consumed exactly once;
10. prepared ToolExecution resumes with stable identity and one new Attempt;
11. orphaned side-effect-free Attempt becomes Attempt N+1;
12. orphaned reversible/external Attempt is never retried and enters
    reconciliation wait;
13. terminal, blocked, mismatched-config, and incompatible-checkpoint Runs are
    not repeatedly claimed;
14. `handoff()` preserves a non-terminal Run while `dispose()` still cancels;
15. lease loss rejects the old live handle without fabricating terminal state;
16. claim, classification, status, checkpoint, Ledger, event, Outbox, receipt,
    and audit changes roll back together on injected failure;
17. full scope isolation and sanitized payload rules hold;
18. Provider invocation counts prove completed Turns are not replayed;
19. the complete A1–A4a suite remains compatible.

The real process test uses a deterministic faux Provider and isolated
PostgreSQL. A child process starts a Run and reports its scoped IDs, the parent
terminates it without `dispose()`, a second process starts a compatible Worker,
and assertions are read from durable state. No paid or nondeterministic Provider
is used.

## 18. Implementation slices

A4b is implemented as ten vertical TDD slices:

1. **Lease and fencing contract:** in-memory claim, renew, release, expiry, and
   stale-write rejection.
2. **Initial durable ownership:** new Task lease, heartbeat, ownership-loss
   signal, and unchanged ephemeral behavior.
3. **Checkpoint v3 and RecoveryPlan:** explicit resume states, compatibility
   checks, and pure planner matrix.
4. **Model-boundary recovery:** shared active-Run driver, initial sequence,
   model-attempt correlation, and no replay of completed Turns.
5. **Tool-boundary recovery:** ordered proposal reconstruction, completed-call
   skipping, and prepared re-entry.
6. **Approval recovery:** pending wait, terminal consumption, expiry, and
   exactly-once continuation.
7. **Orphan Attempt policy:** safe retry for `sideEffect: none` and
   reconciliation quarantine for all side-effecting work.
8. **Recovery Worker and handoff:** bounded scanning, concurrency, heartbeat,
   backoff, explicit handoff, and ownership-loss behavior.
9. **PostgreSQL migration and competition:** migration 0007, database-time
   leasing, `SKIP LOCKED`, fencing, rollback, and multi-Worker tests.
10. **Process restart, operations, and integration:** real child-process exit,
    token-saving invocation proof, full regressions, exports, and documentation.

Each slice must demonstrate observable progress through a public seam. Schema
or interface changes alone do not complete a slice.

## 19. Completion criteria

A4b is complete only when:

- every active durable Run has one fenced execution owner;
- an expired owner cannot commit after another owner claims the Run;
- compatible checkpoint boundaries resume without replaying completed model
  Turns;
- Approval recovery preserves first-writer-wins and exactly-once consumption;
- prepared and side-effect-free ToolExecutions recover under the conservative
  retry policy;
- reversible and external orphan Attempts never auto-retry;
- incompatible state becomes visible and bounded rather than looping;
- explicit handoff and crash recovery both preserve durable event order;
- migration application remains repeatable and checksummed;
- real PostgreSQL process-exit and full repository verification pass;
- documentation continues to state that external-effect reconciliation remains
  A4c work.

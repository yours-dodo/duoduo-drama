# M001: Agent Core A3 ToolExecutionLedger

## Vision

Make every model-proposed tool call durable, scoped, auditable, and safe to
classify without automatically repeating external side effects. Extend the A2
atomic runtime commit protocol rather than creating a second persistence seam.

Source design:
`docs/architecture/agent-core-phase-a3-tool-execution-ledger-design.md`.

## Success Criteria

- Every registered `AgentTool` declares side effect, idempotency, and timeout.
- Every model Tool Call creates one stable scoped ToolExecution.
- No real invocation begins before `running` and its Attempt are durable.
- Successful and failed execution paths atomically commit Ledger state,
  transition, checkpoint, event, Outbox, and Commit receipt.
- Uncertain external effects become `unknown` and are never automatically
  retried in A3.
- Commit reconciliation and optimistic conflicts cannot duplicate or partially
  expose Ledger data.
- A separate PostgreSQL-backed Harness can page executions written by another
  Harness instance.
- Existing A1 and A2 behavior remains compatible.

## Key Risks

- Refactoring the executor tool lifecycle could change transcript or event
  order used by `createAgent()` and the Harness.
- A crash window around a real side effect can be mislabeled unless ordinary
  external-tool failures are treated conservatively as `unknown`.
- Ledger projection, Attempt, transition, event, checkpoint, and Outbox can
  diverge if any are written outside the Runtime Store transaction.
- Timeout and cancellation can claim a deterministic outcome even when an
  external system may already have applied a change.
- Commit retry can create duplicate Attempts unless reconciliation happens
  before version and transition validation.
- Tool arguments, idempotency keys, or raw infrastructure errors can leak via
  public events or persisted audit fields.

## Slices

- [x] **S01: Declared tool execution with ephemeral coordinator** `risk:high` `depends:[]`
  > After this: `createAgent()` requires execution declarations and a tool receives execution ID, Attempt, deadline, and stable keyed idempotency context without changing transcript behavior.
- [x] **S02: Successful in-memory Ledger lifecycle** `risk:high` `depends:[S01]`
  > After this: one Harness tool call exposes proposed, prepared, running, succeeded, one Attempt, transitions, checkpoint, event, and Outbox through the in-memory Store.
- [x] **S03: Cross-instance PostgreSQL Ledger** `risk:high` `depends:[S02]`
  > After this: the forward migration creates Ledger storage and Harness B reads the complete execution written by Harness A.
- [x] **S04: Rejected proposals without invocation** `risk:medium` `depends:[S02,S03]`
  > After this: unavailable tools, invalid JSON, and schema failures are durable failed/not-applied proposals with zero Attempts and no real invocation.
- [x] **S05: Side-effect outcome classification** `risk:high` `depends:[S02]`
  > After this: ordinary and structured tool failures map to failed, applied, or unknown outcomes conservatively and expose only sanitized errors.
- [x] **S06: Deadline and cancellation semantics** `risk:high` `depends:[S05]`
  > After this: timeout, Task cancellation, and Harness disposal reach the tool signal and persist deterministic or unknown outcomes without unsafe retry.
- [x] **S07: Commit reconciliation and atomic rollback** `risk:high` `depends:[S03,S05]`
  > After this: unknown Commit results, optimistic conflicts, and rejected PostgreSQL transactions cannot duplicate or partially expose executions, Attempts, transitions, events, or Outbox rows.
- [x] **S08: Scoped paging and public event contract** `risk:medium` `depends:[S03]`
  > After this: clients page scoped ToolExecutions with opaque cursors and correlate sanitized tool events without seeing arguments or idempotency keys.
- [x] **S09: Compatibility, operations, and final integration** `risk:low` `depends:[S04,S06,S07,S08]`
  > After this: A1-A3 tests, real PostgreSQL, migration CLI, repository verification, status docs, and runtime protocols all agree.

## Proof Strategy

Retire executor-seam risk first with an ephemeral end-to-end `createAgent()`
path. Then prove one complete successful Ledger lifecycle in memory before
committing to PostgreSQL schema. Add rejected, uncertain, timeout, and
cancellation paths only after the successful state machine is observable.
Finally attack duplicate/partial-write failure modes and public paging.

No slice is complete from type-level scaffolding alone. Each slice must produce
an observable execution path through the public executor, Harness, or Store
interface named in its demo line.

## Verification Classes

- **Executor compatibility:** deterministic faux Provider and tool-loop tests
  through `createAgent()`.
- **Harness behavior:** Task result, live events, checkpoints, and scoped Ledger
  reads through `createAgentHarness()`.
- **Common Store contract:** identical state-machine, idempotency, transition,
  and rollback assertions for in-memory and PostgreSQL adapters.
- **PostgreSQL integration:** real database migrations, cross-Harness reads,
  Commit retry, optimistic conflict, and atomic rollback.
- **Security and isolation:** foreign scope, malformed cursor, sanitized event,
  error, argument, and idempotency-key assertions.
- **Repository regression:** root test, typecheck, build, lint, format check,
  `git diff --check`, and status inspection.

## Definition of Done

- All nine slices are complete and their demo lines are reproducible.
- Migration application is repeatable and every applied checksum is stable.
- Public root and PostgreSQL subpath exports contain only documented types and
  factories.
- Tool invocation never precedes a durable running Attempt.
- No external side-effect failure is guessed to be not applied.
- A3 performs no automatic tool retry or startup recovery.
- All common and PostgreSQL contract tests pass.
- Full repository verification passes after the final code change.
- `agent/AGENTS.md`, Agent README, runtime protocol, and project plan reflect
  the implemented boundary and remaining A4/A5 work.

## Requirement Coverage

| Requirement                                                | Slices   |
| ---------------------------------------------------------- | -------- |
| Mandatory execution declaration and context                | S01      |
| Durable lifecycle, Attempt, transition, and atomic success | S02, S03 |
| Unknown/invalid/schema rejection with Attempt 0            | S04      |
| Conservative side-effect and structured error outcomes     | S05      |
| Timeout, cancellation, and disposal propagation            | S06      |
| Commit idempotency, conflicts, and rollback                | S07      |
| Scoped cursor reads and sanitized public events            | S08      |
| Compatibility, operations, and documentation               | S09      |

## Horizontal Checklist

- [x] Full Tenant/Project/Task/Run scope is present on every Ledger table and
      query.
- [x] Raw arguments, idempotency keys, credentials, and raw causes never enter
      public events.
- [x] Runtime Store adapters implement the same transition invariants.
- [x] Terminal ToolExecutions are immutable.
- [x] Attempt numbers are positive, monotonic, and unique per ToolExecution.
- [x] Commit reconciliation precedes optimistic-version and transition checks.
- [x] New timer behavior uses an injectable seam and deterministic tests.
- [x] No migration already recorded by checksum is edited.
- [x] Existing user changes in the dirty worktree remain untouched.

## Boundary Map

- **S01 produces:** mandatory `AgentToolExecutionDeclaration`, extended
  `AgentToolExecutionContext`, structured execution error, and the internal
  ephemeral lifecycle coordinator used by `createAgent()`.
  **S02 consumes:** those executor frames and context values to drive durable
  Harness commits.
- **S02 produces:** ToolExecution snapshot/mutation/read interfaces, in-memory
  projection, successful transition invariants, and Harness coordinator flow.
  **S03 consumes:** the same Store contract to build SQL persistence without a
  second interface.
- **S03 produces:** migration `0005`, PostgreSQL mapping, and cross-instance
  successful-path contract.
  **S04, S07, and S08 consume:** the schema, scoped queries, and atomic mutation
  machinery.
- **S04 produces:** proposal rejection reason codes and zero-Attempt invariant.
  **S09 consumes:** compatibility and protocol documentation.
- **S05 produces:** effect-outcome classifier and sanitized structured error
  mapping.
  **S06 and S07 consume:** conservative terminal decisions and retry metadata.
- **S06 produces:** deadline/cancellation coordinator behavior and terminal
  outcome rules.
  **S09 consumes:** final lifecycle and regression coverage.
- **S07 produces:** duplicate-safe Attempt/transition Commit invariants and
  PostgreSQL rollback evidence.
  **S09 consumes:** final reliability claims.
- **S08 produces:** scoped ToolExecution cursor codec, Harness read surface, and
  public event correlation contract.
  **S09 consumes:** documented public protocol and final export verification.
- **S09 produces:** verified A3 implementation, operational commands, updated
  architecture status, and the explicit handoff to A4 persistent approval.

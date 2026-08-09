# M004: Agent Core A4c External-Effect Reconciliation

## Vision

Turn A4b's conservative `unknown + unknown` quarantine for reversible and
external effects into an explicit, authorized, auditable human-in-the-loop
workflow. A4c records a scoped reconciliation case, permits only explicit
read-only external inspection, accepts an idempotent human resolution, and lets
a fenced Recovery Worker continue the existing Run without repeating the
original side effect.

Source design:
`docs/architecture/agent-core-phase-a4c-external-effect-reconciliation-design.md`.

## Success Criteria

- Every A4b reconciliation wait has exactly one scoped, durable Case while its
  original ToolExecution and Attempt remain `unknown + unknown`.
- Explicit inspection stores only bounded safe evidence; no Worker automatically
  reads, retries, compensates, or writes an external system.
- A Resolution is first-writer-wins, idempotent, auditable, and lease-free at
  the business-service decision boundary.
- Only a compatible Worker with the current fence consumes a resolved Case,
  writes exactly one sanitized ToolResult, and resumes the model loop.
- Cancelled, foreign-scoped, inconclusive, stale, or already-consumed Cases
  cannot resume a Run or repeat the original side effect.
- In-memory and PostgreSQL adapters enforce equivalent Case, inspection,
  Resolution, cancellation, lease, rollback, and recovery invariants.

## Key Risks

- A Resolution could race with cancellation, a stale Worker, or duplicate
  consumption and append more than one ToolResult.
- Treating a keyed idempotency value as external proof could turn investigation
  into an unsafe automatic retry.
- Public Case/Observation APIs could leak raw arguments, correlation values,
  credentials, original external responses, or lease tokens.
- A broad Recovery Worker claim could resume unresolved Cases or cases from an
  incompatible runtime configuration.
- PostgreSQL transaction failures could expose a Resolution without a matching
  Case transition, checkpoint, event, or Outbox boundary.

## Slices

- [ ] **S01: Durable reconciliation Case and scoped read** `risk:high` `depends:[]`
  > After this: an orphaned external Attempt atomically creates one immutable-reference Case in memory, and a foreign scope cannot read it.
- [ ] **S02: Explicit read-only inspection and safe Observation** `risk:high` `depends:[S01]`
  > After this: a caller can explicitly inspect a Case through its registered read-only adapter and page bounded applied/not-applied/inconclusive/failed evidence without changing the Run.
- [ ] **S03: Resolution compare-and-set and cancellation** `risk:high` `depends:[S01]`
  > After this: an authorized caller can submit one replay-safe human Resolution, while cancellation prevents later consumption without deleting the Case audit record.
- [ ] **S04: Fenced Resolution consumption and model continuation** `risk:high` `depends:[S02,S03]`
  > After this: a Worker claims only a resolved Case, consumes it once behind its current fence, appends the prescribed sanitized ToolResult, and re-enters the ordinary model/approval loop with no original-tool retry.
- [ ] **S05: PostgreSQL 0008 and cross-instance reconciliation** `risk:high` `depends:[S02,S03,S04]`
  > After this: migration 0008 persists Case, Observation, and Resolution state; separate instances prove scope, idempotency, stale-fence rejection, and transaction rollback.
- [ ] **S06: Process recovery, operations, and integration** `risk:medium` `depends:[S04,S05]`
  > After this: a process may exit after a Resolution is written and a compatible Worker consumes it exactly once; exports, operations, documentation, and full repository verification agree.

## Proof Strategy

First establish the Case as the durable, scoped fact created at the A4b
quarantine boundary. Add explicit inspection separately so evidence never has
implicit execution authority. Prove decision idempotency and cancellation before
any Worker may consume a decision. Then connect the resolved Case to the
existing fenced recovery driver and assert the original ToolExecution remains
historically unknown. Reproduce the full contract in PostgreSQL before testing a
real process exit between decision and consumption.

No slice is complete from a type, schema, or mock alone. Each must provide an
observable path through `createAgentHarness()`, `AgentRuntimeStore`,
`createAgentRecoveryWorker()`, or the real PostgreSQL process contract named in
its demo line.

## Verification Classes

- **Case lifecycle:** creation at orphan quarantine, scoped reads, terminal
  immutability of the original Ledger, cancellation, and pagination.
- **Inspection boundary:** explicit-only invocation, normalized outcome,
  bounded presentation, no automatic Run state change, and safe failures.
- **Resolution contract:** actor scope, first-writer-wins, replay, competing
  decision, cancellation race, and exactly-once consumption.
- **Recovery:** compatible configuration claim, current-fence commit,
  sanitized result, model continuation, approval re-entry, and no original
  external invocation.
- **PostgreSQL:** repeatable 0008 migration, cross-instance Observation and
  Resolution, stale fencing, conflict, rollback, ambiguity reconciliation, and
  public-data isolation.
- **Process integration:** terminate the owner after Resolution persistence;
  a second Worker consumes once without an external retry.
- **Repository regression:** Agent and root test, typecheck, build, lint,
  format check, `git diff --check`, public exports, migration status, and
  dedicated PostgreSQL suite.

## Definition of Done

- All six slices are complete and their demo lines are reproducible.
- One unknown reversible/external Attempt has at most one Case and the original
  Attempt/ToolExecution is never rewritten as applied or not applied.
- Inspection remains explicit, read-only, scoped, and safe to repeat.
- Resolution persistence is first-writer-wins and never itself executes a tool
  or appends a Run lifecycle event.
- A resolved Case is consumed once by the current fence, restores ordinary Run
  progress, and cannot bypass the current Approval Policy for later calls.
- Unresolved and cancelled Cases remain excluded from recovery claims.
- Migration 0008 is forward-only, checksummed, repeatable, and leaves
  0001–0007 untouched.
- No raw arguments, idempotency/correlation values, credentials, raw adapter
  responses, lease tokens, or raw errors reach public data or logs.
- Full repository, PostgreSQL, and process-exit verification pass.

## Requirement Coverage

| Requirement                                            | Slices |
| ------------------------------------------------------ | ------ |
| Case creation, scope, and immutable Ledger history     | S01    |
| Explicit adapter inspection and safe evidence          | S02    |
| Human decision idempotency and cancellation            | S03    |
| Fenced consumption, ToolResult, and model continuation | S04    |
| PostgreSQL storage, races, and rollback                | S05    |
| Real restart, exports, operations, and documentation   | S06    |

## Horizontal Checklist

- [ ] Every Case, Observation, Resolution, and query carries complete
      Tenant/Project/Task/Run/ToolExecution/Attempt scope.
- [ ] Original unknown ToolExecution and Attempt history stays immutable.
- [ ] Only an explicit business-service request invokes an inspection adapter.
- [ ] Resolution decision is lease-free; Resolution consumption is fenced.
- [ ] Unresolved, cancelled, foreign, stale, and mismatched-config Cases never
      resume a Run.
- [ ] Case/Observation events, Outbox, errors, and pages expose only safe data.
- [ ] Timers, clocks, IDs, adapter fixtures, and process fixtures are
      deterministic in tests.
- [ ] No applied migration is edited or deleted.
- [ ] Existing user changes in the worktree remain untouched.

## Boundary Map

- **S01 produces:** Case snapshots, mutations, scoped Store reads, in-memory
  projection, and A4b quarantine creation. **S02 and S03 consume:** the exact
  scoped Case identity and immutable unknown Ledger reference.
- **S02 produces:** registered inspection adapter contract, safe Observation
  projection, and explicit inspect command. **S04 and S05 consume:** the
  evidence/audit boundary without granting execution authority.
- **S03 produces:** Resolution snapshot, decision receipt, cancellation rule,
  and resolved Case state. **S04 and S05 consume:** its idempotent
  first-writer-wins boundary.
- **S04 produces:** `consume_reconciliation` RecoveryPlan, resolved-only claim
  eligibility, fenced consumption commit, controlled ToolResult, and model
  continuation. **S05 and S06 consume:** this complete in-memory lifecycle.
- **S05 produces:** migration 0008, PostgreSQL mappings, cross-instance and
  rollback evidence. **S06 consumes:** the durable reconciliation substrate.
- **S06 produces:** process-exit proof, public exports, operations, and updated
  status documentation; it hands off to the stage-A budget milestone.

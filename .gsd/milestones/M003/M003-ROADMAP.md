# M003: Agent Core A4b Restart Recovery

## Vision

Give every active durable Run one fenced execution owner and let a compatible
Harness Recovery Worker continue the Run after process loss or explicit
handoff. Resume only from durable checkpoints, never replay completed model
Turns, retry only side-effect-free orphan Attempts, and quarantine uncertain
external effects for A4c.

Source design:
`docs/architecture/agent-core-phase-a4b-restart-recovery-design.md`.

## Success Criteria

- Every active durable Run has one expiring execution lease and monotonic
  fencing token.
- An expired owner cannot commit after another owner claims the Run.
- Recovery uses checkpoint schema v3 and a deterministic, side-effect-free
  RecoveryPlan.
- Completed model Turns are never sampled again; only an interrupted current
  Turn may be reissued.
- Prepared tools and approval waits resume without duplicate Approval,
  ToolExecution, Attempt, checkpoint, event, Outbox, or receipt state.
- Orphaned `sideEffect: none` Attempts may create Attempt N+1 under the same
  ToolExecution.
- Orphaned reversible or external Attempts are never automatically retried and
  enter `waiting_for_reconciliation` for A4c.
- Explicit handoff preserves the Run while existing Harness disposal continues
  to mean cancellation.
- In-memory and PostgreSQL adapters enforce the same lease, fencing, recovery,
  and rollback invariants.
- A real child-process termination test proves restart recovery and Provider
  invocation counts prove completed Turns are not replayed.

## Key Risks

- A lease without fencing would let a stalled old process overwrite the new
  owner after it wakes.
- Claiming a Run before validating configuration or checkpoint compatibility
  could resume it with different model, prompt, tools, or policy.
- Reusing `runAgentLoop()` from the beginning could duplicate user input,
  `run_start`, Turn rows, model tokens, or completed tool calls.
- Persisted partial model deltas can become ambiguous without model-attempt
  correlation when an interrupted Turn is sampled again.
- Treating keyed idempotency as proof of external outcome could duplicate an
  irreversible side effect.
- Lease heartbeat writes can conflict with Task versions or flood audit/event
  storage if they share the aggregate transaction path.
- Approval decisions may advance Task version while no executor owns the Run;
  the recovered owner must refresh before consuming.
- Handoff can accidentally preserve the old cancellation semantics and turn a
  deploy into a business cancellation.
- PostgreSQL process tests can become slow or flaky unless clocks, lease
  duration, child lifecycle, and faux Providers are deterministic.
- Lease tokens, idempotency keys, raw arguments, or recovery causes can leak
  through public events or operational logs.

## Slices

- [x] **S01: In-memory Run lease and fencing contract** `risk:high` `depends:[]`
  > After this: one Store Run can be claimed, renewed, released, and reclaimed after expiry, while stale lease/fencing guards cannot commit or partially mutate durable state.
- [x] **S02: Initial durable ownership and heartbeat** `risk:high` `depends:[S01]`
  > After this: every new durable Harness Task holds and renews a Run lease, ownership loss aborts local work without a fake terminal state, and ephemeral Harness behavior remains compatible.
- [x] **S03: Checkpoint v3 and deterministic RecoveryPlan** `risk:high` `depends:[S01]`
  > After this: explicit model/tool/approval/finalize/reconciliation resume data maps complete recovery snapshots to one pure plan, while incompatible or contradictory state blocks instead of guessing.
- [x] **S04: Model-boundary resume without completed-Turn replay** `risk:high` `depends:[S02,S03]`
  > After this: a recovered Run continues event and Turn ordering from the last durable sequence, completed model Turns cause zero additional Provider calls, and only one interrupted Turn gains a new model-attempt identity.
- [x] **S05: Ordered tool-boundary recovery** `risk:high` `depends:[S03,S04]`
  > After this: recovery reconstructs proposal order, skips completed ToolExecutions, refreshes a prepared execution with stable identity/key, and starts only the next unfinished Attempt.
- [x] **S06: Persistent Approval recovery** `risk:high` `depends:[S03,S04,S05]`
  > After this: pending Approval resumes waiting/expiry, terminal unconsumed Approval is consumed once, and decided/consumed state never repeats model or tool work.
- [x] **S07: Conservative orphan Attempt policy** `risk:high` `depends:[S01,S05]`
  > After this: a lost running side-effect-free Attempt closes and creates Attempt N+1, while reversible/external Attempts become unknown and move the Run to reconciliation wait without invocation.
- [x] **S08: Recovery Worker, backoff, and explicit handoff** `risk:high` `depends:[S02,S03,S04,S05,S06,S07]`
  > After this: an explicit bounded Worker continuously claims compatible Runs with concurrency/backoff, `recoverOnce()` is deterministic, `handoff()` transfers ownership, and `dispose()` still cancels.
- [x] **S09: PostgreSQL 0007 and competing Worker recovery** `risk:high` `depends:[S01,S03,S08]`
  > After this: migration 0007 persists lease/audit/recovery state, database-time `SKIP LOCKED` claims have one winner, and transaction failure or stale fencing cannot expose partial state.
- [x] **S10: Real process restart, operations, and integration** `risk:high` `depends:[S04,S06,S07,S09]`
  > After this: a faux-Provider child process is killed without disposal and a compatible Worker completes the same Run after lease expiry, with token-saving invocation proof, full A1–A4b regressions, exports, migration operations, and documentation verified.

## Proof Strategy

Establish the Store-owned lease and fencing invariant before changing the live
executor. Then give new durable Tasks ownership and heartbeat behavior without
adding recovery. Introduce checkpoint v3 and prove recovery classification as a
pure function before allowing any Provider or tool call. Resume model, tool,
and Approval boundaries in that order, because each later boundary consumes the
earlier active-Run driver. Attack orphan Attempts only after safe prepared-tool
re-entry is observable. Add the continuous Worker and handoff over the complete
in-memory behavior, then reproduce the same semantics in PostgreSQL. Finish
with an actual killed child process and full repository verification.

No slice is complete through interfaces, migrations, or planner output alone.
Each slice must demonstrate its after-state through `AgentRuntimeStore`,
`createAgentHarness()`, `createAgentRecoveryWorker()`, or the real PostgreSQL
process contract named in its demo line.

## Verification Classes

- **Pure recovery planner:** exhaustive immutable snapshot matrix with no Store,
  Provider, timer, or tool side effects.
- **Common Store contract:** identical claim, renew, release, expiry, fencing,
  audit, idempotency, rollback, and scope behavior for in-memory and PostgreSQL
  adapters.
- **Harness behavior:** initial lease, heartbeat, ownership loss, event cursor,
  completed-Turn reuse, ToolExecution ordering, Approval continuation, and
  `handoff()`/`dispose()` distinction.
- **Recovery Worker:** bounded batch, configuration filtering, concurrency,
  backoff, blocked state, and no hot-loop claims through injected clocks and
  timers.
- **PostgreSQL integration:** migration 0007, database time, `SKIP LOCKED`,
  fencing races, ambiguous renewal/claim, atomic rollback, and multi-Worker
  ownership.
- **Real process restart:** isolated PostgreSQL plus a deterministic child
  process terminated without cleanup, followed by recovery in another process.
- **Token conservation:** faux Provider invocation counts and checkpoint/event
  assertions prove completed Turns are not sampled again.
- **Security and isolation:** full Tenant/Project/Task/Run scope, foreign-scope
  invisibility, and no lease token, idempotency key, raw argument, credential,
  or raw cause in public surfaces.
- **Repository regression:** Agent and root tests, typecheck, build, lint,
  format check, `git diff --check`, public export smoke test, status inspection,
  and real PostgreSQL suite.

## Definition of Done

- All ten slices are complete and their demo lines are reproducible.
- Every new active durable Run owns a lease from acceptance through terminal,
  handoff, or ownership loss.
- Lease renewal never changes Task version or appends public event/Outbox noise.
- Every execution-owned state commit validates the current lease and fencing
  token in the same transaction.
- No old owner can commit after a reclaim, including after ambiguous network
  outcomes or process stalls.
- RecoveryPlan is deterministic and never calls a Provider, tool, or Store.
- Completed model Turns and completed ToolExecutions are never repeated.
- Only side-effect-free orphan Attempts can automatically create Attempt N+1.
- Reversible/external orphan Attempts always stop at
  `waiting_for_reconciliation`; A4b performs no external lookup or retry.
- Approval decisions and consumption remain first-writer-wins and idempotent
  across process loss.
- `handoff()` preserves non-terminal durable work and `dispose()` keeps the
  established cancellation contract.
- Migration application is repeatable, checksummed, and does not edit 0001–0006.
- Public root and PostgreSQL subpath exports expose only documented contracts.
- Full repository, real PostgreSQL, and real process-exit verification pass
  after the final change.
- Status documentation distinguishes completed A4b restart recovery from
  pending A4c external-effect reconciliation.

## Requirement Coverage

| Requirement                                                  | Slices      |
| ------------------------------------------------------------ | ----------- |
| Run lease lifecycle, expiry, reclaim, and fencing            | S01, S02    |
| Checkpoint v3, compatibility, and pure recovery planning     | S03         |
| Model resume, event continuity, and token conservation       | S04         |
| Ordered ToolExecution and prepared-state recovery            | S05         |
| Pending/decided/consumed Approval recovery                   | S06         |
| Safe retry versus reconciliation quarantine                  | S07         |
| Continuous Worker, backoff, ownership loss, and handoff      | S08         |
| PostgreSQL schema, database-time claims, races, and rollback | S09         |
| Actual process restart, operations, exports, and docs        | S10         |
| A1–A4a compatibility                                         | S02,S08,S10 |

## Horizontal Checklist

- [x] Every execution-owned write is fenced; external Approval decisions remain
      intentionally lease-free.
- [x] Lease renewal does not increment Task version or append Run events.
- [x] Store database time, not Worker wall-clock time, decides PostgreSQL lease
      expiry.
- [x] One configuration fingerprint never claims another fingerprint's Run.
- [x] Resume never duplicates input, `run_start`, Turn rows, completed model
      Turns, completed tools, or consumed Approvals.
- [x] Model-attempt identity disambiguates immutable partial stream events.
- [x] ToolExecution identity and keyed idempotency value remain stable across a
      safe retry; Attempt identity and number do not.
- [x] Reversible/external orphan Attempts are never automatically retried.
- [x] Tenant/Project/Task/Run scope is present on lease, recovery, audit, and
      every resumed state operation.
- [x] Lease tokens, idempotency keys, raw arguments, credentials, and raw causes
      never enter public events, Outbox payloads, snapshots, or logs.
- [x] Timers, clocks, IDs, backoff, and process fixtures are deterministic in
      tests.
- [x] No migration already recorded by checksum is edited.
- [x] Existing user changes in the dirty worktree remain untouched.

## Boundary Map

- **S01 produces:** execution lease/guard snapshots, claim-renew-release Store
  commands, fencing validation, recovery audit primitives, and in-memory
  contract behavior.
  **S02, S07, S08, and S09 consume:** the single-owner invariant.
- **S02 produces:** initial durable lease acquisition, heartbeat coordinator,
  ownership-loss signal, lease-aware commit path, and compatible ephemeral
  behavior.
  **S04 and S08 consume:** the active-owner driver and lifecycle distinction.
- **S03 produces:** checkpoint schema v3, resume-state contract, immutable
  recovery snapshot, compatibility checks, and pure RecoveryPlan.
  **S04, S05, S06, S08, and S09 consume:** deterministic next-action data.
- **S04 produces:** resumable active-Run driver, durable sequence offset,
  model-attempt correlation, Turn re-entry, and completed-Turn reuse.
  **S05, S06, S08, and S10 consume:** the resumed execution loop.
- **S05 produces:** proposal-order reconstruction, completed execution skipping,
  prepared-state refresh, and next-Attempt entry.
  **S06, S07, S08, and S10 consume:** safe tool continuation.
- **S06 produces:** restart-safe Approval wait, expiry, terminal consumption,
  Task-version refresh, and exactly-once continuation.
  **S08, S09, and S10 consume:** complete non-side-effecting recovery behavior.
- **S07 produces:** orphan Attempt close/reprepare mutation, Attempt N+1 rule,
  unknown external quarantine, reconciliation status/checkpoint/event, and
  A4c handoff boundary.
  **S08, S09, and S10 consume:** conservative owner-loss classification.
- **S08 produces:** public Recovery Worker, bounded scan loop, concurrency,
  retry/backoff, blocked disposition, Harness handoff, and disposal semantics.
  **S09 and S10 consume:** production orchestration behavior.
- **S09 produces:** migration 0007, PostgreSQL lease/audit projection,
  database-time claim/renew/release, `SKIP LOCKED`, fencing races, and rollback
  evidence.
  **S10 consumes:** the real restart substrate.
- **S10 produces:** verified A4b implementation, child-process restart proof,
  token-conservation evidence, operational commands, updated architecture
  status, and explicit handoff to A4c reconciliation.

# M002: Agent Core A4a Persistent Approval

## Vision

Make approval a durable Harness boundary between a model-proposed tool call and
its first external Attempt. Agent logic supplies an explicit, versioned policy;
the Harness persists, exposes, resolves, consumes, and audits the decision
without inferring business policy from a tool's side-effect declaration.

Source design:
`docs/architecture/agent-core-phase-a4a-persistent-approval-design.md`.

## Success Criteria

- Agent logic explicitly returns allow, deny, or require-approval decisions.
- Approval policy identity and version participate in checkpoint compatibility.
- A required approval durably suspends a Run before any Attempt is created.
- Approval decisions are scoped, idempotent, first-writer-wins, and auditable.
- Same-instance and cross-instance decisions wake the live Harness safely.
- Approved execution enters the existing A3 Ledger exactly once.
- Denied and expired requests execute no tool and return a generic ToolResult so
  the model may continue the Run.
- Approval presentation and public events never expose raw tool arguments.
- In-memory and PostgreSQL adapters enforce the same lifecycle invariants.

## Key Risks

- Treating side-effect metadata as approval policy would move Agent logic into
  the Harness and make future policies impossible to version independently.
- A crash or race between durable decision and local consumption could execute a
  tool twice or leave a Run permanently suspended.
- Concurrent approvers, expiry, cancellation, and retries could produce multiple
  terminal decisions unless the Store owns the compare-and-set boundary.
- Adding a new pre-Attempt state could regress the A3 guarantee that invocation
  never starts before a durable running Attempt.
- Raw model arguments or policy internals could leak through approval
  presentation, events, errors, or audit records.
- Cross-instance notification can conflict with Run event sequencing if the
  deciding instance attempts to append lifecycle events for the executing Run.

## Slices

- [x] **S01: ApprovalPolicy compatibility and fingerprint** `risk:high` `depends:[]`
  > After this: an explicit allow policy preserves the existing A3 execution path, while policy identity and version change the Harness checkpoint config fingerprint.
- [x] **S02: Fail-closed policy denial** `risk:high` `depends:[S01]`
  > After this: an immediate policy denial creates no Approval and no Attempt, returns a generic ToolResult to the model, and policy evaluation failures terminate the Task safely.
- [x] **S03: Durable in-memory approval request** `risk:high` `depends:[S01]`
  > After this: require-approval atomically persists a pending Approval with checkpoint, Task state, event, and Outbox data while the Run waits with zero Attempts.
- [x] **S04: Same-instance approval and resume** `risk:high` `depends:[S03]`
  > After this: an approved decision wakes the waiting Harness, consumes the Approval once, and enters the existing A3 invocation lifecycle exactly once.
- [x] **S05: Denial, expiry, and cancellation** `risk:high` `depends:[S03,S04]`
  > After this: denied and expired requests produce zero-Attempt terminal outcomes and let the model continue, while cancellation closes the wait without invoking the tool.
- [x] **S06: Decision idempotency and races** `risk:high` `depends:[S03]`
  > After this: decisionId replay, mismatched replay, concurrent decisions, expiry races, and repeated consumption have deterministic first-writer-wins behavior.
- [x] **S07: Scoped approval reads and safe events** `risk:medium` `depends:[S03]`
  > After this: callers page Approval snapshots within their scope and observe bounded presentation and sanitized lifecycle events without raw arguments.
- [x] **S08: PostgreSQL and cross-instance wake-up** `risk:high` `depends:[S04,S06]`
  > After this: migration 0006 persists the approval lifecycle and a decision written by Harness B is polled, consumed, and resumed by live Harness A.
- [x] **S09: PostgreSQL atomicity and reconciliation** `risk:high` `depends:[S05,S08]`
  > After this: transaction failures, ambiguous commits, and retries cannot partially expose or duplicate Approval, Ledger, checkpoint, event, Outbox, or receipt state.
- [x] **S10: Integration, operations, and documentation** `risk:low` `depends:[S02,S05,S07,S09]`
  > After this: memory and real-PostgreSQL approval flows, A1-A4a regressions, exports, migration operations, and architecture status are fully verified and documented.

## Proof Strategy

Start at the policy/executor seam to prove that approval is explicit Agent logic
and that an allow decision is behaviorally compatible with A3. Next prove one
complete durable wait-and-resume path in memory before expanding terminal and
concurrent outcomes. Exercise decision races before relying on them for
cross-instance PostgreSQL wake-up. Finish by attacking partial-write and
ambiguous-commit behavior, then run complete repository verification.

No slice is complete through interfaces or schema alone. Each slice must expose
an observable path through `createAgentHarness()`, `AgentRuntimeStore`, or the
real PostgreSQL Harness contract named in its demo line.

## Verification Classes

- **Policy compatibility:** deterministic allow/deny/require decisions through
  `createAgentHarness()` with A3 transcript and Ledger assertions.
- **Harness behavior:** waiting Task state, live result/event continuity,
  checkpoint compatibility, wake-up, cancellation, and model continuation.
- **Common Store contract:** identical lifecycle, scoping, idempotency,
  compare-and-set, expiry, consumption, and rollback assertions for memory and
  PostgreSQL adapters.
- **PostgreSQL integration:** real migration, constraints, cross-Harness
  decisions, polling, atomic commit, ambiguity reconciliation, and restart-safe
  durable state.
- **Security and isolation:** foreign scope, malformed cursor, bounded
  presentation, sanitized error/event, and no-raw-argument assertions.
- **Repository regression:** Agent and root tests, typecheck, build, lint, format
  check, `git diff --check`, and status inspection.

## Definition of Done

- All ten slices are complete and their demo lines are reproducible.
- ApprovalPolicy is explicit, versioned, and included in config compatibility.
- No required, denied, expired, or cancelled approval creates a tool Attempt.
- An approved ToolExecution creates exactly one first Attempt before invocation.
- Durable decision and local lifecycle-event ownership do not violate Run event
  sequencing across instances.
- Decision and consumption retries are idempotent in memory and PostgreSQL.
- Migration application is repeatable and every applied checksum is stable.
- Public exports contain only documented policy, Approval, Harness, and Store
  contracts.
- Full repository and real PostgreSQL verification pass after the final change.
- Agent status documentation distinguishes completed A4a approval from pending
  A4b recovery and A4c external reconciliation.

## Requirement Coverage

| Requirement                                           | Slices |
| ----------------------------------------------------- | ------ |
| Explicit policy contract and checkpoint fingerprint   | S01    |
| Fail-closed policy evaluation and immediate denial    | S02    |
| Durable pre-Attempt wait state                        | S03    |
| Same-instance approval consumption and execution      | S04    |
| Denial, expiry, cancellation, and model continuation  | S05    |
| Idempotency, compare-and-set, and race handling       | S06    |
| Scoped reads, bounded presentation, and safe events   | S07    |
| PostgreSQL schema and cross-instance polling          | S08    |
| Atomicity, ambiguity, rollback, and reconciliation    | S09    |
| Compatibility, operations, exports, and documentation | S10    |

## Horizontal Checklist

- [x] Tenant, Project, Task, Run, Turn, ToolExecution, and Approval scope is
      validated on every applicable write and query.
- [x] Raw arguments, credentials, idempotency keys, and raw policy causes never
      enter approval presentation or public events.
- [x] Policy ID and version, but not process identity, participate in the config
      fingerprint.
- [x] One ToolExecution has at most one Approval and one Run has at most one
      pending Approval.
- [x] The Store, not a process-local waiter, decides concurrent terminal state.
- [x] The deciding instance does not append Run lifecycle events owned by the
      executing Harness.
- [x] Expiry uses the injected clock and `now >= expiresAt` semantics.
- [x] Polling uses an injectable timer and deterministic tests.
- [x] No migration already recorded by checksum is edited.
- [x] Existing user changes in the dirty worktree remain untouched.

## Boundary Map

- **S01 produces:** public ApprovalPolicy decision contract, policy composition
  seam, and policy-aware checkpoint fingerprint.
  **S02 and S03 consume:** the decision without re-inferring policy in Harness.
- **S02 produces:** fail-closed evaluation and zero-Attempt immediate-denial
  behavior.
  **S10 consumes:** compatibility and operational documentation.
- **S03 produces:** Approval snapshot/mutation primitives, pending lifecycle, and
  atomic in-memory wait boundary.
  **S04, S05, S06, and S07 consume:** the same lifecycle and projection.
- **S04 produces:** decision API, waiter coordination, approval consumption, and
  exact-once handoff into A3.
  **S08 consumes:** the wake-up and consumption protocol across instances.
- **S05 produces:** denied, expired, and cancelled terminal semantics plus model
  continuation behavior.
  **S09 consumes:** all terminal mutations in PostgreSQL atomicity tests.
- **S06 produces:** decisionId replay rules, compare-and-set invariants, expiry
  race semantics, and consumption idempotency.
  **S08 and S09 consume:** those invariants across processes and retries.
- **S07 produces:** scoped cursor reads, bounded approval presentation, and
  sanitized public event contracts.
  **S10 consumes:** public API and protocol documentation.
- **S08 produces:** migration `0006`, PostgreSQL mappings, polling waiter, and
  cross-instance approval proof.
  **S09 consumes:** the schema and durable transitions for failure injection.
- **S09 produces:** duplicate-safe approval/Ledger commit reconciliation and
  PostgreSQL rollback evidence.
  **S10 consumes:** final reliability claims.
- **S10 produces:** verified A4a implementation, operations, exports, updated
  architecture status, and explicit handoff to A4b recovery.

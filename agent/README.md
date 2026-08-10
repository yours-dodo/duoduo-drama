# @duoduo/agent

`@duoduo/agent` is the NestJS Agent host and infrastructure adapter. The
framework-neutral Agent Core is published as `@duoduo/agent-runtime`.
The implemented runtime includes A1–A4a, A4b S01–S10, and A4c external-effect
reconciliation:

- a stateless model/tool executor and the stateful `createAgent()` compatibility
  facade;
- `createAgentHarness()` with isolated Task, Run, Turn, ToolExecution, Attempt,
  Approval, Event, and Commit identities;
- an asynchronous `AgentRuntimeStore` with in-memory and PostgreSQL adapters;
- atomic projections, append-only checkpoints and transitions, durable events,
  Outbox rows, optimistic versions, and idempotent Commit receipts;
- a ToolExecutionLedger that records preparation, Attempts, deadlines,
  cancellation, terminal outcomes, and conservative `unknown` effects;
- explicit, versioned Agent-logic approval policy with durable wait, decision,
  expiry, cancellation, cross-instance polling, and exactly-once consumption;
- scope-bound event, ToolExecution, and Approval paging with opaque cursors and
  sanitized public payloads;
- an in-memory Run lease/fencing contract plus initial ownership, configurable
  heartbeat, and ownership-loss handling for lease-capable durable Stores.
- checkpoint v3 model/tool/approval/finalize/reconciliation cursors, fenced
  immutable recovery snapshots, and a pure deterministic RecoveryPlan that
  blocks incompatible or contradictory state.
- a shared model-boundary resume driver that continues durable event sequence,
  reuses completed Turns, and correlates a replacement model Attempt only for
  an interrupted Turn.
- ordered tool-boundary recovery that reconstructs assistant proposal order,
  rejects Ledger mismatches before mutation, skips the terminal prefix, and
  re-enters only the first prepared ToolExecution with its stable identity and
  idempotency key behind the current fence.
- persistent Approval recovery that restores pending polling and expiry,
  refreshes cross-instance decisions before consumption, consumes terminal
  decisions once, and continues approved or rejected tool paths without
  recreating the Approval or repeating consumed work.
- conservative orphan-Attempt recovery that closes lost side-effect-free work
  as `unknown + not_applied` before Attempt N+1, while reversible or external
  work becomes `unknown + unknown` and atomically enters reconciliation wait
  with a sanitized event, Outbox row, and recovery audit record.
- scope-bound external-effect reconciliation: a durable Case, append-only
  safe Observations, first-writer-wins Resolution, cancellation, and exactly
  once fenced consumption into a generic ToolResult without rewriting the
  original unknown ToolExecution or Attempt.
- `createAgentRecoveryWorker()` with bounded configuration-filtered scans,
  deterministic `recoverOnce()`, limited concurrency, heartbeat, transient
  backoff, structural blocking, and ownership-preserving disposal; explicit
  Harness `handoff()` releases durable Runs without changing `dispose()`
  cancellation semantics.
- PostgreSQL migrations 0007 and 0008 with database-time leases, monotonic
  fencing, `SKIP LOCKED` competition, append-only recovery and reconciliation
  audits, checkpoint v3 resume state, idempotent lease operations, and atomic
  orphan-Attempt recovery.

The Agent Runtime consumes Provider-neutral APIs from `@duoduo/ai`. Provider wire
protocols and credentials remain owned by `packages/ai`; authentication,
product authorization, and canonical project data remain owned by the business
service.

## Runtime and protocol adapters

`@duoduo/agent-runtime` has no dependency on NestJS, Hono, PostgreSQL, or a
transport. NestJS hosts the Agent HTTP process, while future CLI and MCP
adapters can call the same runtime directly:

```text
NestJS HTTP ─┐
CLI          ├─> @duoduo/agent-runtime ─> @duoduo/ai
MCP          ┘
```

Tenant scope, authorization context, cancellation, and streaming are supplied
by each adapter. The Agent service's `agent/src/index.ts` remains a compatibility
facade; new shared runtime consumers should import `@duoduo/agent-runtime`
directly.

## Public entry points

Import the executor, Harness, policy contracts, snapshots, and Store port from
the package root. Import PostgreSQL infrastructure only from its dedicated
subpath:

```ts
import {
  createAgentHarness,
  createAgentRecoveryWorker,
  type AgentApprovalPolicy,
  type AgentRuntimeStore,
} from '@duoduo/agent';
import {
  createPostgresAgentRuntimeStore,
  getAgentRuntimeMigrationStatus,
  migrateAgentRuntime,
} from '@duoduo/agent/postgres';
```

The package root does not read environment variables or create infrastructure.
Composition code supplies Providers, credentials, Store, clock, timer, tools,
and policy explicitly.

Lease-capable durable Stores advertise `runLeaseSupport: 'v1'`. Stores that
can preserve explicit resume cursors advertise
`checkpointResumeSupport: 'v3'`. The Harness
then creates the initial fence atomically with Task acceptance, renews it with
the `runLease` duration and heartbeat settings, and fences every executor-owned
write. The in-memory and PostgreSQL adapters both advertise these capabilities.
PostgreSQL computes actual claim, renewal, expiry, and retry-availability
timestamps from database time; Worker timestamps express durations rather than
acting as the ownership authority.

Stores that persist reconciliation Cases advertise `reconciliationSupport:
'v1'`. Both bundled Stores support it. A resolved Case is the sole exception
to the normal exclusion of `waiting_for_reconciliation` Runs: a compatible
Worker may claim it under a new fence and consume its Resolution once.

## Persistent approval

Approval policy belongs to Agent logic. It runs after tool lookup, JSON parsing,
and Schema validation, but before preparation or creation of an Attempt. A
missing policy allows execution. A configured policy returns `allow`, `deny`,
or `require_approval`:

```ts
const approvalPolicy: AgentApprovalPolicy = {
  policyId: 'story-publication',
  version: 'v1',
  evaluate: ({ toolName }) =>
    toolName === 'publish_story'
      ? {
          decision: 'require_approval',
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          presentation: { title: 'Publish story' },
        }
      : { decision: 'allow' },
};
```

The policy may inspect validated arguments in memory, but it must project only
safe human-readable fields into `presentation`. Raw arguments, credentials,
idempotency keys, and raw failures must not enter approval persistence or public
events.

When approval is required, the Harness atomically records a pending Approval,
the waiting Task and Run, ToolExecution state, checkpoint, event, Outbox row,
and Commit receipt. No Attempt exists at this point. An authenticated business
service can read and decide the request through the scoped Harness contract:

```ts
const pending = await harness.readApprovals({
  tenantId,
  projectId,
  taskId,
  runId,
});

await harness.decideApproval({
  tenantId,
  projectId,
  taskId,
  runId,
  approvalId: pending.approvals[0]!.approvalId,
  decisionId,
  decision: 'approved',
  decidedBy: authenticatedActorId,
});
```

The business service must authenticate the actor, verify project permission,
and generate a stable decision ID before calling the Harness. The first valid
decision wins. Replaying identical decision content is idempotent; mismatched or
competing decisions return stable Approval errors. The executor that owns the
Run emits the decision event and consumes the Approval exactly once before the
existing ToolExecution Attempt lifecycle begins.

## External-effect reconciliation

When a reversible or external ToolExecution loses ownership during a real
Attempt, the Harness preserves the ledger as `unknown + unknown` and creates a
scoped ReconciliationCase. Restarting a Worker never repeats that original
tool call. An authenticated business service first reads the Case, may run a
tool-provided read-only inspection, and then records an authorized Resolution:

```ts
const cases = await harness.readReconciliationCases({
  tenantId,
  projectId,
  taskId,
  runId,
});
const reconciliationCase = cases[0]!;

await harness.inspectReconciliation({
  tenantId,
  projectId,
  taskId,
  runId,
  reconciliationCaseId: reconciliationCase.reconciliationCaseId,
});

await harness.decideReconciliation({
  tenantId,
  projectId,
  taskId,
  runId,
  reconciliationCaseId: reconciliationCase.reconciliationCaseId,
  resolutionId,
  resolution: 'confirmed_not_applied',
  resolvedBy: authenticatedActorId,
  reasonCode: 'EXTERNAL_EFFECT_NOT_FOUND',
});
```

The business service authenticates `resolvedBy`, authorizes the project scope,
and supplies a stable `resolutionId`. Inspection is opt-in and read-only; an
Observation never changes a Case by itself. The first valid Resolution wins,
and replaying its ID with identical content is safe. A compatible Worker then
claims the resolved Run and atomically records Case consumption, a sanitized
ToolResult, the event/Outbox boundary, and a checkpoint before the model can
continue. A cancellation preserves the Case and Observations for audit but
prevents consumption. Public snapshots, events, Observations, and errors never
include raw arguments, idempotency keys, correlation references, credentials,
or raw provider responses.

## PostgreSQL operations

The checked-in Compose service is an isolated local test database. Copy the
sanitized example configuration into an ignored local environment file or
export it in the shell:

```bash
docker compose -f agent/compose.postgres.test.yml up -d --wait
export AGENT_RUNTIME_DATABASE_URL='postgresql://duoduo_agent:duoduo_agent_test@127.0.0.1:55432/duoduo_agent_test'
export AGENT_TEST_POSTGRES_URL="$AGENT_RUNTIME_DATABASE_URL"
pnpm --filter @duoduo/agent db:migrate:status
pnpm --filter @duoduo/agent db:migrate
pnpm --filter @duoduo/agent test:postgres
```

Production rollout uses the same forward-only migration runner:

1. Back up the Agent Runtime database according to the deployment environment's
   normal policy.
2. Run `db:migrate:status`. Stop if it reports `checksum_mismatch` or
   `missing_file`.
3. Run `db:migrate` once before deploying code that depends on the new schema.
   Concurrent runners are safe because migration application holds a PostgreSQL
   advisory lock.
4. Run `db:migrate:status` again and require every migration to be `applied`.
5. Deploy the Agent service and run the real PostgreSQL contract suite against
   an isolated non-production database.

### Recovery Worker operations

Recovery scanning is an explicit deployment role. API-only processes may
create Harnesses without running a scanner, but every active runtime
configuration fingerprint needs at least one compatible Recovery Worker.

For rolling deployment, apply migrations through 0008 first, start Workers with the
same resolved model identity, system prompt, tool definitions, and Approval
Policy as the Runs they may recover, call `handoff()` on draining Harnesses,
wait for ownership release, and only then stop the old processes. A crash needs
no manual lease edit: database time expires the old owner and the next Worker
increments the fence. Never copy or rewrite lease tokens, fencing values, or
recovery-operation receipts by hand.

Operators should alert on expired or unowned Runs, repeated lease loss,
backoff saturation, `recovery_blocked`, and
`waiting_for_reconciliation`. A blocked Run requires a compatible deployment
or a reviewed state repair. Reconciliation wait requires an authorized A4c
business decision; restarting Workers must not retry the uncertain external
effect before that decision is durable.

Migrations are hand-written, transactional, checksummed, and forward-only.
Never edit or delete an applied migration; add the next numbered SQL migration.
There is no automatic down migration. Rollback means restoring the application
version only when it remains compatible with the applied schema, or restoring
the database through the environment's reviewed backup procedure.

Only the migration CLI reads `AGENT_RUNTIME_DATABASE_URL`. Runtime composition
constructs the PostgreSQL Store with an explicit connection string or managed
Pool. Normal tests skip PostgreSQL and use deterministic faux Providers. The
dedicated `test:postgres` command requires `AGENT_TEST_POSTGRES_URL` and fails
when it is absent.

## Verification

Run the Agent checks from the repository root:

```bash
pnpm --filter @duoduo/agent test
pnpm --filter @duoduo/agent typecheck
pnpm --filter @duoduo/agent build
pnpm --filter @duoduo/agent test:postgres
pnpm lint
pnpm format:check
```

The PostgreSQL suite covers repeatable migration, durable reload, cross-Harness
approval wake-up, decision ambiguity, atomic rollback, Ledger reconciliation,
checkpoint history, Outbox leases, observer overflow, competing recovery
Workers, stale fencing, lease-operation replay, recovery snapshots, and atomic
orphan-Attempt policy. It also starts two real Node.js processes, kills the
original owner with `SIGKILL`, waits for database-time expiry, and proves that
the second process continues the same Run without replaying its completed model
Turn. The external-effect scenario additionally proves quarantine, cross-process
Resolution consumption, and model continuation without replaying the external
tool.

## Runtime protocols and remaining scope

See [Agent Core runtime protocols](../docs/architecture/agent-core-runtime-protocols.md)
for isolation, Commit, checkpoint, Approval, Ledger, replay, Outbox, migration,
and failure semantics. See the
[A4a persistent approval design](../docs/architecture/agent-core-phase-a4a-persistent-approval-design.md)
for the approved state machine and security boundary.

A4b S01–S10 establish the shared lease/fencing contract, live Harness
ownership heartbeat, checkpoint v3, immutable recovery snapshots, and pure
recovery planning. Model-boundary plans can resume without replaying completed
Turns. Tool-boundary plans validate durable assistant-call order, skip completed
executions, and safely refresh/start one prepared execution. Approval recovery
restores pending waits, expires overdue requests under the current fence,
refreshes cross-instance decisions, and consumes terminal decisions exactly
once. Orphan Attempts retry only when the declaration proves no side effect;
reversible and external uncertainty is quarantined for reconciliation. The
Recovery Worker continuously claims exact-fingerprint Runs with bounded
concurrency, heartbeat and backoff; explicit handoff preserves non-terminal
work while normal disposal still cancels. A4c turns uncertain reversible or
external effects into scoped, auditable Cases: authorized services can record
safe Observations and an immutable Resolution, while Workers consume only
resolved Cases under the current fence. PostgreSQL migration 0008 persists the
same contract and proves cross-instance decisions, transaction rollback, and
real process-exit recovery without replaying the original external tool.
Context assembly, layered memory, knowledge retrieval, Artifact Runtime,
sandboxing, and Server integration are later phases. Do not describe the
production Agent platform as complete.

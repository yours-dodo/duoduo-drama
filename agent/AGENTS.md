# Agent Service Guidelines

## Current Status

The current implementation includes the NestJS host and framework-neutral `@duoduo/agent-runtime` package, the A1–A4a durable Agent Core foundation, the complete A4b S01–S10 restart-recovery milestone, and A4c external-effect reconciliation. `createAgent()` remains the compatibility facade, while `createAgentHarness()` exposes the production-oriented Task contract over a stateless executor. The Harness assigns scoped Task/Run/Turn/Event/Commit/ToolExecution/Attempt/Approval/ReconciliationCase IDs, isolates concurrent transcripts and cancellation, and commits projections, checkpoints, events, Outbox rows, ToolExecution, Approval, and ReconciliationCase state, Attempt history, transitions, and idempotent receipts through `AgentRuntimeStore`. Both in-memory and PostgreSQL Stores support Run lease claim, renewal, release, fencing, audit, checkpoint v3 resume cursors, and immutable fenced recovery snapshots; PostgreSQL migrations 0007/0008 use database time, `FOR UPDATE SKIP LOCKED`, monotonic fencing, idempotent lease-operation receipts, and atomic rollback. A lease-capable durable Harness obtains initial ownership, heartbeats it, fences executor writes, and stops locally without a fake terminal state after ownership loss. `planAgentRunRecovery()` validates compatibility and complete recovery projections before returning one deterministic next action or a controlled blocked plan. The shared active-Run driver can continue model work from a durable event sequence, reuse completed Turns without another Provider call, and re-enter only an interrupted Turn under a new correlated model Attempt. Tool-boundary recovery reconstructs and validates assistant proposal order against the scoped Ledger, skips completed executions, and uses a fenced `prepared -> prepared` refresh before starting exactly the first unfinished prepared Attempt while preserving ToolExecution identity and idempotency key. Approval recovery restores pending Store polling and expiry without model/tool replay, refreshes cross-instance decisions before its first consume commit, consumes terminal decisions once, and routes approved/rejected outcomes through the ordered continuation path. Orphan recovery atomically closes a lost side-effect-free Attempt as `unknown + not_applied` before Attempt N+1; reversible or external uncertainty becomes `unknown + unknown`, moves Task/Run to `waiting_for_reconciliation`, emits one sanitized event/Outbox row, and appends recovery audit. A4c atomically creates a scoped Case at that boundary, permits only explicit read-only inspection and an authorized first-writer-wins Resolution, then lets a compatible Worker claim and consume the resolved Case once under a new fence without rewriting the original unknown ledger or replaying the external tool. `createAgentRecoveryWorker()` adds configuration-filtered bounded scans, deterministic `recoverOnce()`, limited concurrency, lease heartbeat, transient backoff, structural blocking, and ownership-preserving disposal; `AgentHarness.handoff()` releases active durable Runs without fabricating cancellation, while `dispose()` retains its established cancellation contract. The PostgreSQL contract suite includes real owner processes terminated by `SIGKILL` and successor Workers proving database-time takeover, continuous event order, stable ToolExecution identity, no replay of a completed model Turn, and external-effect quarantine followed by post-resolution consumption. Session remains a caller-supplied scope reference rather than a persisted aggregate. Context assembly, layered memory, knowledge retrieval, Artifact Runtime, sandboxing, CLI, MCP, and Server integration remain later work; do not describe the production Agent platform as complete.

## Scope and Responsibilities

This project is the NestJS-based Agent host and infrastructure adapter. It owns application-level model selection and runtime composition, context assembly, prompt management, tool execution, Agent workflows, and Agent-owned infrastructure such as PostgreSQL. The framework-neutral execution and Harness implementation lives in `@duoduo/agent-runtime`; this project consumes it through public exports. It also consumes the provider-neutral `@duoduo/ai` runtime through its public exports.

`packages/ai` owns built-in Provider factories, vendor wire protocols, authentication primitives, transport policies, media-generation contracts, and the reusable AI runtime. Do not reimplement those boundaries in `agent/`, deep-import `packages/ai/src`, or add provider SDK behavior directly to workflows. Agent code may supply explicit configuration, credentials, policy, and application-specific adapters when composing `@duoduo/ai`.

The Agent service does not own user authorization, canonical project state, authoritative business persistence, or client-facing product APIs. Never import code from `apps/server`. Use explicit HTTP or task contracts to request Server-owned data and changes. Do not connect directly to the Server database or duplicate Server authorization rules inside Agent workflows.

Agent-specific resumable workflow state is owned by the Harness behind stable ports. Runtime persistence, queues, search indexes, object storage, and sandbox integrations are Harness capabilities; keep their concrete drivers in internal infrastructure adapters so the execution kernel never depends directly on a database, search engine, or sandbox product. Do not treat Agent checkpoints as the canonical copy of Server-owned business data.

## Structure

Create directories only when real code needs them. Use these boundaries as Agent capabilities grow:

- `src/config/` for Agent-owned environment parsing, model selection, and runtime configuration.
- `src/contracts/` for the Agent service's public HTTP or task request/response shapes.
- `@duoduo/agent-runtime` for the provider-neutral stateless executor, compatibility `createAgent()` facade, Agent event stream, tool loop, cancellation, lifecycle semantics, Harness contract, Store port, checkpoints, event envelopes, replay cursors, batching, and observer buffering.
- `src/` for the NestJS host, HTTP controllers, Agent-owned configuration, and composition of the runtime and infrastructure adapters.
- `src/tools/` for tool definitions and adapters to external capabilities.
- `src/workflows/` for task orchestration, state transitions, and checkpoint ports.
- `src/infrastructure/` for Harness-owned persistence, queue, search, object-storage, sandbox, cache, and external-service adapters after those technologies are selected.

Keep NestJS controllers thin. They should validate input, invoke a workflow or service, and map the result. Workflows must depend on Agent-owned ports rather than NestJS, database clients, queues, or one model vendor.

`@duoduo/agent-runtime` is the Agent Core public export surface. `agent/src/index.ts` remains a compatibility facade for the service package. `createAgent()` and `createAgentHarness()` each own the `AiRuntime` they create, register only explicitly supplied Providers, and resolve the configured model before returning. Keep Provider-specific factories, credentials, scopes, transport, and network policy explicit at the composition boundary; never import `@duoduo/ai/providers/all` from Agent Core.

## Commands

Run from the repository root:

- `pnpm --filter @duoduo/agent dev` — start NestJS on port 3002 by default; `PORT` may override it.
- `pnpm --filter @duoduo/agent typecheck` — type-check the Agent service.
- `pnpm --filter @duoduo/agent test` — run Agent tests.
- `pnpm --filter @duoduo/agent build` — compile production JavaScript.
- `pnpm --filter @duoduo/agent start` — run the compiled `dist/main.js` output.
- `pnpm --filter @duoduo/agent db:migrate` — apply forward-only Agent Runtime PostgreSQL migrations.
- `pnpm --filter @duoduo/agent db:migrate:status` — show applied, pending, or mismatched migrations.
- `pnpm --filter @duoduo/agent test:postgres` — require `AGENT_TEST_POSTGRES_URL` and run the real PostgreSQL contract suite.

Also run root `pnpm lint` and `pnpm format:check` before submitting changes.

## Testing, Safety, and Failures

Co-locate tests as `*.test.ts`. Test tool input validation, workflow transitions, provider error mapping, timeouts, cancellation, persistence/checkpoint behavior, and retry decisions. Mock model and external-service boundaries; tests must not make paid or nondeterministic model calls by default. Use the dedicated `@duoduo/ai` live harness only when an explicitly approved integration test requires a real Provider.

Treat prompts, model outputs, uploaded content, and tool results as untrusted input. Never log credentials or full sensitive user content. Mutating tools must have explicit authorization context and auditable inputs before they are connected to real business data. Approval policy may inspect validated arguments in memory, but its persisted presentation must be a bounded safe projection. Authentication and project authorization must happen in the business service before it calls `decideApproval()`; the Harness enforces runtime scope and decision idempotency, not business permission.

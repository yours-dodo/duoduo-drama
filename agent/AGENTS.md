# Agent Service Guidelines

## Current Status

The current implementation is a minimal Hono service with `src/app.ts`, `src/main.ts`, and a `/health` test. No AI runtime, workflow persistence, Server integration, or public task contract is wired yet. Treat the structure below as the approved direction and create directories only when real code requires them.

## Scope and Responsibilities

This project is the Hono-based Agent service. It owns application-level model selection and runtime composition, context assembly, prompt management, tool execution, Agent workflows, and Agent-owned execution/checkpoint policies. It consumes the provider-neutral `@duoduo/ai` runtime through its public exports.

`packages/ai` owns built-in Provider factories, vendor wire protocols, authentication primitives, transport policies, media-generation contracts, and the reusable AI runtime. Do not reimplement those boundaries in `agent/`, deep-import `packages/ai/src`, or add provider SDK behavior directly to workflows. Agent code may supply explicit configuration, credentials, policy, and application-specific adapters when composing `@duoduo/ai`.

The Agent service does not own user authorization, canonical project state, authoritative business persistence, or client-facing product APIs. Never import code from `apps/server`. Use explicit HTTP or task contracts to request Server-owned data and changes. Do not connect directly to the Server database or duplicate Server authorization rules inside Agent workflows.

Agent-specific resumable workflow state may be modeled behind ports owned by the Agent core when it is introduced. Keep concrete database, queue, filesystem, and cache implementations in infrastructure adapters, and do not treat Agent checkpoints as the canonical copy of Server-owned business data.

## Structure

Create directories only when real code needs them. Use these boundaries as Agent capabilities grow:

- `src/config/` for Agent-owned environment parsing, model selection, and runtime configuration.
- `src/contracts/` for the Agent service's public HTTP or task request/response shapes.
- `src/ai/` for composition of documented `@duoduo/ai` exports, credential resolution, and application-level model policy.
- `src/tools/` for tool definitions and adapters to external capabilities.
- `src/workflows/` for task orchestration, state transitions, and checkpoint ports.
- `src/infrastructure/` for concrete persistence, queue, cache, and external-service adapters after those technologies are selected.

Keep Hono route handlers thin. They should validate input, invoke a workflow or service, and map the result. Workflows must depend on Agent-owned ports rather than Hono, database clients, queues, or one model vendor.

## Commands

Run from the repository root:

- `pnpm --filter @duoduo/agent dev` — start Hono on port 3002 by default; `PORT` may override it.
- `pnpm --filter @duoduo/agent typecheck` — type-check the Agent service.
- `pnpm --filter @duoduo/agent test` — run Agent tests.
- `pnpm --filter @duoduo/agent build` — compile production JavaScript.
- `pnpm --filter @duoduo/agent start` — run the compiled `dist/main.js` output.

Also run root `pnpm lint` and `pnpm format:check` before submitting changes.

## Testing, Safety, and Failures

Co-locate tests as `*.test.ts`. Test tool input validation, workflow transitions, provider error mapping, timeouts, cancellation, persistence/checkpoint behavior, and retry decisions. Mock model and external-service boundaries; tests must not make paid or nondeterministic model calls by default. Use the dedicated `@duoduo/ai` live harness only when an explicitly approved integration test requires a real Provider.

Treat prompts, model outputs, uploaded content, and tool results as untrusted input. Never log credentials or full sensitive user content. Mutating tools must have explicit authorization context and auditable inputs before they are connected to real business data.

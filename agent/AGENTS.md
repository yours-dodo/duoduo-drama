# Agent Service Guidelines

## Scope and Responsibilities

This project is the Hono-based Agent service. It owns model-provider adapters, context assembly, prompt management, tool execution, and Agent workflows. It does not own user authorization, canonical project state, business persistence, or client-facing product APIs.

Never import code from `apps/server`. Use explicit HTTP or task contracts to request Server-owned data and changes. Do not connect directly to the Server database or duplicate Server authorization rules inside Agent workflows.

## Structure

Create directories only when real code needs them. Use these boundaries as Agent capabilities grow:

- `src/config/` for Agent-owned runtime and model configuration.
- `src/contracts/` for the Agent service's public HTTP request and response shapes.
- `src/tools/` for tool definitions and adapters to external capabilities.
- `src/workflows/` for task orchestration and checkpoint logic.
- `src/providers/` for model-provider-specific adapters when more than one provider concern appears.

Keep Hono route handlers thin. They should validate input, invoke a workflow or service, and map the result. Keep provider-specific request formats behind adapters so workflows do not depend on one model vendor.

## Commands

Run from the repository root:

- `pnpm --filter @duoduo/agent dev` — start Hono on port 3002.
- `pnpm --filter @duoduo/agent typecheck` — type-check the Agent service.
- `pnpm --filter @duoduo/agent test` — run Agent tests.
- `pnpm --filter @duoduo/agent build` — compile production JavaScript.

Also run root `pnpm lint` and `pnpm format:check` before submitting changes.

## Testing, Safety, and Failures

Co-locate tests as `*.test.ts`. Test tool input validation, workflow transitions, provider error mapping, timeouts, cancellation, and retry decisions. Mock model and external-service boundaries; tests must not make paid or nondeterministic model calls by default.

Treat prompts, model outputs, uploaded content, and tool results as untrusted input. Never log credentials or full sensitive user content. Mutating tools must have explicit authorization context and auditable inputs before they are connected to real business data.

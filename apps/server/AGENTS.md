# Server Project Guidelines

## Scope and Responsibilities

This project is the NestJS business Server. It owns authentication and authorization, teams, projects, domain rules, persistence, client-facing APIs, and integration with the Agent service. It does not own model prompting, Agent tools, context assembly, or Agent workflow implementation.

Never import code from `agent/`. Communicate with Agent through an explicit integration boundary. The Agent must not be given direct access to the Server database.

## Structure and Dependency Direction

Create directories only when real code needs them. Use these boundaries as the Server grows:

- `src/domain/` for framework-independent entities, value objects, policies, and invariants.
- `src/modules/` for NestJS modules and application use cases grouped by business capability.
- `src/integrations/agent/` for the Agent client and request/response mapping.
- `src/config/` for Server-owned environment parsing and validation.

Dependencies should point inward: controllers and infrastructure may call application and domain code; domain code must not import NestJS, transport DTOs, database ORM types, or Agent implementations. Keep controllers thin: validate transport input, call one application use case, and map the result to an HTTP response.

Keep Server and Agent protocol types near their respective adapters until a real, stable protocol justifies OpenAPI, JSON Schema, generated clients, or a shared contracts package.

## Commands

Run from the repository root:

- `pnpm --filter @duoduo/server dev` — start NestJS on port 3001.
- `pnpm --filter @duoduo/server typecheck` — type-check the Server.
- `pnpm --filter @duoduo/server test` — run Server tests.
- `pnpm --filter @duoduo/server build` — compile production JavaScript.

Also run root `pnpm lint` and `pnpm format:check` before submitting changes.

## Testing and Failure Handling

Co-locate tests as `*.test.ts`. Add focused unit tests for domain invariants and application use cases, plus integration tests for important HTTP and persistence boundaries once those are introduced. Cover successful behavior, validation failures, authorization failures, and external-service errors.

Validate environment variables during startup. Do not expose stack traces, credentials, model keys, or internal dependency errors in API responses. External Agent calls must eventually define timeouts, idempotency, and retry behavior explicitly rather than relying on client defaults.

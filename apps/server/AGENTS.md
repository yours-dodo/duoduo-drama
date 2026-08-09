# Server Project Guidelines

## Current Status

The Server has an HTTP platform baseline: validated startup configuration, URI-versioned APIs, DTO validation, Cookie parsing, trusted-origin CORS, request IDs, structured request logs, safe error envelopes, and `/health` plus `/ready` probes. Authentication, business modules, persistence, and Agent integration have not been introduced yet.

## Scope and Responsibilities

The target boundary of this NestJS business Server owns authentication and authorization, teams, projects, domain rules, authoritative business persistence, client-facing APIs, and integration with the Agent service. It does not own model prompting, Agent tools, context assembly, Provider wire adapters, or Agent workflow implementation.

Never import code from `agent/`. Communicate with Agent through an explicit integration boundary. The Agent must not be given direct access to the Server database.

## Structure and Dependency Direction

Create directories only when real code needs them. Use these boundaries as the Server grows:

- `src/domain/` for framework-independent entities, value objects, policies, and invariants.
- `src/modules/` for NestJS modules and application use cases grouped by business capability.
- `src/integrations/agent/` for the Agent client and request/response mapping.
- `src/config/` for Server-owned environment parsing and validation.
- `src/platform/http/` for transport-wide middleware, filters, versioning, and health probes.
- `src/platform/observability/` for request-level logs and future telemetry adapters.
- `src/test/` for reusable Server test harnesses; production builds must exclude this directory.

Dependencies should point inward: controllers and infrastructure may call application and domain code; domain code must not import NestJS, transport DTOs, database ORM types, or Agent implementations. Keep controllers thin: validate transport input, call one application use case, and map the result to an HTTP response.

Keep Server and Agent protocol types near their respective adapters until a real, stable protocol justifies OpenAPI, JSON Schema, generated clients, or a shared contracts package.

## Commands

Run from the repository root:

- `pnpm --filter @duoduo/server dev` — compile in watch mode and restart NestJS on port 3001 by default; `PORT` may override it.
- `pnpm --filter @duoduo/server typecheck` — type-check the Server.
- `pnpm --filter @duoduo/server test` — run Server tests.
- `pnpm --filter @duoduo/server build` — compile production JavaScript.
- `pnpm --filter @duoduo/server start` — run the compiled `dist/main.js` output.

Also run root `pnpm lint` and `pnpm format:check` before submitting changes.

## Testing and Failure Handling

Co-locate tests as `*.test.ts`. Add focused unit tests for domain invariants and application use cases, plus integration tests for important HTTP and persistence boundaries once those are introduced. Cover successful behavior, validation failures, authorization failures, and external-service errors.

Validate environment variables during startup. Do not expose stack traces, credentials, model keys, or internal dependency errors in API responses. External Agent calls must eventually define timeouts, idempotency, and retry behavior explicitly rather than relying on client defaults.

Use `apps/server/.env.example` as the local configuration reference. Production requires a Cookie secret of at least 32 characters and an explicit comma-separated trusted-origin list. Never log request bodies, authorization headers, Cookies, or URL query values.

# Server Project Guidelines

## Current Status

The Server has an HTTP platform baseline, the Prisma/PostgreSQL runtime boundary, and passwordless Web identity: normalized email addresses, protected one-time login challenges, shared PostgreSQL request limits, single-use verification, persistent sessions, local delivery, `/v1/auth` endpoints, and `/v1/me`. Team tenancy, business authorization, other business modules, and Agent integration have not been introduced yet.

## Scope and Responsibilities

The target boundary of this NestJS business Server owns authentication and authorization, teams, projects, domain rules, authoritative business persistence, client-facing APIs, and integration with the Agent service. It does not own model prompting, Agent tools, context assembly, Provider wire adapters, or Agent workflow implementation.

Never import code from `agent/`. Communicate with Agent through an explicit integration boundary. The Agent must not be given direct access to the Server database.

## Structure and Dependency Direction

Create directories only when real code needs them. Use these boundaries as the Server grows:

- `src/domain/` for framework-independent entities, value objects, policies, and invariants.
- `src/modules/` for NestJS modules and application use cases grouped by business capability.
- `src/modules/identity/` for passwordless login application flows, ports, transport DTOs, and identity infrastructure adapters.
- `src/integrations/agent/` for the Agent client and request/response mapping.
- `src/config/` for Server-owned environment parsing and validation.
- `src/platform/http/` for transport-wide middleware, filters, versioning, and health probes.
- `src/platform/database/` for the private Prisma lifecycle, database readiness, and transaction boundary. Business modules must consume exported database ports rather than a global Prisma Client.
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
- `pnpm --filter @duoduo/server db:generate` — regenerate the ignored Prisma Client output.
- `pnpm --filter @duoduo/server db:migrate:dev` — create and apply a reviewed local migration.
- `pnpm --filter @duoduo/server db:migrate:deploy` — apply checked-in migrations during deployment.
- `pnpm --filter @duoduo/server test:postgres` — require `SERVER_TEST_POSTGRES_URL` and run the real PostgreSQL boundary suite.

Also run root `pnpm lint` and `pnpm format:check` before submitting changes.

## Testing and Failure Handling

Co-locate tests as `*.test.ts`. Add focused unit tests for domain invariants and application use cases, plus integration tests for important HTTP and persistence boundaries once those are introduced. Cover successful behavior, validation failures, authorization failures, and external-service errors.

Validate environment variables during startup. Do not expose stack traces, credentials, model keys, or internal dependency errors in API responses. External Agent calls must eventually define timeouts, idempotency, and retry behavior explicitly rather than relying on client defaults.

Use `apps/server/.env.example` as the local configuration reference. Production requires a Cookie secret and login-token pepper of at least 32 characters, an HTTPS public Web URL, and an explicit comma-separated trusted-origin list. Configure `TRUST_PROXY_HOPS` to the deployment's exact trusted reverse-proxy count; keep the default `0` when the Server is directly exposed. Never log request bodies, authorization headers, Cookies, or URL query values.

Raw login and session tokens may exist only at their delivery or HTTP Cookie boundaries. Persist purpose-separated HMAC digests only; never add raw token, verification code, magic-link URL, Cookie value, or source address columns or logs. Challenge consumption, user/session creation, revocation, and identity security events must keep their current transaction boundaries and use the database clock. Web session Cookies remain `HttpOnly`, `SameSite=Lax`, and `Secure` in production; every Cookie-authenticated write must pass the global exact-Origin check. The local email adapter is non-production only, and production startup must remain blocked until a real delivery adapter is configured.

The Server database must use `SERVER_DATABASE_URL`; the Agent database uses its own `AGENT_*` variables, database, and credentials. Never share Prisma models, migration history, database users, or connection strings across those services. Application startup does not apply migrations automatically: deploy migrations explicitly before starting code that depends on them.

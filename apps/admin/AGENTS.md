# Admin Project Guidelines

## Current Status

This project is the independent React SPA for platform operations. The initial
implementation is a Vite + React + Ant Design shell with local placeholder data;
Server Admin API, real authentication, RBAC, and Agent operations integration
are not connected yet.

## Scope and Responsibilities

The Admin app owns management pages, navigation, presentation state, and
transport adapters for future Server Admin APIs. It must not call the Agent
service directly, import Server source code, connect to databases, or duplicate
authorization rules. The Server remains the authority for administrator
identity, tenant permissions, audit, and Agent integration.

Use Zustand for client-only state, TanStack Query for server state, and Axios
for HTTP transport. Do not copy query data into Zustand. Keep mock adapters
replaceable with Server API adapters without changing page routes or layouts.

## Structure

- `app/layouts/` — Admin shell, navigation, header, and outlet.
- `app/pages/` — route-level dashboard and placeholder views.
- `app/components/` — reusable Ant Design presentation components.
- `app/router/` — route metadata, route protection, and navigation.
- `app/stores/` — client-only session and UI state.
- `app/queries/` — TanStack Query hooks.
- `app/services/` — Axios client and local/mock adapters.
- `app/types/` — Admin view models and transport-facing types.

## Commands

Run from the repository root:

- `pnpm --filter @duoduo/admin dev` — start Vite on port 3003.
- `pnpm --filter @duoduo/admin typecheck` — run TypeScript checks.
- `pnpm --filter @duoduo/admin test` — run Admin unit tests.
- `pnpm --filter @duoduo/admin build` — create the production SPA build.

Also run root `pnpm lint` and `pnpm format:check` before submitting changes.

## Testing and Verification

Test route metadata, placeholder session transitions, and mock query adapters
without depending on implementation details. When user-facing routes change,
verify the affected route at a normal desktop width and a narrow mobile width.
Check loading, empty, error, and disabled states for any real data feature.

Do not commit `dist/`, Vite cache files, screenshots, or browser artifacts.

# Web Project Guidelines

## Current Status

The current implementation is a minimal Nuxt 4 application with `app/app.vue` and no business routes, API adapters, state library, or component system yet. Add those structures only when a real feature requires them.

## Scope and Responsibilities

This project is the Nuxt Web workspace for the full creator workbench. It owns pages, layouts, components, composables, client-side state, accessibility, and presentation-oriented adapters for the Server API. It does not own core business rules, persistence, authentication policy, or Agent orchestration.

The Web must call the Server for business and Agent capabilities. Do not call the Agent service directly from browser code, duplicate Server authorization rules in the client, or make UI state the authoritative source of business state.

## Structure

Place Nuxt application code under `app/` and follow Nuxt conventions as the project grows:

- `app/pages/` for route-level views.
- `app/components/` for reusable visual components.
- `app/composables/` for reusable UI behavior and Server API access.
- `app/stores/` only after a client state library is deliberately introduced.
- `app/types/` for Web-only view models; transport types should live beside the API adapter that consumes them.

Keep components focused on rendering and interaction. Move reusable behavior into composables, and keep core business decisions on the Server.

## Commands

Run from the repository root:

- `pnpm --filter @duoduo/web dev` — start Nuxt on port 3000.
- `pnpm --filter @duoduo/web typecheck` — run Nuxt type checking.
- `pnpm --filter @duoduo/web test` — run Web tests.
- `pnpm --filter @duoduo/web build` — create the production build.

Also run root `pnpm lint` and `pnpm format:check` before submitting changes.

## Testing and Verification

Co-locate unit tests as `*.test.ts`. Test composables and nontrivial state transitions without depending on implementation details. User-facing changes require a browser check of the affected route at both a normal desktop width and a narrow mobile width. Verify loading, empty, error, and disabled states when the change introduces them.

Do not commit `.nuxt/`, `.output/`, browser artifacts, or generated client code unless its generation and update policy is documented.

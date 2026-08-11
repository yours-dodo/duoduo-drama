# Web Project Guidelines

## Current Status

The current implementation is an Astro application. Astro owns the public SEO pages, page layouts, routing shell, and Web-facing Server API adapters. The story creation workspace is implemented with Vue, while the short-drama workspace is implemented with React. Business routes and API flows are being introduced incrementally.

## Scope and Responsibilities

This is the C-end creator Web workspace. It owns public pages, layouts, Astro components, Vue story features, React drama features, client-side interaction state, accessibility, and presentation-oriented adapters for the Server API.

It does not own core business rules, persistence, authentication policy, or Agent orchestration. The Web must call the Server for business and Agent capabilities. Do not call the Agent service directly from browser code, duplicate Server authorization rules in the client, or make UI state the authoritative source of business state.

## Framework Boundaries

- Astro owns SEO, public HTML, page layouts, route shells, loading states, and error boundaries.
- `src/workspaces/story/` owns the Vue story-creation experience.
- `src/workspaces/drama/` owns the React short-drama experience.
- A single business workspace must use one client UI framework; do not mix Vue and React state or components inside the same workspace.
- Shared code must remain framework-neutral: Server API adapters, transport types, session representations, design tokens, and small utilities.
- Keep story and drama feature modules independent so either can become a separate application later without introducing runtime microfrontend infrastructure now.

## Structure

Place Astro application code under `src/`:

- `src/pages/` for Astro file-based routes.
- `src/layouts/` for Astro page layouts.
- `src/components/astro/` for static layout, SEO, navigation, and page-state components.
- `src/workspaces/story/` for Vue story-project components, state, and adapters.
- `src/workspaces/drama/` for React short-drama components, state, and adapters.
- `src/lib/server-api/` for framework-neutral Server API access and error mapping.
- `src/lib/session/` for session representations and navigation helpers; Server remains authoritative.
- `src/styles/` for shared tokens, accessible base styles, and public-page styles.
- `public/` for static assets that do not require Astro processing.

Do not import Server source files, Prisma types, Agent source files, database clients, or object-storage SDKs into Web code.

## Commands

Run from the repository root:

- `pnpm --filter @duoduo/web dev` — start Astro on port 3000.
- `pnpm --filter @duoduo/web typecheck` — run Astro type checking for Astro, Vue, and React files.
- `pnpm --filter @duoduo/web test` — run Web tests.
- `pnpm --filter @duoduo/web build` — create the Astro production build.
- `pnpm --filter @duoduo/web preview` — preview the production build on port 3000.

Also run root `pnpm lint` and `pnpm format:check` before submitting changes.

## Testing and Verification

Co-locate tests as `*.test.ts` or `*.test.tsx` near the source they cover. Test API adapters, session transitions, Vue story state, React drama state, and nontrivial UI behavior without depending on implementation details.

User-facing changes require a browser check of the affected route at both a normal desktop width and a narrow mobile width. Verify loading, empty, error, no-permission, expired-session, retry, and disabled states when the change introduces them.

For the public homepage, verify that the initial HTML contains the core title, description, heading, navigation, CTA, and social metadata without requiring JavaScript. Verify that public pages do not load the story Vue or drama React workbench bundles.

Do not commit `.nuxt/`, `.output/`, `.astro/`, `dist/`, browser artifacts, or generated client code unless its generation and update policy is documented.

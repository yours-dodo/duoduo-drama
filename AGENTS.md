# Repository Guidelines

## Project Structure & Module Organization

This repository is a TypeScript pnpm monorepo. Runtime applications live in `apps/`: `apps/web` is Nuxt, `apps/server` is NestJS, and `apps/mobile` is reserved until a mobile framework is selected. The Hono-based Agent service lives in the top-level `agent/` workspace. Keep code close to its owning project; extract a shared package only after at least two real consumers need the same stable abstraction. Local third-party reference repositories may be cloned under `vendor/`; they are ignored by Git, excluded from the workspace, and must never become runtime dependencies.

Each project root contains a more specific `AGENTS.md`. Rules inherit from this file; the closest file to the code being changed adds project-specific guidance and takes precedence where it is more specific. Update the relevant guide whenever a project's structure, commands, or boundaries change.

## Build, Test, and Development Commands

Use Node.js 22 or newer and the pnpm version declared in the root `package.json`. Install dependencies with `pnpm install`. Standard commands are:

- `pnpm dev` — run Web, Server, and Agent development processes in parallel.
- `pnpm build` — build all runnable workspaces.
- `pnpm typecheck` — type-check all participating workspaces.
- `pnpm lint` — run the repository ESLint configuration.
- `pnpm format` / `pnpm format:check` — write or check Prettier formatting.
- `pnpm test` — run all Vitest suites.

Use `pnpm --filter <workspace> <script>` for a single workspace. Before submitting changes, also run `git status`, `git diff`, and `git diff --check`. Do not require undocumented global tools.

## Coding Style & Naming Conventions

Use the committed ESLint, Prettier, and strict TypeScript configuration. Use UTF-8 files, LF line endings, spaces rather than tabs, and a final newline. Prefer descriptive names: lowercase kebab-case for documentation and assets, PascalCase for classes and types, and camelCase for functions and variables. Keep code inside its owning project until reuse is real and the shared interface is stable. Avoid unrelated formatting changes.

## Testing Guidelines

Vitest is the default test runner. Co-locate tests as `*.test.ts` near the source they cover. New behavior should cover normal behavior, edge cases, and failure paths. Run `pnpm test` plus the relevant `typecheck` and `build` commands before opening a pull request.

## Commit & Pull Request Guidelines

Use concise, imperative commit subjects with a conventional prefix where it improves clarity, for example `feat: add episode catalog` or `docs: refine workflow`. Keep each commit focused. Pull requests should explain the purpose and approach, list verification performed, and link related issues. Include screenshots or terminal output when behavior or user-facing output changes.

## Security & Configuration

Never commit credentials, tokens, private keys, or machine-specific configuration. Add generated files and local environment files to `.gitignore`, and provide sanitized examples such as `.env.example` when configuration is introduced.

## AI Runtime Productization

`packages/ai` owns the `@duoduo/ai` runtime and its generated built-in Provider catalog. Import individual Provider subpaths by default; `@duoduo/ai/providers/all` is the only boundary allowed to statically import every built-in Provider. The Node CLI is exported from `@duoduo/ai/cli` and built as `duoduo-ai`. Keep real credentials, environment reads, filesystem stores, and interactive auth out of provider-neutral/root imports.

When Provider exports change, run `pnpm --filter @duoduo/ai catalog:update`, `catalog:update -- --check --offline`, `api:check`, and `manifest:check`. Normal `test`, `build`, install, and catalog scripts must never import `packages/ai/test/live/run.ts`; live execution requires its dedicated command and all documented paid-use opt-ins.

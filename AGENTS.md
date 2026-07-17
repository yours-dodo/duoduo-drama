# Repository Guidelines

## Project Structure & Module Organization

This repository is a TypeScript pnpm monorepo. Runtime applications live in `apps/`: `apps/web` is Nuxt, `apps/server` is NestJS, and `apps/mobile` is reserved until a mobile framework is selected. The Hono-based Agent service lives in the top-level `agent/` workspace. Reusable code belongs in focused packages under `packages/`: `domain`, `contracts`, `shared`, `config`, and `tsconfig`. Local third-party reference repositories may be cloned under `vendor/`; they are ignored by Git, excluded from the workspace, and must never become runtime dependencies.

## Build, Test, and Development Commands

Use Node.js 22 or newer and the pnpm version declared in the root `package.json`. Install dependencies with `pnpm install`. Standard commands are:

- `pnpm dev` — run Web, Server, and Agent development processes in parallel.
- `pnpm build` — build all runnable workspaces and shared packages.
- `pnpm typecheck` — type-check all participating workspaces.
- `pnpm lint` — run the repository ESLint configuration.
- `pnpm format` / `pnpm format:check` — write or check Prettier formatting.
- `pnpm test` — run all Vitest suites.

Use `pnpm --filter <workspace> <script>` for a single workspace. Before submitting changes, also run `git status`, `git diff`, and `git diff --check`. Do not require undocumented global tools.

## Coding Style & Naming Conventions

Use the committed ESLint, Prettier, and strict TypeScript configuration. Use UTF-8 files, LF line endings, spaces rather than tabs, and a final newline. Prefer descriptive names: lowercase kebab-case for documentation and assets, PascalCase for classes and types, and camelCase for functions and variables. Keep `packages/domain` framework-independent, share Server/Agent protocol definitions through `packages/contracts`, and avoid turning `packages/shared` into a catch-all. Avoid unrelated formatting changes.

## Testing Guidelines

Vitest is the default test runner. Co-locate tests as `*.test.ts` near the source they cover. New behavior should cover normal behavior, edge cases, and failure paths. Run `pnpm test` plus the relevant `typecheck` and `build` commands before opening a pull request.

## Commit & Pull Request Guidelines

The history currently contains only `Initial commit`, so no established commit convention exists. Use concise, imperative commit subjects, optionally with a conventional prefix, for example `feat: add episode catalog`. Keep each commit focused. Pull requests should explain the purpose and approach, list verification performed, and link related issues. Include screenshots or terminal output when behavior or user-facing output changes.

## Security & Configuration

Never commit credentials, tokens, private keys, or machine-specific configuration. Add generated files and local environment files to `.gitignore`, and provide sanitized examples such as `.env.example` when configuration is introduced.

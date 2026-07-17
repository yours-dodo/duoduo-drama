# Repository Guidelines

## Project Structure & Module Organization

This repository is currently a documentation-only scaffold containing planning, contributor guidance, and the root `LICENSE` file. There is no application code yet. Keep repository-level documentation and configuration at the root. As implementation is added, use a predictable layout such as `src/` for application code, `tests/` for automated tests, and `assets/` for static resources. Keep modules focused, and place tests near the code they cover or mirror the `src/` hierarchy under `tests/`. Document any new top-level directory in this guide or the README.

## Build, Test, and Development Commands

No build system, dependency manifest, or test runner is configured yet. Before submitting changes, use the available Git checks:

- `git status` — review tracked and untracked files.
- `git diff` — inspect unstaged changes.
- `git diff --check` — detect whitespace errors.

When adding a language or framework, provide standard, reproducible commands (for example, `npm run dev`, `npm test`, and `npm run build`) in the relevant manifest and update this section in the same pull request. Do not require undocumented global tools.

## Coding Style & Naming Conventions

Follow the formatter and linter conventions of the technology introduced. Commit their configuration so all contributors receive identical results. Until then, use UTF-8 files, LF line endings, spaces rather than tabs, and a final newline. Prefer descriptive names: lowercase kebab-case for documentation and asset files, and language-standard conventions for source identifiers. Avoid unrelated formatting changes.

## Testing Guidelines

There is currently no automated test suite. New functionality should include tests once a test framework is established. Name tests consistently with the chosen ecosystem, such as `*.test.ts` or `test_*.py`, and cover normal behavior, edge cases, and failure paths. Record the exact test command here and ensure it passes before opening a pull request.

## Commit & Pull Request Guidelines

The history currently contains only `Initial commit`, so no established commit convention exists. Use concise, imperative commit subjects, optionally with a conventional prefix, for example `feat: add episode catalog`. Keep each commit focused. Pull requests should explain the purpose and approach, list verification performed, and link related issues. Include screenshots or terminal output when behavior or user-facing output changes.

## Security & Configuration

Never commit credentials, tokens, private keys, or machine-specific configuration. Add generated files and local environment files to `.gitignore`, and provide sanitized examples such as `.env.example` when configuration is introduced.

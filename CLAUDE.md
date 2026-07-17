# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state: greenfield scaffold

This repository contains **no application code, build system, dependency manifest, or test runner yet**. It currently consists of the MIT license and repository-level planning and contributor documentation, including the README, project plan, remaining-task list, and contributor guidance. There is no `.gitignore`. When implementation begins, commit the relevant foundation files (package manifest, lint/format config, `.gitignore`) in the same change rather than relying on undocumented global tools.

## Project identity & intended stack

- Name: **duoduo-drama** (remote: `github.com/yours-dodo/duoduo-drama`, MIT-licensed, copyright `yours-dodo` 2026).
- The Supabase MCP server is enabled in `.claude/settings.local.json`, indicating the intended backend/database layer is **Supabase**. Prefer the Supabase MCP tools (`mcp__supabase__*`) and Supabase CLI patterns when backend work begins. Until a project is linked, no Supabase project ID is known — obtain it via `mcp__supabase__list_projects` rather than guessing.

## Where the conventions live

**Read `AGENTS.md`** — it is the authoritative contributor guide and covers: intended module layout (`src/`, `tests/`, `assets/`), style/naming conventions (UTF-8, LF, spaces, final newline; kebab-case for docs/assets), the expectation that new tooling provides reproducible `build`/`test`/`dev` commands, and commit/PR conventions. Do not duplicate these conventions here; defer to `AGENTS.md` and update it (and this file's commands section) when you introduce concrete tooling.

## Commands

None defined yet. `git status`, `git diff`, and `git diff --check` are the only available checks. When a framework is introduced, record the exact `dev` / `build` / `test` (and single-test) commands here.

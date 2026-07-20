# @duoduo/ai Implementation Status

> Evidence is recorded only after the corresponding commands pass. The current implementation has completed S01–S08; the broader Protocol gate remains in progress until its remaining slices pass.

## Slices

| Slice                                                 | Status | Evidence                                                                                                                                                                                                                                        |
| ----------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S01 Faux chat tracer                                  | passed | `test -- --run core stream testing`, `typecheck`, `build`, `api:check`, `lint`, `format:check`, and `git diff --check` passed on July 19, 2026.                                                                                                 |
| S02 Deterministic terminal/tool failure paths         | passed | 23 focused tests plus `typecheck`, `build`, `api:check`, `lint`, `format:check`, `manifest:check`, and `git diff --check` passed on July 19, 2026.                                                                                              |
| S03 OpenAI Responses fixture transport                | passed | 41 tests, including `test -- --run transport openai-responses openai`, plus `typecheck`, `build`, `api:check`, `lint`, `format:check`, `manifest:check`, and `git diff --check` passed on July 19, 2026.                                        |
| S04 Scoped auth and catalog persistence               | passed | 59 tests, including `test -- --run auth catalog runtime`, plus `typecheck`, `build`, `api:check`, `lint`, `format:check`, `manifest:check`, and `git diff --check` passed on July 19, 2026.                                                     |
| S05 Reliable transport, sessions, and Azure Responses | passed | 94 tests, including `test -- --run transport session azure-openai-responses`, plus `typecheck`, `build`, `api:check`, `lint`, `format:check`, `manifest:check`, and `git diff --check` passed on July 19, 2026.                                 |
| S06 Anthropic Messages and Anthropic OAuth            | passed | 119 tests, including 25 focused Anthropic Messages, OAuth, runtime refresh/revoke, and cache-cost tests, plus `typecheck`, `build`, `api:check`, `lint`, `format:check`, `manifest:check`, and `git diff --check` passed on July 19, 2026.      |
| S07 Google, Vertex, and Bedrock ambient paths         | passed | 142 tests, including Google Developer API, Vertex API-key/ADC, Bedrock bearer/AWS signing, binary event-stream CRC, ambient policy/identity, and per-retry authorization coverage, plus all package verification gates passed on July 19, 2026. |
| S08 OpenAI Chat and compatible Provider wave          | passed | 174 tests, including the OpenAI Chat protocol compatibility matrix and all 17 compatible Provider auth/endpoint/request/stream/error manifest rows, plus all package verification gates passed on July 20, 2026.                                |

## Gates

| Gate                 | Status      | Evidence                                                                            |
| -------------------- | ----------- | ----------------------------------------------------------------------------------- |
| Foundation           | passed      | S01 and S02 passed with the package test, API, type, build, lint, and format gates. |
| Runtime              | passed      | S03–S05 passed with auth, catalog, transport, session, and isolation coverage.      |
| Protocol             | in-progress | S03 and S05–S08 protocol paths passed; S09–S12 remain.                              |
| Baseline Provider    | not-started | —                                                                                   |
| Extended Provider    | not-started | —                                                                                   |
| Generation           | not-started | —                                                                                   |
| Generation Ecosystem | not-started | —                                                                                   |
| Productization       | not-started | —                                                                                   |

# @duoduo/ai Implementation Status

> Evidence is recorded only after the corresponding commands pass. The current implementation has completed S01–S13; the Protocol and Baseline Provider gates are complete, and the remaining Extended Provider, Generation, ecosystem, and productization slices are still in progress.

## Slices

| Slice                                                 | Status | Evidence                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S01 Faux chat tracer                                  | passed | `test -- --run core stream testing`, `typecheck`, `build`, `api:check`, `lint`, `format:check`, and `git diff --check` passed on July 19, 2026.                                                                                                                                     |
| S02 Deterministic terminal/tool failure paths         | passed | 23 focused tests plus `typecheck`, `build`, `api:check`, `lint`, `format:check`, `manifest:check`, and `git diff --check` passed on July 19, 2026.                                                                                                                                  |
| S03 OpenAI Responses fixture transport                | passed | 41 tests, including `test -- --run transport openai-responses openai`, plus `typecheck`, `build`, `api:check`, `lint`, `format:check`, `manifest:check`, and `git diff --check` passed on July 19, 2026.                                                                            |
| S04 Scoped auth and catalog persistence               | passed | 59 tests, including `test -- --run auth catalog runtime`, plus `typecheck`, `build`, `api:check`, `lint`, `format:check`, `manifest:check`, and `git diff --check` passed on July 19, 2026.                                                                                         |
| S05 Reliable transport, sessions, and Azure Responses | passed | 94 tests, including `test -- --run transport session azure-openai-responses`, plus `typecheck`, `build`, `api:check`, `lint`, `format:check`, `manifest:check`, and `git diff --check` passed on July 19, 2026.                                                                     |
| S06 Anthropic Messages and Anthropic OAuth            | passed | 119 tests, including 25 focused Anthropic Messages, OAuth, runtime refresh/revoke, and cache-cost tests, plus `typecheck`, `build`, `api:check`, `lint`, `format:check`, `manifest:check`, and `git diff --check` passed on July 19, 2026.                                          |
| S07 Google, Vertex, and Bedrock ambient paths         | passed | 142 tests, including Google Developer API, Vertex API-key/ADC, Bedrock bearer/AWS signing, binary event-stream CRC, ambient policy/identity, and per-retry authorization coverage, plus all package verification gates passed on July 19, 2026.                                     |
| S08 OpenAI Chat and compatible Provider wave          | passed | 174 tests, including the OpenAI Chat protocol compatibility matrix and all 17 compatible Provider auth/endpoint/request/stream/error manifest rows, plus all package verification gates passed on July 20, 2026.                                                                    |
| S09 Multi-protocol gateways and GitHub OAuth          | passed | 182 tests, including all 19 gateway Provider × protocol fixtures, GitHub device/token exchange and credential-derived endpoint isolation, plus all package verification gates passed on July 20, 2026.                                                                              |
| S10 Codex, Mistral, Radius, and PI parity             | passed | 200 tests, including the deterministic 36-Provider/10-protocol parity ledger, Codex/Mistral/PI stream contracts, five OAuth refresh skews, polling/revocation, and Radius discovery isolation, plus all package verification gates passed on July 20, 2026.                         |
| S11 Qwen text protocols and native DashScope          | passed | 208 tests, including six-region shared/workspace endpoint validation, four deterministic Qwen protocol bindings, curated native DashScope text/multimodal routes, thinking/tools/usage/replay normalization, plus all package verification gates passed on July 20, 2026.           |
| S12 Doubao Responses and Ark text protocols           | passed | 214 tests, including explicit Beijing Ark endpoint resolution, Model ID/Endpoint ID body-only binding, Responses/Chat compatibility selection, Ark thinking/tool/replay normalization, plus all package verification gates passed on July 20, 2026.                                 |
| S13 OpenRouter direct image generation                | passed | 228 tests, including ordered text/reference input, text plus multiple image output, token/cache cost, partial failure, abort, timeout, stored-auth fencing, registry validation, and public-only consumer compilation, plus all package verification gates passed on July 20, 2026. |

## Gates

| Gate                 | Status      | Evidence                                                                            |
| -------------------- | ----------- | ----------------------------------------------------------------------------------- |
| Foundation           | passed      | S01 and S02 passed with the package test, API, type, build, lint, and format gates. |
| Runtime              | passed      | S03–S05 passed with auth, catalog, transport, session, and isolation coverage.      |
| Protocol             | passed      | S03 and S05–S12 passed with all required protocol adapters and Provider bindings.   |
| Baseline Provider    | passed      | PI text baseline passed in S10 and OpenRouter direct images passed in S13.          |
| Extended Provider    | not-started | —                                                                                   |
| Generation           | not-started | —                                                                                   |
| Generation Ecosystem | not-started | —                                                                                   |
| Productization       | not-started | —                                                                                   |
